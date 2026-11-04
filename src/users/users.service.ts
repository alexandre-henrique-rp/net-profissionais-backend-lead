import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, User } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth/auth.types.js';
import { SessionService } from '../common/auth/session.service.js';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  buildPageMeta,
  resolvePagination,
  type PageMeta,
} from '../common/pagination/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { INVITE_TTL_HOURS, normalizeEmail } from '../auth/auth.service.js';
import type { BlockUserDto } from './dto/block-user.dto.js';
import type { InviteUserDto } from './dto/invite-user.dto.js';
import type { ListUsersQueryDto } from './dto/list-users.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

/**
 * Campos do usuário que saem da API.
 *
 * `passwordHash` e `inviteToken` não estão aqui de propósito: o convite é um
 * segredo de uso único e o hash nunca deve cruzar a fronteira HTTP.
 */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  operationalRole: true,
  status: true,
  inviteExpiresAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Usuário listado/editado pela gestão de colaboradores. */
export type ManageableUser = Pick<User, keyof typeof USER_SELECT>;

/** Resposta da listagem paginada. */
export interface UsersPage {
  items: ManageableUser[];
  meta: PageMeta;
}

/** Resposta do convite (Modal 01). */
export interface InviteResult {
  invite_id: string;
  email: string;
  role: string;
  operational_role: string;
  expires_at: string;
  message: string;
}

/** Resposta do bloqueio destrutivo (Modal 02). */
export interface BlockResult {
  blocked: true;
  reassigned: number;
  user_id: string;
  status: 'BLOCKED';
  transferred_to: string;
  message: string;
}

/** Formato dos identificadores gerados pelo Prisma (`uuid`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Escapa os curingas do `LIKE`/`ILIKE`.
 *
 * Prisma passa a busca como parâmetro do `ILIKE`: sem escapar, um `%` digitado
 * pelo usuário vira "qualquer coisa" e a consulta deixa de filtrar.
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** A pessoa é administradora em qualquer um dos dois eixos do RBAC. */
function isAdmin(user: {
  role: string;
  operationalRole: string;
}): boolean {
  return user.role === 'ADMIN' || user.operationalRole === 'ADMIN';
}

/**
 * Gestão de colaboradores da corporação.
 *
 * Toda consulta é filtrada pelo `tenantId` da sessão: nenhum handler aceita
 * tenant vindo do corpo ou da query.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly mail: MailService,
  ) {}

  /** `GET /users` — listagem com filtros e paginação. */
  async list(query: ListUsersQueryDto, tenantId: string): Promise<UsersPage> {
    const { page, limit } = resolvePagination(query.page, query.limit);

    const where: Prisma.UserWhereInput = { tenantId };

    if (query.role) {
      where.role = query.role;
    }

    if (query.operational_role) {
      where.operationalRole = query.operational_role;
    }

    if (query.status) {
      where.status = query.status;
    }

    const term = query.q?.trim();

    if (term) {
      const search = sanitizeSearchTerm(term);
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, meta: buildPageMeta(page, limit, total) };
  }

  /** `POST /users/invite` — cria a conta pendente e envia o convite. */
  async invite(dto: InviteUserDto, tenantId: string): Promise<InviteResult> {
    const email = normalizeEmail(dto.email);

    const existing = await this.prisma.user.findFirst({
      where: { tenantId, email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existing) {
      throw new BusinessException(
        409,
        'EMAIL_ALREADY_EXISTS',
        'Já existe um colaborador cadastrado com este e-mail na corporação.',
      );
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, maxUsers: true },
    });

    if (!tenant) {
      throw new BusinessException(
        404,
        'NOT_FOUND',
        'Corporação não encontrada.',
      );
    }

    // Conta bloqueada não ocupa assento; pendente ocupa (o convite reserva a vaga).
    const seatsInUse = await this.prisma.user.count({
      where: { tenantId, status: { not: 'BLOCKED' } },
    });

    if (seatsInUse >= tenant.maxUsers) {
      throw new BusinessException(
        422,
        'USER_QUOTA_EXCEEDED',
        `O plano corporativo atingiu o limite de ${tenant.maxUsers} usuários ativos. Faça upgrade para adicionar mais assentos.`,
      );
    }

    const inviteToken = randomUUID();
    const inviteExpiresAt = new Date(
      Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000,
    );

    const created = await this.prisma.user.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        email,
        // Hash vazio é intencional: conta PENDING não autentica (o login barra
        // pelo status antes de checar a senha) e a senha só existe na ativação.
        passwordHash: '',
        role: dto.role ?? 'USUARIO',
        operationalRole: dto.operational_role,
        status: 'PENDING',
        inviteToken,
        inviteExpiresAt,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    try {
      await this.mail.sendInvite(
        created.email,
        created.name,
        inviteToken,
        tenant.name,
      );
    } catch (error) {
      // O convite já está no banco; falha de SMTP vira aviso, não 500.
      this.logger.warn(
        `Falha ao enviar o convite para ${created.email}: ${(error as Error).message}`,
      );
    }

    return {
      invite_id: created.id,
      email: created.email,
      role: created.role,
      operational_role: dto.operational_role,
      expires_at: inviteExpiresAt.toISOString(),
      message: 'Convite enviado com sucesso para o e-mail informado.',
    };
  }

  /** `PATCH /users/:id` — nome, papéis e situação (nunca e-mail ou senha). */
  async update(
    id: string,
    dto: UpdateUserDto,
    tenantId: string,
  ): Promise<ManageableUser> {
    const target = await this.findTarget(id, tenantId);

    const nextRole = dto.role ?? target.role;
    const nextOperationalRole = dto.operational_role ?? target.operationalRole;
    const nextStatus = dto.status ?? target.status;

    // O snapshot da sessão (`sess:<id>`) congela role/operationalRole por até
    // 8h; comparar com o banco evita derrubar sessão sem motivo.
    const rolesChanged =
      nextRole !== target.role || nextOperationalRole !== target.operationalRole;

    const wasAdmin = isAdmin(target);
    const staysAdmin = nextRole === 'ADMIN' || nextOperationalRole === 'ADMIN';

    // Perder o último administrador deixaria a corporação sem quem gerencia
    // equipe, plano e integrações.
    if (wasAdmin && (!staysAdmin || nextStatus !== 'ACTIVE')) {
      await this.assertAnotherActiveAdmin(tenantId, target.id);
    }

    // Só o convite grava senha. Ativar uma conta sem hash a deixaria ACTIVE e
    // ocupando assento, mas sem nenhuma forma de logar.
    if (dto.status === 'ACTIVE' && !target.passwordHash) {
      throw new BusinessException(
        422,
        'UNPROCESSABLE_ENTITY',
        'O colaborador precisa concluir a ativação por convite antes de ser ativado.',
      );
    }

    // Conta bloqueada não ocupa assento; reativá-la devolve a vaga, então a
    // cota do plano precisa ser checada de novo.
    if (dto.status === 'ACTIVE' && target.status === 'BLOCKED') {
      await this.assertSeatAvailable(tenantId);
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.role !== undefined) {
      data.role = dto.role;
    }

    if (dto.operational_role !== undefined) {
      data.operationalRole = dto.operational_role;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data,
      select: USER_SELECT,
    });

    // Conta suspensa ou rebaixada perde o acesso imediatamente: a sessão aberta
    // guarda os papéis antigos e o `RolesGuard` lê deles. Reativar
    // (`BLOCKED → ACTIVE`) não derruba nada — conta bloqueada não tem sessão viva.
    if (rolesChanged || nextStatus !== 'ACTIVE') {
      await this.sessionService.destroyAllForUser(target.id);
    }

    return updated;
  }

  /**
   * `POST /users/:id/block` — bloqueio destrutivo com reatribuição.
   *
   * A carteira inteira do colaborador passa para outro usuário ativo no mesmo
   * commit, e as sessões abertas morrem logo depois — quem estava logado perde
   * o acesso na hora, não no vencimento do cookie.
   */
  async block(
    id: string,
    dto: BlockUserDto,
    tenantId: string,
    actor: AuthUser,
  ): Promise<BlockResult> {
    const target = await this.findTarget(id, tenantId);

    if (target.id === actor.userId) {
      throw new BusinessException(
        422,
        'CANNOT_BLOCK_SELF',
        'Você não pode bloquear a própria conta.',
      );
    }

    if (target.status !== 'BLOCKED' && isAdmin(target)) {
      await this.assertAnotherActiveAdmin(tenantId, target.id);
    }

    const receiver = await this.prisma.user.findFirst({
      where: {
        id: dto.reassign_to_user_id,
        tenantId,
        status: 'ACTIVE',
      },
      select: { id: true, name: true },
    });

    // O destinatário precisa ser outra pessoa: reatribuir para o próprio
    // bloqueado deixaria a carteira órfã no mesmo instante.
    if (!receiver || receiver.id === target.id) {
      throw new BusinessException(
        404,
        'USER_NOT_FOUND',
        'O colaborador escolhido para assumir os leads não existe ou não está ativo.',
      );
    }

    const { reassigned } = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.tenantLead.updateMany({
        where: { tenantId, assignedUserId: target.id },
        data: {
          assignedUserId: receiver.id,
          // `version` é o lock otimista do funil: reatribuir é escrita.
          version: { increment: 1 },
        },
      });

      await tx.user.update({
        where: { id: target.id },
        data: { status: 'BLOCKED', inviteToken: null, inviteExpiresAt: null },
      });

      return { reassigned: moved.count };
    });

    await this.sessionService.destroyAllForUser(target.id);

    return {
      blocked: true,
      reassigned,
      user_id: target.id,
      status: 'BLOCKED',
      transferred_to: receiver.name,
      message: `Colaborador bloqueado. Seus ${reassigned} leads foram transferidos para ${receiver.name}.`,
    };
  }

  /** Busca o alvo dentro do tenant; fora dele (ou id malformado) é 404. */
  private async findTarget(
    id: string,
    tenantId: string,
  ): Promise<{
    id: string;
    role: User['role'];
    operationalRole: User['operationalRole'];
    status: User['status'];
    /** Lido só para decidir se a conta já tem senha; nunca sai da API. */
    passwordHash: User['passwordHash'];
  }> {
    if (!UUID_PATTERN.test(id)) {
      throw new BusinessException(
        404,
        'USER_NOT_FOUND',
        'Colaborador não encontrado nesta corporação.',
      );
    }

    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        role: true,
        operationalRole: true,
        status: true,
        passwordHash: true,
      },
    });

    if (!target) {
      throw new BusinessException(
        404,
        'USER_NOT_FOUND',
        'Colaborador não encontrado nesta corporação.',
      );
    }

    return target;
  }

  /** Garante que o tenant ainda tem assento livre (conta bloqueada não ocupa). */
  private async assertSeatAvailable(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { maxUsers: true },
    });

    if (!tenant) {
      throw new BusinessException(
        404,
        'NOT_FOUND',
        'Corporação não encontrada.',
      );
    }

    const seatsInUse = await this.prisma.user.count({
      where: { tenantId, status: { not: 'BLOCKED' } },
    });

    if (seatsInUse >= tenant.maxUsers) {
      throw new BusinessException(
        422,
        'USER_QUOTA_EXCEEDED',
        `O plano corporativo atingiu o limite de ${tenant.maxUsers} usuários ativos. Faça upgrade para adicionar mais assentos.`,
      );
    }
  }

  /** Garante que sobra outro administrador ativo além de `exceptUserId`. */
  private async assertAnotherActiveAdmin(
    tenantId: string,
    exceptUserId: string,
  ): Promise<void> {
    const others = await this.prisma.user.count({
      where: {
        tenantId,
        id: { not: exceptUserId },
        status: 'ACTIVE',
        OR: [{ role: 'ADMIN' }, { operationalRole: 'ADMIN' }],
      },
    });

    if (others === 0) {
      throw new BusinessException(
        422,
        'LAST_ADMIN',
        'Este é o último administrador ativo da corporação. Promova outro colaborador antes de prosseguir.',
      );
    }
  }
}
