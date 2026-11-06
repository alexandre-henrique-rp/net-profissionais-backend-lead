import { Logger } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BusinessException } from '../common/errors/business.exception.js';
import type { WebhookLeadPayloadDto } from '../webhook/dto/webhook-payload.dto.js';
import {
  type CapturaFetch,
  type ConfiguracaoCaptura,
} from './webhook-relay.service.js';
import {
  CODIGO_CAPTURA_NAO_CONFIGURADA,
  CODIGO_WEBHOOK_INDISPONIVEL,
  WebhookRelayService,
} from './webhook-relay.service.js';

/** Segredo de teste — o token do webhook da corporação. */
const SEGREDO = 'whsec_teste_relay_2026';

/** Corporação de teste. */
const TENANT = '1209f89d-8328-80f5-8008-d08667c53da5';

const CONFIGURACAO: ConfiguracaoCaptura = {
  token: SEGREDO,
  tenantId: TENANT,
  apiBase: 'http://api.test/api/v1',
};

interface Chamada {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  };
}

interface RespostaFalsa {
  status: number;
  corpo?: unknown;
  texto?: string;
}

/**
 * Transporte falso: devolve as respostas da fila e guarda o que foi enviado.
 *
 * A última resposta da fila se repete — é assim que se simula "o webhook
 * continua fora do ar".
 */
function transporteFalso(
  respostas: RespostaFalsa[],
  aoEnviar?: (indice: number) => void,
): { fn: CapturaFetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];

  const fn: CapturaFetch = async (url, init) => {
    const indice = chamadas.length;

    chamadas.push({ url, init });
    aoEnviar?.(indice);

    const resposta = respostas[Math.min(indice, respostas.length - 1)];

    return {
      status: resposta.status,
      text: async () =>
        resposta.texto ?? JSON.stringify(resposta.corpo ?? {}),
    };
  };

  return { fn, chamadas };
}

/** Corpo válido de uma entrega da landing page. */
function payloadValido(
  extras: Record<string, unknown> = {},
): WebhookLeadPayloadDto {
  return {
    lead: {
      document: '11222333000181',
      company_name: 'Teste Integracao Externa',
      contacts: [
        {
          name: 'Ana Souza',
          phone: '31999998888',
          email: 'ana@exemplo.com.br',
        },
      ],
    },
    lgpd_consent: true,
    consent_at: '2026-11-06T14:30:00.000Z',
    source: 'landing_page',
    ...extras,
  } as unknown as WebhookLeadPayloadDto;
}

/** Cria o relé com transporte, configuração e relógio controlados. */
function criarRelé(
  transporte: CapturaFetch,
  configuracao: ConfiguracaoCaptura = CONFIGURACAO,
  relogio: () => number = () => 1_761_232_200_000,
): WebhookRelayService {
  return new WebhookRelayService(transporte, configuracao, relogio);
}

/** Executa e devolve o erro lançado (ou `null`). */
async function capturarErro(
  fn: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await fn();

    return null;
  } catch (error) {
    return error;
  }
}

/** Asserção de erro de negócio: status HTTP + código de contrato. */
function expectBusinessError(
  erro: unknown,
  status: number,
  code: string,
): void {
  expect(erro).toBeInstanceOf(BusinessException);
  expect((erro as BusinessException).getStatus()).toBe(status);
  expect((erro as BusinessException).code).toBe(code);
}

describe('relé da landing page', () => {
  it('AC-225: sem segredo no ambiente a rota recusa e nada é encaminhado @spec:AC-225', async () => {
    const { fn, chamadas } = transporteFalso([{ status: 201 }]);
    const rele = criarRelé(fn, {
      token: undefined,
      tenantId: TENANT,
      apiBase: 'http://api.test/api/v1',
    });

    const erro = await capturarErro(() => rele.encaminhar(payloadValido(), 'chave-1'));

    expectBusinessError(erro, 503, CODIGO_CAPTURA_NAO_CONFIGURADA);
    expect(chamadas).toHaveLength(0);
  });

  it('AC-225: o segredo não está escrito no código do módulo @spec:AC-225', () => {
    const pasta = resolve(dirname(fileURLToPath(import.meta.url)));

    // Só o código que vai para produção: o teste tem um segredo falso de
    // propósito, e ele não é publicado.
    const arquivos = readdirSync(pasta).filter(
      (nome) => nome.endsWith('.ts') && !nome.endsWith('.spec.ts'),
    );

    expect(arquivos.length).toBeGreaterThan(0);

    for (const arquivo of arquivos) {
      const conteudo = readFileSync(join(pasta, arquivo), 'utf8');

      // Nenhum segredo literal: o token vem do ambiente.
      expect(conteudo).not.toMatch(/whsec_[A-Za-z0-9_]{8,}/);
      expect(conteudo).not.toMatch(/token\s*[:=]\s*['"][^'"]{8,}['"]/);
    }
  });

  it('AC-228: o sucesso do webhook chega como sucesso, com o identificador do lead @spec:AC-228', async () => {
    const { fn, chamadas } = transporteFalso([
      {
        status: 201,
        corpo: {
          success: true,
          data: {
            tenant_lead_id: 'lead-op-1',
            lead_id: 'lead-1',
            duplicate: false,
          },
        },
      },
    ]);
    const rele = criarRelé(fn);

    const resultado = await rele.encaminhar(payloadValido(), 'chave-1');

    expect(resultado.status).toBe(201);
    expect(resultado.dados).toMatchObject({
      tenant_lead_id: 'lead-op-1',
      lead_id: 'lead-1',
      duplicate: false,
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(
      `http://api.test/api/v1/webhooks/leads/${TENANT}`,
    );
  });

  it('AC-229: o reenvio idempotente volta como 200 sem criar lead novo @spec:AC-229', async () => {
    const { fn, chamadas } = transporteFalso([
      {
        status: 200,
        corpo: {
          success: true,
          data: {
            tenant_lead_id: 'lead-op-1',
            lead_id: 'lead-1',
            duplicate: true,
          },
        },
      },
    ]);
    const rele = criarRelé(fn);

    const resultado = await rele.encaminhar(payloadValido(), 'chave-1');

    expect(resultado.status).toBe(200);
    expect(resultado.dados).toMatchObject({ duplicate: true });
    expect(chamadas).toHaveLength(1);
  });

  it('AC-230: lead sem consentimento LGPD é recusado antes de encaminhar @spec:AC-230', async () => {
    for (const consentimento of [false, undefined]) {
      const { fn, chamadas } = transporteFalso([{ status: 201 }]);
      const rele = criarRelé(fn);

      const erro = await capturarErro(() =>
        rele.encaminhar(payloadValido({ lgpd_consent: consentimento }), 'chave-1'),
      );

      expectBusinessError(erro, 422, 'LGPD_CONSENT_REQUIRED');
      expect(chamadas).toHaveLength(0);
    }
  });

  it('AC-231: documento inválido é recusado antes de encaminhar @spec:AC-231', async () => {
    const { fn, chamadas } = transporteFalso([{ status: 201 }]);
    const rele = criarRelé(fn);

    const erro = await capturarErro(() =>
      rele.encaminhar(
        payloadValido({
          lead: {
            document: '1234567890',
            contacts: [{ name: 'Ana Souza' }],
          },
        }),
        'chave-1',
      ),
    );

    expectBusinessError(erro, 400, 'VALIDATION_ERROR');
    expect(chamadas).toHaveLength(0);
  });

  it('AC-232: contato sem nome é recusado antes de encaminhar @spec:AC-232', async () => {
    for (const contatos of [[], [{ name: 'A' }], [{}]]) {
      const { fn, chamadas } = transporteFalso([{ status: 201 }]);
      const rele = criarRelé(fn);

      const erro = await capturarErro(() =>
        rele.encaminhar(
          payloadValido({
            lead: { document: '11222333000181', contacts: contatos },
          }),
          'chave-1',
        ),
      );

      expectBusinessError(erro, 400, 'VALIDATION_ERROR');
      expect(chamadas).toHaveLength(0);
    }
  });

  it('AC-233: erro de credencial não é repetido @spec:AC-233', async () => {
    const { fn, chamadas } = transporteFalso([
      {
        status: 401,
        corpo: {
          success: false,
          error: { code: 'INVALID_SIGNATURE', message: 'Assinatura inválida.' },
        },
      },
    ]);
    const rele = criarRelé(fn);

    const erro = await capturarErro(() => rele.encaminhar(payloadValido(), 'chave-1'));

    expectBusinessError(erro, 401, 'INVALID_SIGNATURE');
    expect(chamadas).toHaveLength(1);
  });

  it('AC-234: falha de servidor é repetida com a mesma chave de idempotência @spec:AC-234', async () => {
    const { fn, chamadas } = transporteFalso([{ status: 500, corpo: {} }]);
    const rele = criarRelé(fn);

    const erro = await capturarErro(() => rele.encaminhar(payloadValido(), 'chave-1'));

    expectBusinessError(erro, 502, CODIGO_WEBHOOK_INDISPONIVEL);
    expect(chamadas.length).toBeGreaterThan(1);

    const chaves = chamadas.map((chamada) => chamada.init.headers['Idempotency-Key']);

    expect(new Set(chaves)).toEqual(new Set(['chave-1']));
  });

  it('AC-234: a repetição que passa de 5 minutos reassina com timestamp novo @spec:AC-234', async () => {
    let agora = 1_761_232_200_000;

    const { fn, chamadas } = transporteFalso([{ status: 500, corpo: {} }], () => {
      // cada tentativa passa seis minutos: a segunda está fora da janela
      agora += 6 * 60 * 1000;
    });
    const rele = criarRelé(fn, CONFIGURACAO, () => agora);

    await capturarErro(() => rele.encaminhar(payloadValido(), 'chave-1'));

    const timestamps = chamadas.map(
      (chamada) => chamada.init.headers['X-Timestamp'],
    );

    expect(timestamps.length).toBeGreaterThan(1);
    expect(timestamps[1]).not.toBe(timestamps[0]);

    // e a assinatura da segunda tentativa casa com o corpo reenviado
    const { createHmac } = await import('node:crypto');
    const esperada = createHmac('sha256', SEGREDO)
      .update(chamadas[1].init.body, 'utf8')
      .digest('hex');

    expect(chamadas[1].init.headers['X-Signature']).toBe(`sha256=${esperada}`);
  });

  it('AC-235: o log não carrega o segredo nem o corpo do lead @spec:AC-235', async () => {
    const registros: string[] = [];
    const espiaoLog = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((mensagem: unknown, ...resto: unknown[]) => {
        registros.push([mensagem, ...resto].map(String).join(' '));
      });
    const espiaoWarn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((mensagem: unknown, ...resto: unknown[]) => {
        registros.push([mensagem, ...resto].map(String).join(' '));
      });

    try {
      const { fn } = transporteFalso([{ status: 201, corpo: { success: true, data: {} } }]);
      const rele = criarRelé(fn);

      await rele.encaminhar(payloadValido(), 'chave-1');

      expect(registros.length).toBeGreaterThan(0);

      const texto = registros.join('\n');

      expect(texto).not.toContain(SEGREDO);
      expect(texto).not.toContain('ana@exemplo.com.br');
      expect(texto).not.toContain('31999998888');
      expect(texto).not.toContain('11222333000181');
    } finally {
      espiaoLog.mockRestore();
      espiaoWarn.mockRestore();
    }
  });

  it('AC-237: o corpo encaminhado é o contrato do webhook @spec:AC-237', async () => {
    const { fn, chamadas } = transporteFalso([{ status: 201, corpo: { success: true, data: {} } }]);
    const rele = criarRelé(fn);

    await rele.encaminhar(payloadValido(), 'chave-1');

    const corpo = JSON.parse(chamadas[0].init.body);

    expect(corpo.lead.document).toBe('11222333000181');
    expect(corpo.lead.person_type).toBe('PJ');
    expect(Array.isArray(corpo.lead.contacts)).toBe(true);
    expect(corpo.lead.contacts[0].name).toBe('Ana Souza');
    expect(corpo.lgpd_consent).toBe(true);
    expect(corpo.source).toBe('landing_page');
  });

  it('AC-226: a assinatura enviada é a do corpo que vai no corpo @spec:AC-226', async () => {
    const { fn, chamadas } = transporteFalso([{ status: 201, corpo: { success: true, data: {} } }]);
    const rele = criarRelé(fn);

    await rele.encaminhar(payloadValido(), 'chave-1');

    const { createHmac } = await import('node:crypto');
    const esperada = createHmac('sha256', SEGREDO)
      .update(chamadas[0].init.body, 'utf8')
      .digest('hex');

    expect(chamadas[0].init.headers['X-Signature']).toBe(`sha256=${esperada}`);
    expect(chamadas[0].init.headers['Content-Type']).toBe('application/json');
  });
});
