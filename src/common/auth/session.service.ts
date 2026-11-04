import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  REDIS_CLIENT,
  REDIS_TTL,
  RedisService,
  type RedisLike,
} from '../../redis/redis.service.js';
import type { AuthOperationalRole, AuthRole, AuthUser } from './auth.types.js';

/** Nome do cookie HttpOnly que carrega o id da sessão. */
export const SESSION_COOKIE_NAME = 'np_session';

/** Índice `sess:user:<userId>` → ids de sessão abertos daquele usuário. */
export const sessionIndexKey = (userId: string): string =>
  `sess:user:${userId}`;

/**
 * Operações de conjunto usadas pelo índice de sessões.
 *
 * O `RedisService` só expõe chave única (`get`/`set`/`del`); bloquear um
 * usuário exige saber *quais* sessões são dele. Por isso o serviço usa o
 * cliente bruto quando ele está disponível, sem alterar o `RedisService`.
 */
interface SessionIndexClient extends Partial<RedisLike> {
  sadd?(key: string, ...members: string[]): Promise<unknown>;
  srem?(key: string, ...members: string[]): Promise<unknown>;
  smembers?(key: string): Promise<string[]>;
}

/** Dados mínimos para abrir uma sessão. */
export interface SessionUser {
  id: string;
  tenantId: string;
  role: string;
  operationalRole: string;
}

const AUTH_ROLES: readonly string[] = ['ADMIN', 'USUARIO'];
const OPERATIONAL_ROLES: readonly string[] = ['ADMIN', 'CAPTADOR', 'VENDEDOR'];

function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === 'string' && AUTH_ROLES.includes(value);
}

function isOperationalRole(value: unknown): value is AuthOperationalRole {
  return typeof value === 'string' && OPERATIONAL_ROLES.includes(value);
}

/**
 * Sessão autenticada apoiada no Redis (`sess:<id>`, TTL de 8h).
 *
 * Fonte única de verdade do login: se a chave sumiu, o usuário está deslogado —
 * inclusive quando um administrador bloqueia a conta (as sessões do usuário são
 * apagadas em `destroyAllForUser`).
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly redis: RedisService,
    /**
     * Opcional de propósito: o `RedisModule` pode não exportar o token do
     * cliente. Sem ele, apenas o índice por usuário fica indisponível — a
     * sessão continua funcionando normalmente.
     */
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly client?: SessionIndexClient,
  ) {}

  /** Abre a sessão e devolve o id que vai no cookie. */
  async create(user: SessionUser): Promise<string> {
    const sessionId = randomUUID();

    const authUser: AuthUser = {
      userId: user.id,
      tenantId: user.tenantId,
      sessionId,
      // A origem dos valores é o banco (enums do Prisma); o cast só evita
      // que cada chamador precise repetir a união literal.
      role: user.role as AuthRole,
      operationalRole: user.operationalRole as AuthOperationalRole,
    };

    await this.redis.setSession(sessionId, JSON.stringify(authUser));
    await this.index(user.id, sessionId);

    return sessionId;
  }

  /** Lê a sessão; devolve `null` se não existir, expirou ou está corrompida. */
  async read(sessionId: string): Promise<AuthUser | null> {
    const raw = await this.redis.getSession(sessionId);

    if (!raw) {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSON corrompido equivale a sessão inválida — nunca estoura 500.
      return null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;

    if (
      typeof record.userId !== 'string' ||
      typeof record.tenantId !== 'string' ||
      !isAuthRole(record.role) ||
      !isOperationalRole(record.operationalRole)
    ) {
      return null;
    }

    return {
      userId: record.userId,
      tenantId: record.tenantId,
      // O id vem da chave consultada: dado antigo/sem `sessionId` não invalida.
      sessionId,
      role: record.role,
      operationalRole: record.operationalRole,
    };
  }

  /** Encerra a sessão (logout). */
  async destroy(sessionId: string): Promise<void> {
    const authUser = await this.safeRead(sessionId);

    await this.redis.deleteSession(sessionId);

    if (authUser) {
      await this.unindex(authUser.userId, sessionId);
    }
  }

  /** Encerra todas as sessões do usuário (bloqueio, troca de senha). */
  async destroyAllForUser(userId: string): Promise<void> {
    const client = this.client;

    if (!client?.smembers) {
      return;
    }

    let sessionIds: string[];

    try {
      sessionIds = await client.smembers(sessionIndexKey(userId));
    } catch (error) {
      // `error`, não `warn`: sem o índice a revogação em massa (bloqueio, troca
      // de senha) não alcança as sessões abertas — é falha de segurança.
      this.logger.error(
        `Não foi possível ler o índice de sessões de ${userId}: ${(error as Error).message}`,
      );
      return;
    }

    if (sessionIds.length === 0) {
      return;
    }

    await Promise.all(
      sessionIds.map((sessionId) => this.redis.deleteSession(sessionId)),
    );
    await this.unindex(userId, ...sessionIds);
  }

  private async safeRead(sessionId: string): Promise<AuthUser | null> {
    try {
      return await this.read(sessionId);
    } catch (error) {
      this.logger.warn(
        `Falha ao ler a sessão ${sessionId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Mantém o índice do usuário alinhado ao TTL da sessão.
   *
   * Falha de índice não pode derrubar o login (a sessão já está válida em
   * `sess:<id>`), mas precisa de `error`: sem índice o usuário deixa de ser
   * revogável em massa até a sessão expirar sozinha.
   */
  private async index(userId: string, sessionId: string): Promise<void> {
    const client = this.client;

    if (!client?.sadd) {
      return;
    }

    try {
      await client.sadd(sessionIndexKey(userId), sessionId);
      await client.expire?.(sessionIndexKey(userId), REDIS_TTL.session);
    } catch (error) {
      this.logger.error(
        `Falha ao indexar a sessão de ${userId}: ${(error as Error).message}`,
      );
    }
  }

  private async unindex(
    userId: string,
    ...sessionIds: string[]
  ): Promise<void> {
    const client = this.client;

    if (!client?.srem) {
      return;
    }

    try {
      await client.srem(sessionIndexKey(userId), ...sessionIds);
    } catch (error) {
      this.logger.error(
        `Falha ao remover sessões do índice de ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
