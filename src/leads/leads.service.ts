import { Injectable } from '@nestjs/common';
import type {
  AuthOperationalRole,
  AuthUser,
} from '../common/auth/auth.types.js';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  buildPageMeta,
  resolvePagination,
  type PageMeta,
} from '../common/pagination/pagination.js';
import {
  LeadTimelineNoteType,
  Prisma,
  UserStatus,
  type CompanySize,
  type LeadTemperature,
  type TenantLeadStatus,
  type TenantSector,
} from '../generated/prisma/client.js';
import { UUID_PATTERN } from '../lead-detail/lead-detail.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ClaimPoolLeadDto } from './dto/claim-pool-lead.dto.js';
import type {
  CreateManualLeadDto,
  ManualLeadContactDto,
  ManualLeadSpecialDateDto,
} from './dto/create-manual-lead.dto.js';
import type { PoolQueryDto } from './dto/pool-query.dto.js';
import { deriveSectorFromCnae } from './cnae-sector.js';
import { DAILY_CLAIM_LIMIT, LEAD_ERROR_CODES } from './leads.constants.js';
import {
  tenantLeadInclude,
  toTenantLeadResponse,
  type TenantLeadResponse,
} from './leads.mapper.js';
import {
  buildPoolWhere,
  CLAIMABLE_STATUSES,
  POOL_ORDER_BY,
} from './leads.query.js';

/** Campos escalares do lead que o cadastro manual pode preencher/atualizar. */
interface LeadScalarPatch {
  companyName?: string;
  tradeName?: string;
  primaryCnae?: string;
  cnaeDescription?: string;
  capitalSocial?: number;
  postalCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  sector?: TenantSector;
  companySize?: CompanySize;
  temperature?: LeadTemperature;
}

/**
 * Campos do `Lead` lidos para decidir o que o cadastro atual ainda pode
 * preencher. A leitura é a base da regra "só completa o que está vazio".
 */
const leadScalarSelect = {
  companyName: true,
  tradeName: true,
  primaryCnae: true,
  cnaeDescription: true,
  capitalSocial: true,
  postalCode: true,
  street: true,
  number: true,
  complement: true,
  neighborhood: true,
  city: true,
  state: true,
  sector: true,
  companySize: true,
  temperature: true,
} satisfies Prisma.LeadSelect;

/** Contato pronto para gravar: o `leadId` entra depois do upsert do `Lead`. */
type LeadContactSeed = Omit<Prisma.LeadContactCreateManyInput, 'leadId'>;

/** Data especial pronta para gravar (mesmo esquema do contato). */
type LeadSpecialDateSeed = Omit<
  Prisma.LeadSpecialDateCreateManyInput,
  'leadId'
>;

/** Resposta paginada do Pool. */
export interface PoolResponse {
  items: TenantLeadResponse[];
  meta: PageMeta;
}

/** Só os dígitos do documento; o DTO já garantiu o tamanho. */
function normalizeDocument(value?: string): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';

  return digits.length > 0 ? digits : null;
}

/** Início do dia corrente — janela da cota de captação. */
function startOfToday(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Monta o patch só com os campos enviados: no reaproveitamento não apagamos dados. */
function buildLeadPatch(dto: CreateManualLeadDto): LeadScalarPatch {
  const patch: LeadScalarPatch = {};

  if (dto.company_name !== undefined) patch.companyName = dto.company_name;
  if (dto.trade_name !== undefined) patch.tradeName = dto.trade_name;
  if (dto.primary_cnae !== undefined) patch.primaryCnae = dto.primary_cnae;
  if (dto.cnae_description !== undefined)
    patch.cnaeDescription = dto.cnae_description;
  if (dto.capital_social !== undefined)
    patch.capitalSocial = dto.capital_social;
  if (dto.postal_code !== undefined) patch.postalCode = dto.postal_code;
  if (dto.street !== undefined) patch.street = dto.street;
  if (dto.number !== undefined) patch.number = dto.number;
  if (dto.complement !== undefined) patch.complement = dto.complement;
  if (dto.neighborhood !== undefined) patch.neighborhood = dto.neighborhood;
  if (dto.city !== undefined) patch.city = dto.city;
  if (dto.state !== undefined) patch.state = dto.state.toUpperCase();
  if (dto.primary_cnae !== undefined) {
    patch.sector = deriveSectorFromCnae(dto.primary_cnae);
  }
  if (dto.company_size !== undefined) patch.companySize = dto.company_size;
  if (dto.temperature !== undefined) patch.temperature = dto.temperature;

  return patch;
}

/** `null`, `undefined` e string em branco contam como "campo ainda vazio". */
function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  );
}

/**
 * REGRA DE OURO do `Lead` global: ao reaproveitar a identidade de um documento
 * que já existe, o cadastro atual **só preenche campo vazio**.
 *
 * O `Lead` pode ter sido qualificado por outra corporação (razão social,
 * endereço, CNAE, capital social). Sobrescrever esse dado com o que este
 * tenant digitou destruiria a ficha que o outro cliente enxerga — e não há
 * auditoria que reverta isso. Campo já preenchido é intocável.
 */
function fillOnlyPatch(
  current: Record<string, unknown>,
  patch: LeadScalarPatch,
): Prisma.LeadUpdateInput {
  const fill: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && isEmptyValue(current[key])) {
      fill[key] = value;
    }
  }

  return fill as Prisma.LeadUpdateInput;
}

/**
 * Contatos do payload viram linhas **novas** com o `tenantId` da sessão.
 *
 * Nunca reaproveitamos um contato já existente: o mesmo `Lead` pode ter
 * contatos de outra corporação e aquele telefone/e-mail é dado pessoal dela.
 */
function toContactsData(
  contacts: ManualLeadContactDto[] | undefined,
  tenantId: string,
): LeadContactSeed[] {
  return (contacts ?? []).map((contact) => ({
    tenantId,
    name: contact.name,
    role: contact.role ?? null,
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    birthday: contact.birthday ? new Date(contact.birthday) : null,
    isPrimary: contact.is_primary ?? false,
    isDecisionMaker: contact.is_decision_maker ?? false,
  }));
}

function toSpecialDatesData(
  dates: ManualLeadSpecialDateDto[] | undefined,
  tenantId: string,
): LeadSpecialDateSeed[] {
  return (dates ?? []).map((date) => ({
    tenantId,
    dateType: date.date_type,
    dayMonth: date.day_month,
    description: date.description ?? null,
  }));
}

/**
 * Regras do Pool de Leads e do cadastro híbrido (`TASK-S03-02` a `TASK-S03-04`).
 *
 * Todo método recebe o `tenantId` da sessão por parâmetro — o serviço nunca lê
 * tenant de corpo/query, e é por isso que ele atravessa a assinatura inteira.
 */
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /leads/manual` — cadastro rápido PJ/PF.
   *
   * `Lead` é a identidade global do cliente: se o CNPJ/CPF já existe na base,
   * a identidade é reaproveitada (completando só o que está vazio) em vez de
   * duplicada. O que pode conflitar é a oportunidade (`TenantLead`) do mesmo
   * tenant, e isso vira `409 LEAD_ALREADY_EXISTS`.
   */
  async createManual(
    dto: CreateManualLeadDto,
    tenantId: string,
    userId: string,
    operationalRole: AuthOperationalRole = 'CAPTADOR',
  ): Promise<TenantLeadResponse> {
    if (dto.assign_to_me === true && operationalRole === 'CAPTADOR') {
      throw new BusinessException(
        403,
        'FORBIDDEN',
        'Captadores não podem atribuir leads à própria carteira.',
      );
    }

    const cnpj = dto.person_type === 'PJ' ? normalizeDocument(dto.cnpj) : null;
    const cpf = dto.person_type === 'PF' ? normalizeDocument(dto.cpf) : null;

    if (!cnpj && !cpf) {
      throw new BusinessException(
        400,
        'VALIDATION_ERROR',
        'Informe o CNPJ (pessoa jurídica) ou o CPF (pessoa física) do lead.',
      );
    }

    // A chave do `upsert` é o documento — agora `@unique` no schema. É o que
    // impede dois cliques em "Salvar" (ou duas transações concorrentes) de
    // criarem duas identidades globais para a mesma empresa.
    const documentKey: Prisma.LeadWhereUniqueInput = cnpj
      ? { cnpj }
      : { cpf: cpf as string };

    const patch = buildLeadPatch(dto);
    const contacts = toContactsData(dto.contacts, tenantId);
    const specialDates = toSpecialDatesData(dto.special_dates, tenantId);
    const assignToMe = dto.assign_to_me === true;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // A etapa de entrada é sempre a primeira do funil do tenant.
        const firstStage = await tx.stage.findFirst({
          where: { tenantId },
          orderBy: { position: 'asc' },
        });

        if (!firstStage) {
          throw new BusinessException(
            422,
            LEAD_ERROR_CODES.stageNotConfigured,
            'A corporação ainda não possui etapas configuradas no funil.',
          );
        }

        const lead = await tx.lead.upsert({
          where: documentKey,
          // `update: {}` é intencional: o upsert só garante a identidade; a
          // qualificação acontece no passo seguinte, campo vazio por campo.
          create: {
            personType: dto.person_type,
            cnpj,
            cpf,
            ...patch,
          },
          update: {},
          select: { id: true, ...leadScalarSelect },
        });

        const fill = fillOnlyPatch(lead as Record<string, unknown>, patch);
        const effectiveCnae = lead.primaryCnae ?? dto.primary_cnae;

        if (effectiveCnae) {
          const derivedSector = deriveSectorFromCnae(effectiveCnae);

          if (lead.sector !== derivedSector) {
            fill.sector = derivedSector;
          }
        }

        if (Object.keys(fill).length > 0) {
          await tx.lead.update({ where: { id: lead.id }, data: fill });
        }

        // Contatos e datas especiais são sempre linhas novas do tenant atual.
        if (contacts.length > 0) {
          await tx.leadContact.createMany({
            data: contacts.map((contact) => ({ ...contact, leadId: lead.id })),
          });
        }

        if (specialDates.length > 0) {
          await tx.leadSpecialDate.createMany({
            data: specialDates.map((date) => ({ ...date, leadId: lead.id })),
          });
        }

        const existingTenantLead = await tx.tenantLead.findUnique({
          where: { tenantId_leadId: { tenantId, leadId: lead.id } },
          select: { id: true },
        });

        if (existingTenantLead) {
          throw new BusinessException(
            409,
            LEAD_ERROR_CODES.alreadyExists,
            'Este documento já está cadastrado na carteira desta corporação.',
            { tenant_lead_id: existingTenantLead.id },
          );
        }

        const status: TenantLeadStatus = assignToMe ? 'CLAIMED' : 'AVAILABLE';

        const tenantLead = await tx.tenantLead.create({
          data: {
            tenantId,
            leadId: lead.id,
            stageId: firstStage.id,
            creatorUserId: userId,
            assignedUserId: assignToMe ? userId : null,
            status,
            customSector: dto.custom_sector?.trim() || null,
          },
          include: tenantLeadInclude(tenantId),
        });

        await tx.leadTimelineNote.create({
          data: {
            tenantLeadId: tenantLead.id,
            userId,
            type: LeadTimelineNoteType.NOTE,
            title: 'Lead cadastrado manualmente',
            content: assignToMe
              ? 'Lead cadastrado manualmente e já atribuído a quem cadastrou.'
              : 'Lead cadastrado manualmente e disponibilizado no Pool.',
          },
        });

        return tenantLead;
      });

      return toTenantLeadResponse(created);
    } catch (error) {
      // Corrida perdida: outra transação criou a oportunidade deste documento
      // no mesmo tenant entre a leitura e a escrita. A resposta correta é a
      // mesma do caso síncrono — a carteira já tem esse lead.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BusinessException(
          409,
          LEAD_ERROR_CODES.alreadyExists,
          'Este documento já está cadastrado na carteira desta corporação.',
        );
      }

      throw error;
    }
  }

  /** `GET /leads/pool` — listagem paginada dos leads livres para captação. */
  async findPool(query: PoolQueryDto, tenantId: string): Promise<PoolResponse> {
    const { page, limit } = resolvePagination(query.page, query.limit);
    const where = buildPoolWhere(query, tenantId);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tenantLead.findMany({
        where,
        include: tenantLeadInclude(tenantId),
        orderBy: POOL_ORDER_BY,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tenantLead.count({ where }),
    ]);

    return {
      items: rows.map(toTenantLeadResponse),
      meta: buildPageMeta(page, limit, total),
    };
  }

  /**
   * `POST /leads/pool/:id/claim` — captação com bloqueio otimista.
   *
   * `:id` é o `TenantLead` (a oportunidade), não o `Lead` global. A escrita é
   * um `updateMany` condicional: quem chegar depois encontra `count === 0` e
   * recebe `409 LEAD_ALREADY_ASSIGNED`.
   *
   * A cota diária (`TASK-S03-04`, 20/dia) é conferida **dentro** da mesma
   * transação da captação e com `Serializable`: `count` e `update` separados
   * deixariam cinco requisições paralelas lerem 19 e todas passarem.
   *
   * `// ASM:` o claim não move o lead para a primeira etapa de propósito — o
   * lead do Pool já está nela (só chega ao Pool na entrada do funil ou por
   * `unlink`, que também devolve à primeira etapa).
   */
  async claim(
    tenantLeadId: string,
    tenantId: string,
    user: AuthUser,
    dto: ClaimPoolLeadDto = {},
  ): Promise<TenantLeadResponse> {
    if (user.operationalRole === 'CAPTADOR') {
      throw new BusinessException(
        403,
        'FORBIDDEN',
        'Captadores não podem assumir leads do Pool.',
      );
    }

    // Id fora do formato UUID estouraria no Postgres (P2007) e viraria 500.
    if (!UUID_PATTERN.test(tenantLeadId)) {
      throw this.leadNotFound();
    }

    const version = dto.expected_version ?? dto.version;
    const assigneeId = await this.resolveAssignee(user, dto.assign_to_user_id);

    try {
      const claimed = await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.tenantLead.findFirst({
            where: { id: tenantLeadId, tenantId },
            select: { id: true, version: true, status: true },
          });

          if (!current) {
            throw this.leadNotFound();
          }

          if (version !== undefined && version !== current.version) {
            throw new BusinessException(
              409,
              LEAD_ERROR_CODES.versionConflict,
              'O lead foi alterado por outro usuário. Atualize a lista e tente novamente.',
              { current_version: current.version },
            );
          }

          if (!CLAIMABLE_STATUSES.includes(current.status)) {
            throw new BusinessException(
              409,
              LEAD_ERROR_CODES.alreadyAssigned,
              'Este lead já foi assumido por outro usuário.',
            );
          }

          // `claimedAt` é a marca da captação, não `updatedAt`: editar um lead
          // ontem não pode consumir a cota de hoje. `unlink` também preserva
          // `claimedAt` — devolver o lead não apaga o registro da captação.
          const claimedToday = await tx.tenantLead.count({
            where: {
              tenantId,
              assignedUserId: assigneeId,
              claimedAt: { gte: startOfToday() },
            },
          });

          if (claimedToday >= DAILY_CLAIM_LIMIT) {
            throw new BusinessException(
              422,
              LEAD_ERROR_CODES.dailyClaimLimitExceeded,
              `Você atingiu o limite de ${DAILY_CLAIM_LIMIT} captações por dia.`,
              { limit: DAILY_CLAIM_LIMIT, claimed_today: claimedToday },
            );
          }

          const updated = await tx.tenantLead.updateMany({
            where: {
              id: tenantLeadId,
              tenantId,
              status: { in: CLAIMABLE_STATUSES },
              // A versão lida dentro da transação fecha o lock otimista.
              version: current.version,
            },
            data: {
              assignedUserId: assigneeId,
              status: 'CLAIMED',
              claimedAt: new Date(),
              version: { increment: 1 },
            },
          });

          if (updated.count === 0) {
            throw new BusinessException(
              409,
              LEAD_ERROR_CODES.alreadyAssigned,
              'Este lead já foi assumido por outro usuário.',
            );
          }

          const row = await tx.tenantLead.findFirst({
            where: { id: tenantLeadId, tenantId },
            include: tenantLeadInclude(tenantId),
          });

          if (!row) {
            throw this.leadNotFound();
          }

          return row;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return toTenantLeadResponse(claimed);
    } catch (error) {
      // `Serializable` aborta uma das transações concorrentes em vez de deixar
      // as duas passarem pela cota. Nada foi gravado: o cliente pode repetir.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new BusinessException(
          409,
          'CONFLICT',
          'Outra captação concorreu com esta operação. Tente novamente.',
        );
      }

      throw error;
    }
  }

  /**
   * Destinatário da captação.
   *
   * Admin pode atribuir a um vendedor do tenant (`assign_to_user_id`); para
   * VENDEDOR/CAPTADOR o campo é ignorado e o lead vai para quem captou — senão
   * um vendedor "delegaria" a captação e estouraria a cota de outra pessoa.
   */
  private async resolveAssignee(
    user: AuthUser,
    assignToUserId?: string,
  ): Promise<string> {
    if (
      user.operationalRole !== 'ADMIN' ||
      !assignToUserId ||
      assignToUserId === user.userId
    ) {
      return user.userId;
    }

    const target = UUID_PATTERN.test(assignToUserId)
      ? await this.prisma.user.findFirst({
          where: {
            id: assignToUserId,
            tenantId: user.tenantId,
            status: UserStatus.ACTIVE,
          },
          select: { id: true },
        })
      : null;

    if (!target) {
      throw new BusinessException(
        404,
        LEAD_ERROR_CODES.userNotFound,
        'Usuário não encontrado ou inativo nesta corporação.',
      );
    }

    return target.id;
  }

  private leadNotFound(): BusinessException {
    return new BusinessException(
      404,
      LEAD_ERROR_CODES.leadNotFound,
      'Lead não encontrado no Pool desta corporação.',
    );
  }
}
