// Teste rápido de conectividade: PostgreSQL (pg) e Redis (ioredis).
// Usa as mesmas libs do backend e lê DATABASE_URL / REDIS_URL do .env.
// Uso: node scripts/check-connections.mjs   (a partir de backend/)
import 'dotenv/config';
import pg from 'pg';
import { Redis } from 'ioredis';

function mask(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(URL inválida)';
  }
}

async function checkPostgres() {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, msg: 'DATABASE_URL não definida' };

  // O driver pg não entende o parâmetro ?schema= do Prisma; removemos.
  const clean = url.replace(/\?schema=[^&]*/i, '');
  const client = new pg.Client({ connectionString: clean, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const r = await client.query('select version() as v, current_database() as db, now() as agora');
    return {
      ok: true,
      msg: `OK · db=${r.rows[0].db} · ${String(r.rows[0].v).split(' ').slice(0, 2).join(' ')} · hora=${r.rows[0].agora.toISOString()}`,
    };
  } catch (e) {
    return { ok: false, msg: e.message };
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return { ok: false, msg: 'REDIS_URL não definida' };

  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 8000,
    retryStrategy: () => null, // não reconectar: falha rápido
  });
  client.on('error', () => {}); // silencia o log; tratamos no catch
  try {
    await client.connect();
    const pong = await client.ping();
    const info = await client.info('server');
    const ver = (info.match(/redis_version:(.+)/) || [])[1]?.trim() ?? '?';
    return { ok: true, msg: `OK · PING=${pong} · redis_version=${ver}` };
  } catch (e) {
    return { ok: false, msg: e.message };
  } finally {
    client.disconnect();
  }
}

const [pgUrl, redisUrl] = [process.env.DATABASE_URL, process.env.REDIS_URL];
console.log('PostgreSQL:', pgUrl ? mask(pgUrl) : '(sem DATABASE_URL)');
console.log('Redis     :', redisUrl ? mask(redisUrl) : '(sem REDIS_URL)');
console.log('');

const [pgRes, redisRes] = await Promise.all([checkPostgres(), checkRedis()]);

console.log(`[PostgreSQL] ${pgRes.ok ? '✅' : '❌'} ${pgRes.msg}`);
console.log(`[Redis]      ${redisRes.ok ? '✅' : '❌'} ${redisRes.msg}`);

process.exit(pgRes.ok && redisRes.ok ? 0 : 1);
