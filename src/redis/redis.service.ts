import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/** Token de injeção do cliente Redis — permite trocar o cliente no teste. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Prefixos de chave do Redis (doc/mvp/specs/task-s01-06.md).
 *
 * `sess:`            sessão autenticada
 * `cache:cnpj:`      cache da consulta de CNPJ
 * `ratelimit:login:` contador de tentativas de login
 */
export const REDIS_KEYS = {
  session: (sessionId: string) => `sess:${sessionId}`,
  cnpjCache: (cnpj: string) => `cache:cnpj:${cnpj}`,
  loginRateLimit: (key: string) => `ratelimit:login:${key}`,
} as const;

/** Tempos de vida das chaves, em segundos. */
export const REDIS_TTL = {
  /** Sessão autenticada: 8 horas. */
  session: 8 * 60 * 60,
  /** Cache de CNPJ: 24 horas. */
  cnpjCache: 24 * 60 * 60,
  /** Janela de proteção contra força bruta no login: 15 minutos. */
  loginRateLimit: 15 * 60,
} as const;

/**
 * Contrato mínimo do cliente Redis usado pelo serviço.
 * O `ioredis` satisfaz esta interface; o teste usa um dublê.
 */
export interface RedisLike {
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  disconnect(): void;
}

/**
 * Cria o cliente Redis a partir do `REDIS_URL`.
 *
 * `lazyConnect` deixa a conexão para o primeiro comando: o processo sobe
 * mesmo com o Redis fora do ar, e o erro aparece na hora de usar.
 */
export function createRedisClient(): Redis {
  const client = new Redis(env().REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
  });

  // Sem este listener, um erro de conexão derrubaria o processo inteiro.
  client.on('error', (error: Error) => {
    console.error(`[redis] ${error.message}`);
  });

  return client;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: RedisLike;

  constructor(@Optional() @Inject(REDIS_CLIENT) client?: RedisLike) {
    this.redis = client ?? createRedisClient();
  }

  async setSession(sessionId: string, value: string, ttl: number = REDIS_TTL.session): Promise<void> {
    await this.redis.set(REDIS_KEYS.session(sessionId), value, 'EX', ttl);
  }

  async getSession(sessionId: string): Promise<string | null> {
    return this.redis.get(REDIS_KEYS.session(sessionId));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.session(sessionId));
  }

  async setCnpjCache(cnpj: string, value: string, ttl: number = REDIS_TTL.cnpjCache): Promise<void> {
    await this.redis.set(REDIS_KEYS.cnpjCache(cnpj), value, 'EX', ttl);
  }

  async getCnpjCache(cnpj: string): Promise<string | null> {
    return this.redis.get(REDIS_KEYS.cnpjCache(cnpj));
  }

  /**
   * Incrementa o contador de tentativas de login e devolve o total.
   * A janela de 15 minutos só é renovada na primeira tentativa.
   */
  async incrementLoginRateLimit(
    key: string,
    ttl: number = REDIS_TTL.loginRateLimit,
  ): Promise<number> {
    const redisKey = REDIS_KEYS.loginRateLimit(key);
    const total = await this.redis.incr(redisKey);

    if (total === 1) {
      await this.redis.expire(redisKey, ttl);
    }

    return total;
  }

  async onModuleDestroy(): Promise<void> {
    // `disconnect` e não `quit`: o cliente pode nunca ter conectado
    // (lazyConnect) e o `quit` nesse estado estoura "Stream isn't writeable".
    this.redis.disconnect();
  }
}
