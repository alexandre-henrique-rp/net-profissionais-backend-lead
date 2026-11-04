import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, validateEnv } from './env.js';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('configuração de ambiente', () => {
  it('converte a porta para número e limpa as origens do CORS @spec:AC-014', () => {
    const config = validateEnv({
      DATABASE_URL: 'postgresql://u:s@servidor:5432/db',
      REDIS_URL: 'redis://servidor:6379',
      PORT: '3000',
      CORS_ORIGIN: 'http://localhost:5173, https://app.netprofissional.com.br',
    });

    expect(config.PORT).toBe(3000);
    expect(config.CORS_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://app.netprofissional.com.br',
    ]);
  });

  it('usa a porta e a origem padrão quando não vêm do ambiente', () => {
    const config = validateEnv({
      DATABASE_URL: 'postgresql://u:s@servidor:5432/db',
      REDIS_URL: 'redis://servidor:6379',
    });

    expect(config.PORT).toBe(3000);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('rejeita uma porta que não é número @spec:AC-014', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgresql://u:s@servidor:5432/db',
        REDIS_URL: 'redis://servidor:6379',
        PORT: 'trinta',
      }),
    ).toThrow(/PORT/);
  });

  it('nomeia a variável que falta no erro @spec:AC-013', () => {
    expect(() => validateEnv({ REDIS_URL: 'redis://servidor:6379' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://u:s@servidor:5432/db' })).toThrow(/REDIS_URL/);
  });

  it('expõe a configuração validada pelo accessor', () => {
    const config = env();

    expect(config.DATABASE_URL).toBeTruthy();
    expect(config.REDIS_URL).toBeTruthy();
    expect(Array.isArray(config.CORS_ORIGINS)).toBe(true);
  });

  it('mantém a leitura do ambiente só no módulo de configuração @spec:AC-015', () => {
    const pastaSrc = path.join(backendRoot, 'src');
    const infratores: string[] = [];

    const varre = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        if (entrada.name === 'generated' || entrada.name === 'config') continue;

        const completo = path.join(dir, entrada.name);

        if (entrada.isDirectory()) {
          varre(completo);
          continue;
        }

        if (!/\.(ts|tsx)$/.test(entrada.name) || entrada.name.endsWith('.spec.ts')) continue;

        const conteudo = readFileSync(completo, 'utf-8');
        if (/process\.env/.test(conteudo)) {
          infratores.push(path.relative(backendRoot, completo));
        }
      }
    };

    varre(pastaSrc);

    expect(infratores).toEqual([]);
  });
});
