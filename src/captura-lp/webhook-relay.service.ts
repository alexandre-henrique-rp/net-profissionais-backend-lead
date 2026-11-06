import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../common/errors/business.exception.js';
import { errorCodeForStatus } from '../common/http/http-exception.filter.js';
import {
  WEBHOOK_ERROR_CODES,
  type WebhookSource,
} from '../webhook/webhook.constants.js';
import type { WebhookLeadPayloadDto } from '../webhook/dto/webhook-payload.dto.js';
import { montarCabecalhosDeEnvio } from './webhook-assinatura.js';

/**
 * Token que identifica o `fetch` usado nas entregas.
 *
 * Existe para que o teste e2e possa trocar o transporte por um dublê sem
 * precisar de rede — e para deixar explícito que **esta** é a única saída
 * HTTP do módulo.
 */
export const CAPTURA_FETCH = Symbol('CAPTURA_FETCH');

/**
 * Token que identifica a configuração do relé.
 *
 * A configuração vem do ambiente (`env.ts` é o único lugar do backend que lê
 * as variáveis de ambiente); o token existe para que o teste troque a
 * configuração sem mexer no ambiente.
 */
export const CAPTURA_CONFIG = Symbol('CAPTURA_CONFIG');

/**
 * Token que identifica o relógio do relé.
 *
 * Existe para o teste avançar o tempo sem esperar: é o que permite provar que
 * uma repetição que passa da janela de ±5 minutos reassina com timestamp
 * novo.
 */
export const CAPTURA_RELOGIO = Symbol('CAPTURA_RELOGIO');

/** Resposta mínima que o relé sabe ler. */
export interface RespostaDoWebhook {
  status: number;
  text(): Promise<string>;
}

/** Transporte das entregas ao webhook. */
export type CapturaFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<RespostaDoWebhook>;

/** Configuração do relé, lida do ambiente. */
export interface ConfiguracaoCaptura {
  /** Token do webhook (HMAC). Secreto: nunca sai do servidor. */
  token?: string;
  /** UUID da corporação que recebe os leads. */
  tenantId?: string;
  /** Base da API do webhook (sem barra no fim). */
  apiBase: string;
}

/** Resultado de uma entrega bem-sucedida. */
export interface ResultadoDoReley {
  /** Status devolvido pelo webhook (201 para lead novo, 200 para reenvio). */
  status: number;
  /** Conteúdo de `data` na resposta do webhook. */
  dados: unknown;
}

/** Quantas vezes o relé tenta entregar antes de desistir. */
const MAX_TENTATIVAS = 3;

/** Tempo limite de cada tentativa, em milissegundos. */
const TEMPO_LIMITE_MS = 8000;

/** Código de contrato quando a integração não está configurada no ambiente. */
export const CODIGO_CAPTURA_NAO_CONFIGURADA = 'CAPTURA_NAO_CONFIGURADA';

/** Código de contrato quando o webhook não respondeu. */
export const CODIGO_WEBHOOK_INDISPONIVEL = 'WEBHOOK_INDISPONIVEL';

/** Origem padrão quando a página não informa de onde veio. */
const ORIGEM_PADRAO: WebhookSource = 'landing_page';

/** Só dígitos: o documento é CNPJ (14) ou CPF (11). */
const DOCUMENTO_RE = /^(\d{11}|\d{14})$/;

/** Remove tudo que não é dígito — a máscara do documento não importa. */
export function somenteDigitos(valor: string): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/** Lê o `code` de um envelope de erro do webhook. */
function extrairCodigo(corpo: string): string | undefined {
  try {
    const objeto = JSON.parse(corpo) as {
      error?: { code?: unknown };
      code?: unknown;
    };

    const codigo = objeto?.error?.code ?? objeto?.code;

    return typeof codigo === 'string' && codigo !== '' ? codigo : undefined;
  } catch {
    return undefined;
  }
}

/** Lê a `message` de um envelope de erro do webhook. */
function extrairMensagem(corpo: string): string | undefined {
  try {
    const objeto = JSON.parse(corpo) as { error?: { message?: unknown } };
    const mensagem = objeto?.error?.message;

    return typeof mensagem === 'string' && mensagem !== '' ? mensagem : undefined;
  } catch {
    return undefined;
  }
}

/** Lê o `data` da resposta de sucesso do webhook. */
function extrairDados(corpo: string): unknown {
  try {
    const objeto = JSON.parse(corpo) as { data?: unknown };

    return objeto?.data ?? objeto;
  } catch {
    return undefined;
  }
}

/**
 * Relé entre a landing page e o webhook de captura.
 *
 * A landing page é HTML e JavaScript puro: qualquer segredo no código
 * entregue ao navegador é segredo público. O relé resolve isso — valida o
 * corpo, assina com o token do ambiente e encaminha para o webhook, que
 * continua sendo o único caminho de entrada do lead.
 *
 * Regras que o código garante:
 * - o corpo é serializado **uma vez**; o HMAC é calculado sobre esses bytes e
 *   o mesmo texto vai no corpo (assinatura sobre outro texto é 401);
 * - erro 4xx do webhook **não** repete (é erro de integrador ou credencial);
 * - erro 5xx e timeout repetem com o **mesmo** `Idempotency-Key`, para o
 *   reenvio não virar lead duplicado;
 * - o log nunca carrega o token nem o corpo com os dados da pessoa.
 */
@Injectable()
export class WebhookRelayService {
  private readonly logger = new Logger(WebhookRelayService.name);

  constructor(
    @Inject(CAPTURA_FETCH) private readonly transporte: CapturaFetch,
    @Inject(CAPTURA_CONFIG) private readonly configuracao: ConfiguracaoCaptura,
    @Inject(CAPTURA_RELOGIO) private readonly relogio: () => number,
  ) {}

  /**
   * Entrega o lead ao webhook.
   *
   * @param payload corpo já validado pelo `ValidationPipe` (o mesmo DTO do
   *   webhook: o contrato da landing page é o contrato do webhook).
   * @param chaveDeIdempotencia chave estável do pedido — a mesma em todas as
   *   tentativas.
   */
  async encaminhar(
    payload: WebhookLeadPayloadDto,
    chaveDeIdempotencia: string,
  ): Promise<ResultadoDoReley> {
    const configuracao = this.configuracao;

    if (!configuracao.token || !configuracao.tenantId) {
      // Sem segredo não há entrega possível: o erro diz o que falta, sem
      // expor o valor (que nem existe) e sem encaminhar nada.
      throw new BusinessException(
        503,
        CODIGO_CAPTURA_NAO_CONFIGURADA,
        'A captura da landing page não está configurada neste ambiente.',
      );
    }

    this.validarCorpo(payload);

    const corpo = this.montarCorpo(payload);
    const corpoBruto = JSON.stringify(corpo);
    const url = `${configuracao.apiBase.replace(/\/+$/, '')}/webhooks/leads/${configuracao.tenantId}`;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
      // Cada tentativa reassina: se a repetição cair fora da janela de ±5
      // minutos do `X-Timestamp`, a assinatura antiga seria recusada.
      const cabecalhos = montarCabecalhosDeEnvio({
        corpoBruto,
        segredo: configuracao.token,
        idempotencyKey: chaveDeIdempotencia,
        agoraMs: this.relogio(),
      });

      const controlador = new AbortController();
      const temporizador = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS);

      try {
        const resposta = await this.transporte(url, {
          method: 'POST',
          headers: cabecalhos,
          body: corpoBruto,
          signal: controlador.signal,
        });

        const texto = await resposta.text();

        if (resposta.status >= 500) {
          // Falha do servidor: vale tentar de novo, com a mesma chave.
          this.logger.warn(
            `webhook respondeu ${resposta.status} (tentativa ${tentativa}/${MAX_TENTATIVAS}) idempotency=${chaveDeIdempotencia}`,
          );
          continue;
        }

        if (resposta.status >= 400) {
          const codigo =
            extrairCodigo(texto) ?? errorCodeForStatus(resposta.status);
          const mensagem =
            extrairMensagem(texto) ?? 'O webhook recusou o lead enviado.';

          this.logger.warn(
            `webhook recusou o lead: status=${resposta.status} codigo=${codigo} idempotency=${chaveDeIdempotencia}`,
          );

          throw new BusinessException(resposta.status, codigo, mensagem);
        }

        const dados = extrairDados(texto);

        this.logger.log(
          `lead entregue: status=${resposta.status} idempotency=${chaveDeIdempotencia}`,
        );

        return { status: resposta.status, dados };
      } catch (erro) {
        if (erro instanceof BusinessException) {
          // 4xx: não repete — o problema é do integrador ou da credencial.
          throw erro;
        }

        this.logger.warn(
          `falha ao entregar o lead (tentativa ${tentativa}/${MAX_TENTATIVAS}): ${
            erro instanceof Error ? erro.name : 'erro desconhecido'
          } idempotency=${chaveDeIdempotencia}`,
        );
      } finally {
        clearTimeout(temporizador);
      }
    }

    throw new BusinessException(
      502,
      CODIGO_WEBHOOK_INDISPONIVEL,
      'Não foi possível entregar o lead agora. Tente de novo em instantes.',
    );
  }

  /**
   * Confere o corpo antes de encaminhar.
   *
   * Melhor dar o erro aqui do que levar um 400 do webhook depois — e o
   * consentimento LGPD é conferido aqui porque a captura sem consentimento
   * não pode chegar nem a ser tentada.
   */
  private validarCorpo(payload: WebhookLeadPayloadDto): void {
    if (payload.lgpd_consent !== true) {
      throw new BusinessException(
        422,
        WEBHOOK_ERROR_CODES.lgpdConsentRequired,
        'O lead precisa do consentimento LGPD marcado.',
      );
    }

    const documento = somenteDigitos(payload.lead?.document ?? '');

    if (!DOCUMENTO_RE.test(documento)) {
      throw new BusinessException(
        400,
        WEBHOOK_ERROR_CODES.validationError,
        'O documento do lead precisa ter 11 (CPF) ou 14 (CNPJ) dígitos.',
      );
    }

    const tipoEsperado = documento.length === 14 ? 'PJ' : 'PF';

    if (payload.lead.person_type && payload.lead.person_type !== tipoEsperado) {
      throw new BusinessException(
        400,
        WEBHOOK_ERROR_CODES.validationError,
        'O tipo do lead não combina com o documento informado.',
      );
    }

    const contatos = payload.lead.contacts ?? [];

    if (
      contatos.length === 0 ||
      contatos.some((contato) => (contato.name ?? '').trim().length < 2)
    ) {
      throw new BusinessException(
        400,
        WEBHOOK_ERROR_CODES.validationError,
        'O lead precisa de ao menos um contato com nome.',
      );
    }
  }

  /**
   * Monta o corpo que vai ao webhook.
   *
   * O documento vai só com dígitos (a máscara é do formulário) e a origem
   * padrão é a landing page.
   */
  private montarCorpo(payload: WebhookLeadPayloadDto): unknown {
    const documento = somenteDigitos(payload.lead.document);
    const lead = payload.lead;

    const corpo: Record<string, unknown> = {
      lead: {
        document: documento,
        person_type:
          lead.person_type ?? (documento.length === 14 ? 'PJ' : 'PF'),
        company_name: lead.company_name,
        trade_name: lead.trade_name,
        message: lead.message,
        contacts: lead.contacts,
        address: lead.address,
      },
      lgpd_consent: true,
      source: payload.source ?? payload.channel ?? ORIGEM_PADRAO,
    };

    if (payload.consent_at) {
      corpo.consent_at = payload.consent_at;
    }

    if (payload.metadata && Object.keys(payload.metadata).length > 0) {
      corpo.metadata = payload.metadata;
    }

    return corpo;
  }
}
