import { validateEnv } from '../../config/env.js';
import { decryptSecret, encryptSecret, maskSecret } from './aisa-crypto.js';

describe('aisa-crypto', () => {
  beforeAll(() => {
    validateEnv({
      DATABASE_URL: 'postgresql://u:s@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      APP_ENCRYPTION_KEY: 'chave-de-teste-aisa-aes-256',
    });
  });
  it('cifra e decifra segredos com AES-256-GCM sem expor o texto original @spec:AC-238', () => {
    const raw = 'sk-aisa-super-secreta-987654';
    const encrypted = encryptSecret(raw);

    expect(encrypted).toMatch(/^enc:v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(encrypted).not.toContain(raw);
    expect(decryptSecret(encrypted)).toBe(raw);
  });

  it('retorna null para payloads inválidos ou corrompidos @spec:AC-238', () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret('')).toBeNull();
    expect(decryptSecret('texto-plano')).toBeNull();
    expect(decryptSecret('enc:v1:abc:def:123')).toBeNull();
  });

  it('mascara a chave exibindo apenas prefixo e sufixo @spec:AC-238', () => {
    expect(maskSecret('sk-aisa-1234567890')).toBe('sk-...7890');
    expect(maskSecret('curta')).toBe('••••');
    expect(maskSecret('   ')).toBeNull();
  });
});
