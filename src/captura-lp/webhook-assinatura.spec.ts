import { createHmac } from 'node:crypto';
import {
  JANELA_TIMESTAMP_SEGUNDOS,
  PREFIXO_ASSINATURA,
  assinarCorpo,
  montarCabecalhosDeEnvio,
} from './webhook-assinatura.js';

/** Segredo de teste — o token do webhook da corporação. */
const SEGREDO = 'whsec_teste_relay_2026';

/** Corpo de exemplo: o que a landing page entrega. */
const CORPO = '{"lead":{"document":"11222333000181","contacts":[{"name":"Ana Souza"}]}}';

describe('assinatura da entrega ao webhook', () => {
  it('AC-226: assina exatamente os bytes que vão no corpo @spec:AC-226', () => {
    const esperado = createHmac('sha256', SEGREDO)
      .update(CORPO, 'utf8')
      .digest('hex');

    expect(assinarCorpo(CORPO, SEGREDO)).toBe(esperado);

    // Um espaço a mais muda os bytes — e, portanto, a assinatura. É por isso
    // que o corpo é serializado uma única vez.
    expect(assinarCorpo(`${CORPO} `, SEGREDO)).not.toBe(esperado);
  });

  it('AC-226: o cabeçalho leva o hex do corpo no formato sha256= @spec:AC-226', () => {
    const cabecalhos = montarCabecalhosDeEnvio({
      corpoBruto: CORPO,
      segredo: SEGREDO,
      idempotencyKey: 'chave-1',
      agoraMs: 1_761_232_200_000,
    });

    expect(cabecalhos['X-Signature']).toBe(
      `${PREFIXO_ASSINATURA}${createHmac('sha256', SEGREDO).update(CORPO, 'utf8').digest('hex')}`,
    );
    expect(cabecalhos['X-Signature'].startsWith(PREFIXO_ASSINATURA)).toBe(true);
    expect(cabecalhos['Content-Type']).toBe('application/json');
  });

  it('AC-227: o timestamp é epoch em segundos dentro da janela de tolerância @spec:AC-227', () => {
    const agora = 1_761_232_200_000;
    const cabecalhos = montarCabecalhosDeEnvio({
      corpoBruto: CORPO,
      segredo: SEGREDO,
      idempotencyKey: 'chave-1',
      agoraMs: agora,
    });

    expect(cabecalhos['X-Timestamp']).toBe('1761232200');
    expect(Number(cabecalhos['X-Timestamp'])).toBe(
      Math.floor(agora / 1000),
    );

    // A janela é a mesma que o webhook aplica (5 minutos).
    expect(JANELA_TIMESTAMP_SEGUNDOS).toBe(300);
  });

  it('AC-227: toda entrega leva a chave de idempotência @spec:AC-227', () => {
    const cabecalhos = montarCabecalhosDeEnvio({
      corpoBruto: CORPO,
      segredo: SEGREDO,
      idempotencyKey: 'chave-estavel',
      agoraMs: 1_761_232_200_000,
    });

    expect(cabecalhos['Idempotency-Key']).toBe('chave-estavel');
  });
});
