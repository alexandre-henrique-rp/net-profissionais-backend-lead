import { createHmac } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessException } from '../common/errors/business.exception.js';
import { SIGNATURE_TOLERANCE_SECONDS } from './webhook.constants.js';
import {
  assertSignatureIsValid,
  computeSignature,
  extractRawBody,
  normalizeSignature,
  parseTimestampSeconds,
  signaturesMatch,
} from './webhook.signature.js';

/** Segredo de teste — o `webhookToken` da corporação. */
const SEGREDO = 'whsec_teste_eletrominas_2026';

/** Corpo canônico usado na maioria dos casos. */
const CORPO = Buffer.from('{"cnpj":"12345678000190","nome":"Eletro Minas"}', 'utf8');

/** Epoch em segundos de `agora - segundos`. */
const epochSegundosAtras = (segundos: number): string =>
  String(Math.floor(Date.now() / 1000) - segundos);

/** ISO 8601 de `agora - segundos`. */
const isoSegundosAtras = (segundos: number): string =>
  new Date(Date.now() - segundos * 1000).toISOString();

/** Executa a função e devolve o erro lançado (ou `null` se não lançou). */
function capturarErro(fn: () => void): unknown {
  try {
    fn();

    return null;
  } catch (error) {
    return error;
  }
}

/** Asserção de erro de negócio: status HTTP + código de contrato. */
function expectBusinessError(fn: () => void, status: number, code: string): void {
  const error = capturarErro(fn);

  expect(error).toBeInstanceOf(BusinessException);
  expect((error as BusinessException).getStatus()).toBe(status);
  expect((error as BusinessException).code).toBe(code);
}

/** Requisição mínima para `extractRawBody` (só os dois campos lidos). */
function requisicao(
  rawBody: Buffer | undefined,
  body: unknown,
): RawBodyRequest<Request> {
  return { rawBody, body } as unknown as RawBodyRequest<Request>;
}

/** Executa a validação completa de assinatura (o que o guard e o service chamam). */
function validar(params: { signature?: string; timestamp?: string; rawBody?: Buffer; secret?: string }): void {
  assertSignatureIsValid({
    rawBody: params.rawBody ?? CORPO,
    secret: params.secret ?? SEGREDO,
    signature: params.signature,
    timestamp: params.timestamp,
  });
}

describe('computeSignature', () => {
  it('é HMAC-SHA256 com a chave do webhook (vetor conhecido)', () => {
    const corpo = Buffer.from('The quick brown fox jumps over the lazy dog', 'utf8');

    // Vetor público do HMAC-SHA256: chave "key", mesma mensagem.
    expect(computeSignature(corpo, 'key')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
    expect(computeSignature(corpo, SEGREDO)).toBe(
      createHmac('sha256', SEGREDO).update(corpo).digest('hex'),
    );
  });

  it('assina o corpo bruto: espaços e ordem de chaves mudam a assinatura @spec:AC-108', () => {
    // Corpo "torto" de propósito: o JSON.stringify do objeto parseado o reordena
    // e remove os espaços. Se o HMAC fosse calculado sobre o objeto, as duas
    // assinaturas seriam iguais — sobre os bytes crus, não são.
    const bruto = Buffer.from('{ "nome": "Eletro Minas",  "cnpj": "12345678000190" }', 'utf8');
    const reserializado = Buffer.from(JSON.stringify(JSON.parse(bruto.toString('utf8'))), 'utf8');

    expect(bruto.equals(reserializado)).toBe(false);
    expect(computeSignature(bruto, SEGREDO)).not.toBe(
      computeSignature(reserializado, SEGREDO),
    );
  });

  it('é hexadecimal de 64 caracteres (SHA-256)', () => {
    expect(computeSignature(CORPO, SEGREDO)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('normalizeSignature', () => {
  it('remove o prefixo sha256=, aparar espaços e baixa a caixa', () => {
    expect(normalizeSignature('sha256=ABC123')).toBe('abc123');
    expect(normalizeSignature('  ABC123  ')).toBe('abc123');
    expect(normalizeSignature('SHA256=abc123')).toBe('abc123');
  });
});

describe('signaturesMatch', () => {
  const esperada = computeSignature(CORPO, SEGREDO);

  it('aceita `sha256=<hex>` e `<hex>`, em maiúsculas ou minúsculas', () => {
    expect(signaturesMatch(esperada, esperada)).toBe(true);
    expect(signaturesMatch(esperada, `sha256=${esperada}`)).toBe(true);
    expect(signaturesMatch(esperada, `SHA256=${esperada.toUpperCase()}`)).toBe(true);
    expect(signaturesMatch(esperada, esperada.toUpperCase())).toBe(true);
    expect(signaturesMatch(esperada, `  ${esperada}  `)).toBe(true);
  });

  it('recusa assinatura de outro segredo', () => {
    const outra = computeSignature(CORPO, 'outro-segredo');

    expect(signaturesMatch(esperada, outra)).toBe(false);
  });

  it('assinatura de tamanho diferente devolve false sem estourar RangeError', () => {
    // `timingSafeEqual` lança quando os buffers têm tamanhos diferentes: a
    // checagem de tamanho precisa acontecer antes.
    expect(() => signaturesMatch(esperada, 'abc')).not.toThrow();
    expect(signaturesMatch(esperada, 'abc')).toBe(false);
    // 32 caracteres hex = 16 bytes (metade do SHA-256), hex válido.
    expect(signaturesMatch(esperada, esperada.slice(0, 32))).toBe(false);
    expect(signaturesMatch(esperada, `${esperada}00`)).toBe(false);
  });

  it('assinatura não-hexadecimal devolve false', () => {
    expect(signaturesMatch(esperada, 'z'.repeat(64))).toBe(false);
    expect(signaturesMatch(esperada, `sha256=${'g'.repeat(64)}`)).toBe(false);
    expect(signaturesMatch(esperada, '')).toBe(false);
    expect(signaturesMatch(esperada, 'sha256=')).toBe(false);
  });
});

describe('parseTimestampSeconds', () => {
  it('aceita epoch em segundos', () => {
    expect(parseTimestampSeconds('1761232200')).toBe(1761232200);
    expect(parseTimestampSeconds(' 1761232200 ')).toBe(1761232200);
  });

  it('aceita ISO 8601 e converte para segundos', () => {
    expect(parseTimestampSeconds('2026-10-23T14:30:00Z')).toBe(
      Math.floor(Date.parse('2026-10-23T14:30:00Z') / 1000),
    );
    expect(parseTimestampSeconds('2026-10-23T14:30:00.000Z')).toBe(
      Math.floor(Date.parse('2026-10-23T14:30:00.000Z') / 1000),
    );
  });

  it('devolve null para ausente ou inválido', () => {
    expect(parseTimestampSeconds(undefined)).toBeNull();
    expect(parseTimestampSeconds('')).toBeNull();
    expect(parseTimestampSeconds('   ')).toBeNull();
    expect(parseTimestampSeconds('ontem')).toBeNull();
    expect(parseTimestampSeconds('2026-13-45T99:99:99Z')).toBeNull();
  });
});

describe('extractRawBody', () => {
  it('usa req.rawBody quando o app expõe o corpo bruto', () => {
    const bruto = Buffer.from('{ "b": 1, "a": 2 }', 'utf8');

    expect(extractRawBody(requisicao(bruto, { a: 2, b: 1 }))).toBe(bruto);
  });

  it('cai para JSON.stringify(req.body) quando não há corpo bruto', () => {
    const corpo = extractRawBody(requisicao(undefined, { b: 1, a: 2 }));

    expect(corpo.toString('utf8')).toBe('{"b":1,"a":2}');
  });

  it('corpo ausente vira objeto vazio (nunca estoura)', () => {
    expect(extractRawBody(requisicao(undefined, undefined)).toString('utf8')).toBe('{}');
  });
});

describe('assertSignatureIsValid', () => {
  const assinatura = `sha256=${computeSignature(CORPO, SEGREDO)}`;

  it('aceita assinatura correta com X-Timestamp de 4 minutos atrás', () => {
    expect(() =>
      validar({ signature: assinatura, timestamp: epochSegundosAtras(4 * 60) }),
    ).not.toThrow();
  });

  it('aceita X-Timestamp em ISO 8601 dentro da janela', () => {
    expect(() =>
      validar({ signature: assinatura, timestamp: isoSegundosAtras(4 * 60) }),
    ).not.toThrow();
  });

  it('recusa X-Timestamp de 6 minutos atrás (proteção contra replay)', () => {
    expectBusinessError(
      () => validar({ signature: assinatura, timestamp: epochSegundosAtras(6 * 60) }),
      401,
      'INVALID_SIGNATURE',
    );
    expect(SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });

  it('recusa X-Timestamp no futuro além da tolerância', () => {
    expectBusinessError(
      () => validar({ signature: assinatura, timestamp: epochSegundosAtras(-6 * 60) }),
      401,
      'INVALID_SIGNATURE',
    );
  });

  it('recusa requisição sem X-Timestamp', () => {
    expectBusinessError(() => validar({ signature: assinatura }), 401, 'INVALID_SIGNATURE');
  });

  it('recusa requisição sem X-Signature', () => {
    expectBusinessError(
      () => validar({ timestamp: epochSegundosAtras(0) }),
      401,
      'INVALID_SIGNATURE',
    );
  });

  it('recusa assinatura calculada com outro segredo', () => {
    expectBusinessError(
      () =>
        validar({
          signature: `sha256=${computeSignature(CORPO, 'segredo-errado')}`,
          timestamp: epochSegundosAtras(0),
        }),
      401,
      'INVALID_SIGNATURE',
    );
  });

  it('recusa corpo adulterado mesmo com timestamp válido', () => {
    expectBusinessError(
      () =>
        validar({
          rawBody: Buffer.from('{"cnpj":"99999999000199"}', 'utf8'),
          signature: assinatura,
          timestamp: epochSegundosAtras(0),
        }),
      401,
      'INVALID_SIGNATURE',
    );
  });
});
