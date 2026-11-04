import 'reflect-metadata';
import { hash, verify } from 'argon2';
import type { JwtService } from '@nestjs/jwt';
import type { SessionService } from '../common/auth/session.service.js';
import { BusinessException } from '../common/errors/business.exception.js';
import type { MailService } from '../mail/mail.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  REDIS_TTL,
  RedisService,
  type RedisLike,
} from '../redis/redis.service.js';
import {
  AuthService,
  INVITE_TTL_HOURS,
  MAX_LOGIN_ATTEMPTS,
  RESET_PASSWORD_TTL_SECONDS,
} from './auth.service.js';
import type { LoginDto } from './dto/login.dto.js';

// O argon2 real é caro de propósito (custo de senha); o teste mantém a
// implementação verdadeira e só espiona as chamadas para provar o tempo
// constante do caminho "usuário inexistente".
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return {
    ...actual,
    hash: vi.fn(actual.hash),
    verify: vi.fn(actual.verify),
  };
});

/** Dublê em memória do Redis (contadores, tokens e sessões). */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async set(
    key: string,
    value: string,
    mode: 'EX',
    ttl: number,
  ): Promise<'OK'> {
    this.calls.push({ method: 'set', args: [key, value, mode, ttl] });
    this.store.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.calls.push({ method: 'get', args: [key] });
    return this.store.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    this.calls.push({ method: 'del', args: [key] });
    return this.store.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    this.calls.push({ method: 'incr', args: [key] });
    const total = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(total));
    return total;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.calls.push({ method: 'expire', args: [key, seconds] });
    return 1;
  }

  disconnect(): void {
    this.calls.push({ method: 'disconnect', args: [] });
  }
}

const EMAIL = 'carlos.admin@netprofissional.com.br';
const PASSWORD = 'SenhaForte123!';
const NEW_PASSWORD = 'OutraSenha456!';

interface UserFixture {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
  operationalRole: string;
  status: string;
  passwordHash: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
}

const USUARIO_BASE: UserFixture = {
  id: 'user-1',
  tenantId: 'tenant-1',
  name: 'Carlos Admin',
  email: EMAIL,
  role: 'ADMIN',
  operationalRole: 'ADMIN',
  status: 'ACTIVE',
  passwordHash: '',
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  inviteToken: null,
  inviteExpiresAt: null,
};

type Fixture = typeof USUARIO_BASE;

const PUBLIC_USER = {
  id: USUARIO_BASE.id,
  name: USUARIO_BASE.name,
  email: EMAIL,
  role: 'ADMIN',
  operationalRole: 'ADMIN',
  status: 'ACTIVE',
  lastLoginAt: new Date('2026-10-28T12:00:00.000Z'),
  createdAt: USUARIO_BASE.createdAt,
};

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

describe('AuthService', () => {
  let redis: FakeRedis;
  let prisma: {
    user: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let sessionService: {
    create: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    destroyAllForUser: ReturnType<typeof vi.fn>;
  };
  let jwtService: { signAsync: ReturnType<typeof vi.fn> };
  let mail: {
    sendPasswordReset: ReturnType<typeof vi.fn>;
    sendAccountActivated: ReturnType<typeof vi.fn>;
  };
  let service: AuthService;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hash(PASSWORD);
  });

  beforeEach(() => {
    vi.mocked(verify).mockClear();
    vi.mocked(hash).mockClear();

    redis = new FakeRedis();

    prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(PUBLIC_USER),
      },
    };

    sessionService = {
      create: vi.fn().mockResolvedValue('sessao-1'),
      destroy: vi.fn().mockResolvedValue(undefined),
      destroyAllForUser: vi.fn().mockResolvedValue(undefined),
    };

    jwtService = { signAsync: vi.fn().mockResolvedValue('jwt-assinado') };

    mail = {
      sendPasswordReset: vi.fn().mockResolvedValue(undefined),
      sendAccountActivated: vi.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      sessionService as unknown as SessionService,
      jwtService as unknown as JwtService,
      new RedisService(redis),
      mail as unknown as MailService,
      redis,
    );
  });

  function makeUser(overrides: Partial<Fixture> = {}): Fixture {
    return { ...USUARIO_BASE, passwordHash, ...overrides };
  }

  const loginDto: LoginDto = { email: EMAIL, password: PASSWORD };

  describe('login', () => {
    it('devolve o usuário sem passwordHash e abre a sessão @spec:AC-037', async () => {
      const user = makeUser();
      prisma.user.findMany.mockResolvedValue([user]);

      const result = await service.login(loginDto);

      expect(result.sessionId).toBe('sessao-1');
      expect(result.token).toBe('jwt-assinado');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('inviteToken');
      expect(result.user.email).toBe(EMAIL);
      expect(sessionService.create).toHaveBeenCalledWith(user);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, sessionId: 'sessao-1' }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: user.id },
          data: { lastLoginAt: expect.any(Date) },
        }),
      );
    });

    it('normaliza o e-mail antes de buscar a conta', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser()]);

      await service.login({
        email: '  CARLOS.Admin@NetProfissional.com.BR ',
        password: PASSWORD,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: { equals: EMAIL, mode: 'insensitive' } },
        }),
      );
    });

    it('responde 401 INVALID_CREDENTIALS com senha errada e conta a tentativa @spec:AC-038', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser()]);

      const error = await catchBusinessError(
        service.login({ email: EMAIL, password: 'errada' }),
      );

      expect(error.getStatus()).toBe(401);
      expect(error.code).toBe('INVALID_CREDENTIALS');
      expect(redis.store.get(`ratelimit:login:${EMAIL}`)).toBe('1');
      expect(sessionService.create).not.toHaveBeenCalled();
    });

    it('responde 429 na 6ª tentativa errada, com retry_after_seconds de 900 @spec:AC-039', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser()]);

      for (let tentativa = 1; tentativa <= MAX_LOGIN_ATTEMPTS; tentativa += 1) {
        const erro = await catchBusinessError(
          service.login({ email: EMAIL, password: 'errada' }),
        );
        expect(erro.getStatus()).toBe(401);
      }

      expect(MAX_LOGIN_ATTEMPTS).toBe(5);
      expect(redis.store.get(`ratelimit:login:${EMAIL}`)).toBe('5');

      const error = await catchBusinessError(
        service.login({ email: EMAIL, password: 'errada' }),
      );

      expect(error.getStatus()).toBe(429);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.details).toEqual({ retry_after_seconds: 900 });
      expect(REDIS_TTL.loginRateLimit).toBe(900);
      // A 6ª tentativa nem chega ao banco: o bloqueio é antes da consulta.
      expect(prisma.user.findMany).toHaveBeenCalledTimes(MAX_LOGIN_ATTEMPTS);
    });

    it('zera o contador depois de um login bem-sucedido @spec:AC-040', async () => {
      redis.store.set(`ratelimit:login:${EMAIL}`, '3');
      prisma.user.findMany.mockResolvedValue([makeUser()]);

      await service.login(loginDto);

      expect(redis.store.has(`ratelimit:login:${EMAIL}`)).toBe(false);
    });

    it('responde 403 ACCOUNT_BLOCKED para conta bloqueada com a senha correta', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser({ status: 'BLOCKED' })]);

      const error = await catchBusinessError(service.login(loginDto));

      expect(error.getStatus()).toBe(403);
      expect(error.code).toBe('ACCOUNT_BLOCKED');
      expect(sessionService.create).not.toHaveBeenCalled();
    });

    it('não revela o bloqueio quando a senha está errada (401 antes do status) @spec:AC-041', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser({ status: 'BLOCKED' })]);

      const error = await catchBusinessError(
        service.login({ email: EMAIL, password: 'errada' }),
      );

      expect(error.getStatus()).toBe(401);
      expect(error.code).toBe('INVALID_CREDENTIALS');
    });

    it('responde 403 ACCOUNT_NOT_ACTIVE para conta pendente com a senha correta @spec:AC-042', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser({ status: 'PENDING' })]);

      const error = await catchBusinessError(service.login(loginDto));

      expect(error.getStatus()).toBe(403);
      expect(error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('responde 401 para e-mail inexistente executando um verify de tempo constante', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const error = await catchBusinessError(
        service.login(
          { email: 'ninguem@netprofissional.com.br', password: PASSWORD },
          '10.0.0.1',
        ),
      );

      expect(error.getStatus()).toBe(401);
      expect(error.code).toBe('INVALID_CREDENTIALS');

      const chamadas = vi.mocked(verify).mock.calls;
      expect(chamadas).toHaveLength(1);
      // Hash descartável (argon2id com os parâmetros padrão), nunca um hash real.
      expect(chamadas[0][0]).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
      expect(chamadas[0][0]).not.toBe(passwordHash);
      expect(chamadas[0][1]).toBe(PASSWORD);

      // Sem conta para contar, a tentativa é contada pelo IP.
      expect(redis.store.get('ratelimit:login:10.0.0.1')).toBe('1');
    });

    it('responde 401 quando o e-mail existe em mais de uma corporação', async () => {
      prisma.user.findMany.mockResolvedValue([
        makeUser(),
        makeUser({ id: 'user-2', tenantId: 'tenant-2' }),
      ]);

      const error = await catchBusinessError(service.login(loginDto));

      expect(error.getStatus()).toBe(401);
      expect(error.code).toBe('INVALID_CREDENTIALS');
      expect(sessionService.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('apaga a sessão informada', async () => {
      await expect(service.logout('sessao-1')).resolves.toEqual({
        loggedOut: true,
      });
      expect(sessionService.destroy).toHaveBeenCalledWith('sessao-1');
    });

    it('não quebra quando não há sessão', async () => {
      await expect(service.logout(undefined)).resolves.toEqual({
        loggedOut: true,
      });
      expect(sessionService.destroy).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('responde { sent: true } e grava reset:<token> com TTL de 900 s para conta ativa', async () => {
      const user = makeUser();
      prisma.user.findMany.mockResolvedValue([user]);

      await expect(service.forgotPassword({ email: EMAIL })).resolves.toEqual({
        sent: true,
      });

      const gravacao = redis.calls.find((call) => call.method === 'set');
      expect(gravacao).toBeDefined();

      if (!gravacao) {
        throw new Error('token de redefinição não foi gravado no Redis');
      }

      const [chave, valor, modo, ttl] = gravacao.args as [
        string,
        string,
        string,
        number,
      ];
      expect(chave).toMatch(/^reset:[0-9a-f-]{36}$/);
      expect(JSON.parse(valor)).toEqual({ userId: user.id });
      expect(modo).toBe('EX');
      expect(ttl).toBe(RESET_PASSWORD_TTL_SECONDS);
      expect(RESET_PASSWORD_TTL_SECONDS).toBe(900);

      const token = chave.slice('reset:'.length);
      expect(mail.sendPasswordReset).toHaveBeenCalledWith(
        user.email,
        user.name,
        token,
      );
    });

    it('responde { sent: true } sem gravar token para e-mail inexistente @spec:AC-048', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.forgotPassword({ email: 'ninguem@netprofissional.com.br' }),
      ).resolves.toEqual({ sent: true });

      expect(redis.calls.some((call) => call.method === 'set')).toBe(false);
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('responde { sent: true } sem token para conta que não está ativa', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser({ status: 'PENDING' })]);

      await expect(service.forgotPassword({ email: EMAIL })).resolves.toEqual({
        sent: true,
      });
      expect(redis.calls.some((call) => call.method === 'set')).toBe(false);
    });

    it('responde { sent: true } mesmo quando o envio de e-mail falha', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser()]);
      mail.sendPasswordReset.mockRejectedValue(new Error('SMTP fora do ar'));

      await expect(service.forgotPassword({ email: EMAIL })).resolves.toEqual({
        sent: true,
      });
    });
  });

  describe('resetPassword', () => {
    it('responde 410 TOKEN_EXPIRED quando o token não existe no Redis @spec:AC-049', async () => {
      const error = await catchBusinessError(
        service.resetPassword({
          token: 'token-inexistente',
          password: NEW_PASSWORD,
        }),
      );

      expect(error.getStatus()).toBe(410);
      expect(error.code).toBe('TOKEN_EXPIRED');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('responde 410 TOKEN_EXPIRED quando o valor guardado está corrompido', async () => {
      redis.store.set('reset:corrompido', 'nao-e-json');

      const error = await catchBusinessError(
        service.resetPassword({ token: 'corrompido', password: NEW_PASSWORD }),
      );

      expect(error.getStatus()).toBe(410);
      expect(error.code).toBe('TOKEN_EXPIRED');
    });

    it('grava o novo hash, apaga o token e revoga as sessões do usuário @spec:AC-050', async () => {
      const user = makeUser();
      redis.store.set(
        'reset:token-valido',
        JSON.stringify({ userId: user.id }),
      );
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      await expect(
        service.resetPassword({
          token: 'token-valido',
          password: NEW_PASSWORD,
        }),
      ).resolves.toEqual({ reset: true });

      const chamada = prisma.user.update.mock.calls[0][0] as {
        where: { id: string };
        data: { passwordHash: string };
      };
      expect(chamada.where).toEqual({ id: user.id });
      expect(chamada.data.passwordHash).not.toBe(passwordHash);
      await expect(
        verify(chamada.data.passwordHash, NEW_PASSWORD),
      ).resolves.toBe(true);

      expect(redis.store.has('reset:token-valido')).toBe(false);
      expect(sessionService.destroyAllForUser).toHaveBeenCalledWith(user.id);
    });

    it('responde 410 quando o token aponta para usuário que não existe mais', async () => {
      redis.store.set(
        'reset:orfao',
        JSON.stringify({ userId: 'user-fantasma' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);

      const error = await catchBusinessError(
        service.resetPassword({ token: 'orfao', password: NEW_PASSWORD }),
      );

      expect(error.getStatus()).toBe(410);
      expect(error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('activateAccount', () => {
    it('responde 410 quando o convite está vencido @spec:AC-051', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({
          status: 'PENDING',
          inviteExpiresAt: new Date(Date.now() - 60_000),
        }),
      );

      const error = await catchBusinessError(
        service.activateAccount({
          token: 'convite-velho',
          password: NEW_PASSWORD,
        }),
      );

      expect(error.getStatus()).toBe(410);
      expect(error.code).toBe('TOKEN_EXPIRED');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('responde 410 quando o token de convite não existe', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const error = await catchBusinessError(
        service.activateAccount({
          token: 'nao-existe',
          password: NEW_PASSWORD,
        }),
      );

      expect(error.getStatus()).toBe(410);
      expect(error.code).toBe('TOKEN_EXPIRED');
    });

    it('ativa a conta e limpa inviteToken/inviteExpiresAt @spec:AC-052', async () => {
      const user = makeUser({
        status: 'PENDING',
        inviteToken: 'convite-valido',
        inviteExpiresAt: new Date(
          Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000,
        ),
      });
      prisma.user.findFirst.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      await expect(
        service.activateAccount({
          token: 'convite-valido',
          password: NEW_PASSWORD,
        }),
      ).resolves.toEqual({ activated: true });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { inviteToken: 'convite-valido' },
      });

      const chamada = prisma.user.update.mock.calls[0][0] as {
        where: { id: string };
        data: {
          status: string;
          passwordHash: string;
          inviteToken: null;
          inviteExpiresAt: null;
        };
      };
      expect(chamada.where).toEqual({ id: user.id });
      expect(chamada.data.status).toBe('ACTIVE');
      expect(chamada.data.inviteToken).toBeNull();
      expect(chamada.data.inviteExpiresAt).toBeNull();
      await expect(
        verify(chamada.data.passwordHash, NEW_PASSWORD),
      ).resolves.toBe(true);

      expect(mail.sendAccountActivated).toHaveBeenCalledWith(
        user.email,
        user.name,
      );
    });
  });

  describe('me', () => {
    it('devolve usuário e corporação da sessão', async () => {
      const tenant = {
        id: 'tenant-1',
        name: 'Eletrominas',
        tradeName: 'Eletrominas Ltda',
      };
      prisma.user.findFirst.mockResolvedValue({ ...PUBLIC_USER, tenant });

      const result = await service.me({
        userId: 'user-1',
        tenantId: 'tenant-1',
        sessionId: 'sessao-1',
        role: 'ADMIN',
        operationalRole: 'ADMIN',
      });

      expect(result.tenant).toEqual(tenant);
      expect(result.user).not.toHaveProperty('tenant');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', tenantId: 'tenant-1' },
        }),
      );
    });

    it('responde 404 USER_NOT_FOUND quando o usuário saiu do tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const error = await catchBusinessError(
        service.me({
          userId: 'user-1',
          tenantId: 'tenant-1',
          sessionId: 'sessao-1',
          role: 'ADMIN',
          operationalRole: 'ADMIN',
        }),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.code).toBe('USER_NOT_FOUND');
    });
  });
});
