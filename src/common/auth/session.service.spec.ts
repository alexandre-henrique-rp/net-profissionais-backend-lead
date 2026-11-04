import {
  REDIS_TTL,
  RedisService,
  type RedisLike,
} from '../../redis/redis.service.js';
import { SessionService, sessionIndexKey } from './session.service.js';

/** Dublê em memória do Redis, com os comandos de conjunto do índice. */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly ttls = new Map<string, number>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async set(
    key: string,
    value: string,
    mode: 'EX',
    ttl: number,
  ): Promise<'OK'> {
    this.calls.push({ method: 'set', args: [key, value, mode, ttl] });
    this.store.set(key, value);
    this.ttls.set(key, ttl);
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
    const total = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(total));
    return total;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.calls.push({ method: 'expire', args: [key, seconds] });
    this.ttls.set(key, seconds);
    return 1;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.calls.push({ method: 'sadd', args: [key, ...members] });
    const set = this.sets.get(key) ?? new Set<string>();
    members.forEach((member) => set.add(member));
    this.sets.set(key, set);
    return members.length;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    this.calls.push({ method: 'srem', args: [key, ...members] });
    const set = this.sets.get(key);

    if (!set) {
      return 0;
    }

    members.forEach((member) => set.delete(member));
    return members.length;
  }

  async smembers(key: string): Promise<string[]> {
    this.calls.push({ method: 'smembers', args: [key] });
    return [...(this.sets.get(key) ?? [])];
  }

  disconnect(): void {
    this.calls.push({ method: 'disconnect', args: [] });
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER = {
  id: 'user-1',
  tenantId: 'tenant-1',
  role: 'ADMIN',
  operationalRole: 'VENDEDOR',
};

describe('SessionService', () => {
  let redis: FakeRedis;
  let service: SessionService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new SessionService(new RedisService(redis), redis);
  });

  it('abre a sessão em sess:<id> com validade de 8 horas @spec:AC-043', async () => {
    const sessionId = await service.create(USER);

    expect(sessionId).toMatch(UUID_PATTERN);
    expect(redis.store.has(`sess:${sessionId}`)).toBe(true);
    expect(redis.ttls.get(`sess:${sessionId}`)).toBe(REDIS_TTL.session);
    expect(REDIS_TTL.session).toBe(8 * 60 * 60);
  });

  it('grava na sessão o usuário completo (com sessionId e papéis)', async () => {
    const sessionId = await service.create(USER);
    const raw = redis.store.get(`sess:${sessionId}`);

    expect(JSON.parse(raw as string)).toEqual({
      userId: USER.id,
      tenantId: USER.tenantId,
      sessionId,
      role: 'ADMIN',
      operationalRole: 'VENDEDOR',
    });
  });

  it('indexa a sessão no conjunto do usuário', async () => {
    const sessionId = await service.create(USER);

    expect(redis.sets.get(sessionIndexKey(USER.id))?.has(sessionId)).toBe(true);
    expect(redis.calls).toContainEqual({
      method: 'expire',
      args: [sessionIndexKey(USER.id), REDIS_TTL.session],
    });
  });

  it('lê a sessão de volta como AuthUser completo', async () => {
    const sessionId = await service.create(USER);

    await expect(service.read(sessionId)).resolves.toEqual({
      userId: USER.id,
      tenantId: USER.tenantId,
      sessionId,
      role: 'ADMIN',
      operationalRole: 'VENDEDOR',
    });
  });

  it('devolve null para sessão inexistente', async () => {
    await expect(service.read('nao-existe')).resolves.toBeNull();
  });

  it('devolve null quando o JSON da sessão está corrompido', async () => {
    redis.store.set('sess:corrompida', '{nao-e-json');

    await expect(service.read('corrompida')).resolves.toBeNull();
  });

  it('devolve null quando faltam campos obrigatórios na sessão', async () => {
    redis.store.set(
      'sess:sem-tenant',
      JSON.stringify({ userId: 'u1', role: 'ADMIN', operationalRole: 'ADMIN' }),
    );
    redis.store.set(
      'sess:sem-role',
      JSON.stringify({
        userId: 'u1',
        tenantId: 't1',
        operationalRole: 'ADMIN',
      }),
    );
    redis.store.set(
      'sess:papel-invalido',
      JSON.stringify({
        userId: 'u1',
        tenantId: 't1',
        role: 'SUPER',
        operationalRole: 'ADMIN',
      }),
    );
    redis.store.set(
      'sess:operacional-invalido',
      JSON.stringify({
        userId: 'u1',
        tenantId: 't1',
        role: 'ADMIN',
        operationalRole: 'GESTOR',
      }),
    );
    redis.store.set('sess:nao-objeto', JSON.stringify('texto'));

    await expect(service.read('sem-tenant')).resolves.toBeNull();
    await expect(service.read('sem-role')).resolves.toBeNull();
    await expect(service.read('papel-invalido')).resolves.toBeNull();
    await expect(service.read('operacional-invalido')).resolves.toBeNull();
    await expect(service.read('nao-objeto')).resolves.toBeNull();
  });

  it('apaga a chave da sessão ao encerrar', async () => {
    const sessionId = await service.create(USER);

    await service.destroy(sessionId);

    expect(redis.store.has(`sess:${sessionId}`)).toBe(false);
    expect(
      redis.sets.get(sessionIndexKey(USER.id))?.has(sessionId) ?? false,
    ).toBe(false);
  });

  it('encerra todas as sessões do usuário pelo índice @spec:AC-044', async () => {
    const primeira = await service.create(USER);
    const segunda = await service.create(USER);
    const deOutroUsuario = await service.create({ ...USER, id: 'user-2' });

    await service.destroyAllForUser(USER.id);

    expect(redis.store.has(`sess:${primeira}`)).toBe(false);
    expect(redis.store.has(`sess:${segunda}`)).toBe(false);
    // A sessão de outra pessoa continua viva.
    expect(redis.store.has(`sess:${deOutroUsuario}`)).toBe(true);
    expect(redis.sets.get(sessionIndexKey(USER.id))?.size ?? 0).toBe(0);
  });

  it('não lança ao encerrar em massa sem o cliente de índice', async () => {
    const semIndice = new SessionService(new RedisService(redis));
    const sessionId = await semIndice.create(USER);

    await expect(semIndice.destroyAllForUser(USER.id)).resolves.toBeUndefined();
    // Sem índice, a sessão individual continua acessível (o TTL a expira).
    expect(redis.store.has(`sess:${sessionId}`)).toBe(true);
  });

  it('não lança quando o índice está vazio', async () => {
    await expect(
      service.destroyAllForUser('usuario-sem-sessao'),
    ).resolves.toBeUndefined();
  });

  it('não lança quando a leitura do índice falha', async () => {
    const comFalha = {
      ...redis,
      smembers: async () => {
        throw new Error('redis fora do ar');
      },
    };
    const resiliente = new SessionService(new RedisService(redis), comFalha);

    await expect(
      resiliente.destroyAllForUser(USER.id),
    ).resolves.toBeUndefined();
  });
});
