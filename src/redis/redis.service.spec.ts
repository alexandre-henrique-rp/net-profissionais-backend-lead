import { REDIS_KEYS, REDIS_TTL, RedisService, type RedisLike } from './redis.service.js';

/** Dublê em memória do cliente Redis — registra as chamadas feitas. */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async set(key: string, value: string, mode: 'EX', ttl: number): Promise<'OK'> {
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

describe('RedisService', () => {
  let redis: FakeRedis;
  let service: RedisService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new RedisService(redis);
  });

  it('grava a sessão na chave sess: com validade de 8 horas @spec:AC-008', async () => {
    await service.setSession('abc123', '{"userId":"u1"}');

    expect(redis.store.get('sess:abc123')).toBe('{"userId":"u1"}');
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['sess:abc123', '{"userId":"u1"}', 'EX', REDIS_TTL.session],
    });
    expect(REDIS_TTL.session).toBe(8 * 60 * 60);
  });

  it('lê a sessão pela mesma chave @spec:AC-008', async () => {
    await service.setSession('abc123', 'valor');

    await expect(service.getSession('abc123')).resolves.toBe('valor');
    expect(redis.calls).toContainEqual({ method: 'get', args: ['sess:abc123'] });
  });

  it('apaga a sessão ao encerrar @spec:AC-008', async () => {
    await service.setSession('abc123', 'valor');
    await service.deleteSession('abc123');

    expect(redis.store.has('sess:abc123')).toBe(false);
    expect(redis.calls).toContainEqual({ method: 'del', args: ['sess:abc123'] });
  });

  it('guarda o cache de CNPJ em cache:cnpj: com validade de 24 horas @spec:AC-009', async () => {
    await service.setCnpjCache('33456789000102', '{"razaoSocial":"Solar Tech"}');

    expect(redis.store.get('cache:cnpj:33456789000102')).toBe('{"razaoSocial":"Solar Tech"}');
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['cache:cnpj:33456789000102', '{"razaoSocial":"Solar Tech"}', 'EX', REDIS_TTL.cnpjCache],
    });
    expect(REDIS_TTL.cnpjCache).toBe(24 * 60 * 60);
  });

  it('conta as tentativas de login e abre a janela de 15 minutos só na primeira @spec:AC-010', async () => {
    await expect(service.incrementLoginRateLimit('1.2.3.4')).resolves.toBe(1);
    await expect(service.incrementLoginRateLimit('1.2.3.4')).resolves.toBe(2);

    expect(redis.calls).toContainEqual({ method: 'incr', args: ['ratelimit:login:1.2.3.4'] });
    expect(redis.calls).toContainEqual({
      method: 'expire',
      args: ['ratelimit:login:1.2.3.4', REDIS_TTL.loginRateLimit],
    });
    expect(REDIS_TTL.loginRateLimit).toBe(15 * 60);
    expect(redis.calls.filter((call) => call.method === 'expire')).toHaveLength(1);
  });

  it('usa os prefixos de chave documentados @spec:AC-010', () => {
    expect(REDIS_KEYS.session('x')).toBe('sess:x');
    expect(REDIS_KEYS.cnpjCache('x')).toBe('cache:cnpj:x');
    expect(REDIS_KEYS.loginRateLimit('x')).toBe('ratelimit:login:x');
  });
});
