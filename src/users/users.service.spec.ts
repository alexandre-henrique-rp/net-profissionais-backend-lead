import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BusinessException } from '../common/errors/business.exception.js';
import type { SessionService } from '../common/auth/session.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { INVITE_TTL_HOURS } from '../auth/auth.service.js';
import { BlockUserDto } from './dto/block-user.dto.js';
import type { InviteUserDto } from './dto/invite-user.dto.js';
import { UsersService } from './users.service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const RECEIVER_ID = '44444444-4444-4444-8444-444444444444';
const INVITE_ID = '55555555-5555-4555-8555-555555555555';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTOR = {
  userId: ACTOR_ID,
  tenantId: TENANT_ID,
  sessionId: 'sess-admin',
  role: 'ADMIN' as const,
  operationalRole: 'ADMIN' as const,
};

/** Alvo padrão: colaborador comum, ativo e com senha já definida. */
const TARGET_BASE = {
  id: TARGET_ID,
  role: 'USUARIO',
  operationalRole: 'VENDEDOR',
  status: 'ACTIVE',
  passwordHash: 'hash-existente',
};

type Target = typeof TARGET_BASE;

/** Extrai o BusinessException lançado (ou falha se nada for lançado). */
async function catchBusinessError(
  promise: Promise<unknown>,
): Promise<BusinessException> {
  const resultado = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(resultado).toBeInstanceOf(BusinessException);
  return resultado as BusinessException;
}

describe('UsersService', () => {
  let prisma: {
    user: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    tenant: { findUnique: ReturnType<typeof vi.fn> };
    tenantLead: { updateMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let tx: {
    tenantLead: { updateMany: ReturnType<typeof vi.fn> };
    user: { update: ReturnType<typeof vi.fn> };
  };
  let sessionService: {
    destroyAllForUser: ReturnType<typeof vi.fn>;
  };
  let mail: { sendInvite: ReturnType<typeof vi.fn> };
  let service: UsersService;

  beforeEach(() => {
    tx = {
      tenantLead: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };

    prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        update: vi.fn(),
      },
      tenant: { findUnique: vi.fn().mockResolvedValue(null) },
      tenantLead: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    sessionService = {
      destroyAllForUser: vi.fn().mockResolvedValue(undefined),
    };
    mail = { sendInvite: vi.fn().mockResolvedValue(undefined) };

    service = new UsersService(
      prisma as unknown as PrismaService,
      sessionService as unknown as SessionService,
      mail as unknown as MailService,
    );
  });

  function makeTarget(overrides: Partial<Target> = {}): Target {
    return { ...TARGET_BASE, ...overrides };
  }

  describe('list', () => {
    it('filtra pelo tenant da sessão e não expõe passwordHash nem inviteToken @spec:AC-053', async () => {
      const item = {
        id: TARGET_ID,
        name: 'Roberto Vendas',
        email: 'roberto@eletrominas.com.br',
        role: 'USUARIO',
        operationalRole: 'VENDEDOR',
        status: 'ACTIVE',
        inviteExpiresAt: null,
        lastLoginAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      prisma.user.findMany.mockResolvedValue([item]);
      prisma.user.count.mockResolvedValue(1);

      const pagina = await service.list({}, TENANT_ID);

      const argumentos = prisma.user.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        select: Record<string, unknown>;
        skip: number;
        take: number;
      };

      expect(argumentos.where).toEqual({ tenantId: TENANT_ID });
      expect(argumentos.select).not.toHaveProperty('passwordHash');
      expect(argumentos.select).not.toHaveProperty('inviteToken');
      expect(argumentos.skip).toBe(0);
      expect(argumentos.take).toBe(20);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
      });

      expect(pagina.items).toEqual([item]);
      expect(pagina.items[0]).not.toHaveProperty('passwordHash');
      expect(pagina.items[0]).not.toHaveProperty('inviteToken');
      expect(pagina.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      });
    });

    it('aplica busca escapando os curingas do LIKE', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list({ q: '100%_admin' }, TENANT_ID);

      const argumentos = prisma.user.findMany.mock.calls[0][0] as {
        where: { OR?: Array<Record<string, unknown>> };
      };

      expect(argumentos.where.OR?.[0]).toEqual({
        name: { contains: '100\\%\\_admin', mode: 'insensitive' },
      });
    });

    it('combina os filtros de papel e situação com o tenant', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list(
        { role: 'USUARIO', operational_role: 'CAPTADOR', status: 'PENDING' },
        TENANT_ID,
      );

      const argumentos = prisma.user.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };

      expect(argumentos.where).toEqual({
        tenantId: TENANT_ID,
        role: 'USUARIO',
        operationalRole: 'CAPTADOR',
        status: 'PENDING',
      });
    });
  });

  describe('invite', () => {
    const inviteDto: InviteUserDto = {
      name: '  Roberto Vendas  ',
      email: 'Roberto.Vendas@Eletrominas.com.br',
      operational_role: 'VENDEDOR',
    };

    beforeEach(() => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        name: 'Eletrominas',
        maxUsers: 5,
      });
    });

    it('responde 409 EMAIL_ALREADY_EXISTS para e-mail já cadastrado no tenant @spec:AC-054', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: TARGET_ID });

      const error = await catchBusinessError(
        service.invite(inviteDto, TENANT_ID),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('responde 422 USER_QUOTA_EXCEEDED quando a cota do plano está cheia @spec:AC-055', async () => {
      prisma.user.count.mockResolvedValue(5);

      const error = await catchBusinessError(
        service.invite(inviteDto, TENANT_ID),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('USER_QUOTA_EXCEEDED');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('não conta conta bloqueada como assento ocupado', async () => {
      prisma.user.count.mockResolvedValue(4);

      prisma.user.create.mockResolvedValue({
        id: INVITE_ID,
        email: 'roberto.vendas@eletrominas.com.br',
        name: 'Roberto Vendas',
        role: 'USUARIO',
      });

      await service.invite(inviteDto, TENANT_ID);

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, status: { not: 'BLOCKED' } },
      });
    });

    it('cria a conta PENDING com token e validade de 48 horas @spec:AC-056', async () => {
      const antes = Date.now();
      prisma.user.count.mockResolvedValue(1);
      prisma.user.create.mockResolvedValue({
        id: INVITE_ID,
        email: 'roberto.vendas@eletrominas.com.br',
        name: 'Roberto Vendas',
        role: 'USUARIO',
      });

      const resultado = await service.invite(inviteDto, TENANT_ID);

      const dados = prisma.user.create.mock.calls[0][0] as {
        data: {
          tenantId: string;
          name: string;
          email: string;
          passwordHash: string;
          role: string;
          operationalRole: string;
          status: string;
          inviteToken: string;
          inviteExpiresAt: Date;
        };
      };

      expect(dados.data.tenantId).toBe(TENANT_ID);
      expect(dados.data.name).toBe('Roberto Vendas');
      expect(dados.data.email).toBe('roberto.vendas@eletrominas.com.br');
      expect(dados.data.passwordHash).toBe('');
      expect(dados.data.role).toBe('USUARIO');
      expect(dados.data.operationalRole).toBe('VENDEDOR');
      expect(dados.data.status).toBe('PENDING');
      expect(dados.data.inviteToken).toMatch(UUID_PATTERN);

      const validadeMs = dados.data.inviteExpiresAt.getTime() - antes;
      const esperadoMs = INVITE_TTL_HOURS * 60 * 60 * 1000;
      expect(validadeMs).toBeGreaterThan(esperadoMs - 5_000);
      expect(validadeMs).toBeLessThan(esperadoMs + 5_000);
      expect(INVITE_TTL_HOURS).toBe(48);

      expect(mail.sendInvite).toHaveBeenCalledWith(
        'roberto.vendas@eletrominas.com.br',
        'Roberto Vendas',
        dados.data.inviteToken,
        'Eletrominas',
      );

      expect(resultado.invite_id).toBe(INVITE_ID);
      expect(resultado.email).toBe('roberto.vendas@eletrominas.com.br');
      expect(resultado.expires_at).toBe(
        dados.data.inviteExpiresAt.toISOString(),
      );
    });

    it('responde 404 quando a corporação da sessão não existe', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      const error = await catchBusinessError(
        service.invite(inviteDto, TENANT_ID),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });
  });

  describe('resendInvite', () => {
    const pendingTarget = {
      id: TARGET_ID,
      name: 'Roberto Vendas',
      email: 'roberto.vendas@eletrominas.com.br',
      role: 'USUARIO',
      operationalRole: 'VENDEDOR',
      status: 'PENDING',
      passwordHash: '',
    };

    it('gera novo token, renova a expiração e reenvia o e-mail para PENDING @spec:AC-219', async () => {
      const antes = Date.now();
      prisma.user.findFirst.mockResolvedValue(pendingTarget);
      prisma.tenant.findUnique.mockResolvedValue({ name: 'Eletrominas' });

      const result = await service.resendInvite(TARGET_ID, TENANT_ID);

      const updateData = prisma.user.update.mock.calls[0][0].data;
      expect(updateData.inviteToken).toBeTruthy();
      expect(
        updateData.inviteExpiresAt.getTime() - antes,
      ).toBeGreaterThanOrEqual(INVITE_TTL_HOURS * 60 * 60 * 1000 - 1000);
      expect(mail.sendInvite).toHaveBeenCalledWith(
        pendingTarget.email,
        pendingTarget.name,
        updateData.inviteToken,
        'Eletrominas',
      );
      expect(result.resent).toBe(true);
      expect(result.expires_at).toBe(updateData.inviteExpiresAt.toISOString());
    });

    it('responde 409 USER_NOT_PENDING quando a conta já está ativa @spec:AC-220', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...pendingTarget,
        status: 'ACTIVE',
        passwordHash: 'hash',
      });

      const error = await catchBusinessError(
        service.resendInvite(TARGET_ID, TENANT_ID),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('USER_NOT_PENDING');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mail.sendInvite).not.toHaveBeenCalled();
    });

    it('responde 409 USER_NOT_PENDING para conta bloqueada @spec:AC-220', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...pendingTarget,
        status: 'BLOCKED',
      });

      const error = await catchBusinessError(
        service.resendInvite(TARGET_ID, TENANT_ID),
      );

      expect(error.getStatus()).toBe(409);
      expect(mail.sendInvite).not.toHaveBeenCalled();
    });

    it('responde 404 para colaborador fora do tenant ou id inválido @spec:AC-220', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const error = await catchBusinessError(
        service.resendInvite(TARGET_ID, TENANT_ID),
      );
      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('USER_NOT_FOUND');

      const invalidId = await catchBusinessError(
        service.resendInvite('nao-e-uuid', TENANT_ID),
      );
      expect(invalidId.getStatus()).toBe(404);
    });

    it('mantém o reenvio mesmo quando o SMTP falha @spec:AC-219', async () => {
      prisma.user.findFirst.mockResolvedValue(pendingTarget);
      prisma.tenant.findUnique.mockResolvedValue({ name: 'Eletrominas' });
      mail.sendInvite.mockRejectedValue(new Error('SMTP fora do ar'));

      const result = await service.resendInvite(TARGET_ID, TENANT_ID);

      expect(result.resent).toBe(true);
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('responde 404 USER_NOT_FOUND para colaborador de outro tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const error = await catchBusinessError(
        service.update(TARGET_ID, { name: 'Novo Nome' }, TENANT_ID),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('USER_NOT_FOUND');
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID, tenantId: TENANT_ID },
        }),
      );
    });

    it('responde 404 USER_NOT_FOUND para id que não é UUID', async () => {
      const error = await catchBusinessError(
        service.update('nao-e-uuid', { name: 'Novo Nome' }, TENANT_ID),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('USER_NOT_FOUND');
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('responde 422 LAST_ADMIN ao rebaixar o último administrador @spec:AC-057', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeTarget({ role: 'ADMIN', operationalRole: 'ADMIN' }),
      );
      prisma.user.count.mockResolvedValue(0);

      const error = await catchBusinessError(
        service.update(
          TARGET_ID,
          { role: 'USUARIO', operational_role: 'VENDEDOR' },
          TENANT_ID,
        ),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('LAST_ADMIN');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          id: { not: TARGET_ID },
          status: 'ACTIVE',
          OR: [{ role: 'ADMIN' }, { operationalRole: 'ADMIN' }],
        },
      });
    });

    it('revoga as sessões depois de gravar a mudança de papel @spec:AC-058', async () => {
      const ordem: string[] = [];
      const atualizado = {
        id: TARGET_ID,
        name: 'Roberto',
        operationalRole: 'CAPTADOR',
      };

      prisma.user.findFirst.mockResolvedValue(makeTarget());
      prisma.user.update.mockImplementation(async () => {
        ordem.push('update');
        return atualizado;
      });
      sessionService.destroyAllForUser.mockImplementation(async () => {
        ordem.push('destroy');
      });

      const resultado = await service.update(
        TARGET_ID,
        { operational_role: 'CAPTADOR' },
        TENANT_ID,
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID },
          data: { operationalRole: 'CAPTADOR' },
        }),
      );
      expect(sessionService.destroyAllForUser).toHaveBeenCalledWith(TARGET_ID);
      // A sessão só cai depois do commit; antes disso o papel antigo ainda vale.
      expect(ordem).toEqual(['update', 'destroy']);
      expect(resultado).toEqual(atualizado);
    });

    it('responde 422 ao ativar conta que ainda não definiu senha @spec:AC-059', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeTarget({ status: 'PENDING', passwordHash: '' }),
      );

      const error = await catchBusinessError(
        service.update(TARGET_ID, { status: 'ACTIVE' }, TENANT_ID),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('não derruba sessão quando só o nome muda', async () => {
      prisma.user.findFirst.mockResolvedValue(makeTarget());
      prisma.user.update.mockResolvedValue({
        id: TARGET_ID,
        name: 'Roberto Silva',
      });

      await service.update(TARGET_ID, { name: 'Roberto Silva' }, TENANT_ID);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Roberto Silva' } }),
      );
      expect(sessionService.destroyAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('block', () => {
    it('exige reassign_to_user_id no corpo (400 de validação) @spec:AC-060', async () => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });

      const erro = await pipe
        .transform({}, { type: 'body', metatype: BlockUserDto })
        .then(() => undefined)
        .catch((error: unknown) => error);

      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).getStatus()).toBe(400);
      const corpo = (erro as BadRequestException).getResponse() as {
        message: string[];
      };
      expect(corpo.message.join(' ')).toContain('assumir os leads');
    });

    it('responde 422 CANNOT_BLOCK_SELF ao tentar bloquear a própria conta @spec:AC-062', async () => {
      prisma.user.findFirst.mockResolvedValue(makeTarget({ id: ACTOR_ID }));

      const error = await catchBusinessError(
        service.block(
          ACTOR_ID,
          { reassign_to_user_id: RECEIVER_ID },
          TENANT_ID,
          ACTOR,
        ),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('CANNOT_BLOCK_SELF');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('responde 422 LAST_ADMIN ao bloquear o último administrador', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeTarget({ role: 'ADMIN', operationalRole: 'ADMIN' }),
      );
      prisma.user.count.mockResolvedValue(0);

      const error = await catchBusinessError(
        service.block(
          TARGET_ID,
          { reassign_to_user_id: RECEIVER_ID },
          TENANT_ID,
          ACTOR,
        ),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe('LAST_ADMIN');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('responde 404 quando o substituto não é um usuário ativo do tenant', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce(makeTarget())
        .mockResolvedValueOnce(null);

      const error = await catchBusinessError(
        service.block(
          TARGET_ID,
          { reassign_to_user_id: RECEIVER_ID },
          TENANT_ID,
          ACTOR,
        ),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('USER_NOT_FOUND');
      expect(prisma.user.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: RECEIVER_ID, tenantId: TENANT_ID, status: 'ACTIVE' },
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('reatribui todos os leads com increment de version e bloqueia na mesma transação @spec:AC-061', async () => {
      const ordem: string[] = [];
      prisma.user.findFirst
        .mockResolvedValueOnce(makeTarget())
        .mockResolvedValueOnce({ id: RECEIVER_ID, name: 'Alexandre' });
      tx.tenantLead.updateMany.mockResolvedValue({ count: 3 });
      sessionService.destroyAllForUser.mockImplementation(async () => {
        ordem.push('destroy');
      });
      prisma.$transaction.mockImplementation(
        async (callback: (client: typeof tx) => unknown) => {
          ordem.push('transaction');
          return callback(tx);
        },
      );

      const resultado = await service.block(
        TARGET_ID,
        { reassign_to_user_id: RECEIVER_ID },
        TENANT_ID,
        ACTOR,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.tenantLead.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, assignedUserId: TARGET_ID },
        data: {
          assignedUserId: RECEIVER_ID,
          version: { increment: 1 },
        },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: { status: 'BLOCKED', inviteToken: null, inviteExpiresAt: null },
      });

      expect(resultado).toEqual({
        blocked: true,
        reassigned: 3,
        user_id: TARGET_ID,
        status: 'BLOCKED',
        transferred_to: 'Alexandre',
        message:
          'Colaborador bloqueado. Seus 3 leads foram transferidos para Alexandre.',
      });

      // A sessão do bloqueado morre depois do commit.
      expect(ordem).toEqual(['transaction', 'destroy']);
      expect(sessionService.destroyAllForUser).toHaveBeenCalledWith(TARGET_ID);
    });

    it('não revalida o último admin ao bloquear conta já bloqueada', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce(
          makeTarget({
            role: 'ADMIN',
            operationalRole: 'ADMIN',
            status: 'BLOCKED',
          }),
        )
        .mockResolvedValueOnce({ id: RECEIVER_ID, name: 'Alexandre' });

      await service.block(
        TARGET_ID,
        { reassign_to_user_id: RECEIVER_ID },
        TENANT_ID,
        ACTOR,
      );

      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'BLOCKED' }),
        }),
      );
    });
  });
});
