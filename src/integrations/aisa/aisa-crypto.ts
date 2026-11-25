import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { env } from '../../config/env.js';

const PREFIX = 'enc:v1:';
const IV_LENGTH = 12;

/** Deriva uma chave AES-256 determinística a partir de `APP_ENCRYPTION_KEY` ou `JWT_SECRET`. */
function deriveKey(): Buffer {
  const config = env();
  const secret = config.APP_ENCRYPTION_KEY ?? config.JWT_SECRET;
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Cifra um segredo com AES-256-GCM antes de persistir no banco. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decifra um segredo armazenado com `encryptSecret`. Retorna `null` se inválido. */
export function decryptSecret(
  payload: string | null | undefined,
): string | null {
  if (!payload || !payload.startsWith(PREFIX)) {
    return null;
  }

  const parts = payload.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    return null;
  }

  const [ivHex, tagHex, cipherHex] = parts;

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(cipherHex, 'hex');

    if (iv.length !== IV_LENGTH || tag.length !== 16) {
      return null;
    }

    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/** Mascara uma chave para exibição segura na UI sem vazar o segredo real. */
export function maskSecret(plaintext: string | null | undefined): string | null {
  const value = plaintext?.trim();
  if (!value) {
    return null;
  }

  if (value.length <= 8) {
    return '••••';
  }

  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}
