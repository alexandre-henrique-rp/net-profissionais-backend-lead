import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';
import type { CnpjData } from './cnpj.types.js';

/** Endpoint público da BrasilAPI usado no autopreenchimento do modal. */
const BRASIL_API_URL = 'https://brasilapi.com.br/api/cnpj/v1';

/** Tempo máximo de espera pela BrasilAPI — o modal não pode travar a tela. */
const REQUEST_TIMEOUT_MS = 8_000;

interface OpenCnpjResponse {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string | null;
  cnae_principal?: string;
  cnaes?: Array<{ codigo?: string; descricao?: string }>;
  capital_social?: string | number | null;
  porte_empresa?: string | null;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string | null;
  bairro?: string;
  municipio?: string;
  uf?: string;
  QSA?: Array<{
    nome_socio?: string | null;
    qualificacao_socio?: string | null;
  }>;
}

/**
 * Reduz o CNPJ a 14 dígitos, aceitando a máscara que o usuário digita
 * (`33.456.789/0001-02`). Documento com qualquer outra quantidade de dígitos
 * é inválido e devolve `null` sem bater na API.
 */
export function normalizeCnpj(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const digits = value.replace(/\D/g, '');

  return digits.length === 14 ? digits : null;
}

/**
 * Consulta de CNPJ na BrasilAPI com cache de 24h no Redis.
 *
 * Bloqueios e indisponibilidades da BrasilAPI usam OpenCNPJ como fallback.
 * Se os provedores falharem, a consulta devolve `null` para o cadastro seguir
 * com preenchimento manual em vez de propagar erro para o captador.
 */
@Injectable()
export class BrasilApiService {
  private readonly logger = new Logger(BrasilApiService.name);

  constructor(private readonly redis: RedisService) {}

  async lookupCnpj(cnpj: string): Promise<CnpjData | null> {
    const normalized = normalizeCnpj(cnpj);

    if (!normalized) {
      this.logger.warn(`CNPJ inválido ignorado na consulta: ${cnpj}`);
      return null;
    }

    const cached = await this.readCache(normalized);

    if (cached) {
      return cached;
    }

    const data = await this.fetchCnpj(normalized);

    if (!data) {
      return null;
    }

    await this.writeCache(normalized, data);

    return data;
  }

  /**
   * Leitura do cache. Redis fora do ar não pode derrubar o autopreenchimento:
   * vira cache miss com aviso no log.
   */
  private async readCache(cnpj: string): Promise<CnpjData | null> {
    try {
      const raw = await this.redis.getCnpjCache(cnpj);

      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as CnpjData;
    } catch (error) {
      this.logger.warn(
        `Falha ao ler o cache de CNPJ ${cnpj}: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  private async writeCache(cnpj: string, data: CnpjData): Promise<void> {
    try {
      await this.redis.setCnpjCache(cnpj, JSON.stringify(data));
    } catch (error) {
      this.logger.warn(
        `Falha ao gravar o cache de CNPJ ${cnpj}: ${errorMessage(error)}`,
      );
    }
  }

  private async fetchCnpj(cnpj: string): Promise<CnpjData | null> {
    try {
      const response = await fetch(`${BRASIL_API_URL}/${cnpj}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        return (await response.json()) as CnpjData;
      }

      if (!shouldUseOpenCnpj(response.status)) {
        this.logger.warn(
          `BrasilAPI respondeu ${response.status} para o CNPJ ${cnpj}`,
        );
        return null;
      }

      this.logger.warn(
        `BrasilAPI respondeu ${response.status} para o CNPJ ${cnpj}; tentando OpenCNPJ`,
      );
    } catch (error) {
      this.logger.warn(
        `Falha ao consultar a BrasilAPI para o CNPJ ${cnpj}: ${errorMessage(error)}; tentando OpenCNPJ`,
      );
    }

    return this.fetchOpenCnpj(cnpj);
  }

  private async fetchOpenCnpj(cnpj: string): Promise<CnpjData | null> {
    try {
      const response = await fetch(`https://api.opencnpj.org/${cnpj}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `OpenCNPJ respondeu ${response.status} para o CNPJ ${cnpj}`,
        );
        return null;
      }

      return mapOpenCnpjResponse((await response.json()) as OpenCnpjResponse);
    } catch (error) {
      this.logger.warn(
        `Falha ao consultar OpenCNPJ para o CNPJ ${cnpj}: ${errorMessage(error)}`,
      );
      return null;
    }
  }
}

/** A BrasilAPI costuma bloquear IPs de servidores com 403; indisponibilidades também fazem fallback. */
function shouldUseOpenCnpj(status: number): boolean {
  return status === 403 || status >= 500;
}

function mapOpenCnpjResponse(data: OpenCnpjResponse): CnpjData {
  const primaryCnae = data.cnae_principal?.replace(/\D/g, '') ?? null;
  const cnae = data.cnaes?.find(
    (item) => item.codigo?.replace(/\D/g, '') === primaryCnae,
  );
  const capitalSocial = parseCapitalSocial(data.capital_social);
  const normalizedSize = normalizeCompanySize(data.porte_empresa);

  return {
    cnpj: data.cnpj,
    razao_social: data.razao_social,
    nome_fantasia: data.nome_fantasia,
    cnae_fiscal: primaryCnae,
    cnae_fiscal_descricao: cnae?.descricao ?? null,
    capital_social: capitalSocial,
    cep: data.cep,
    logradouro: data.logradouro,
    numero: data.numero,
    complemento: data.complemento,
    bairro: data.bairro,
    municipio: data.municipio,
    uf: data.uf,
    porte: normalizedSize,
    qsa: data.QSA?.map((partner) => ({
      nome_socio: partner.nome_socio,
      qualificacao_socio: partner.qualificacao_socio,
    })),
  };
}

function parseCapitalSocial(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (!value) {
    return null;
  }

  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value;
  const parsed = Number(normalized.replace(/[^\d.-]/g, ''));

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCompanySize(value: string | null | undefined): string | null {
  const label = value
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!label) {
    return null;
  }
  if (label.includes('micro')) {
    return 'ME';
  }
  if (label.includes('pequeno') || label === 'epp') {
    return 'EPP';
  }
  if (label.includes('demais') || label === 'medio' || label === 'grande') {
    return 'DEMAIS';
  }

  return value ?? null;
}

/** Mensagem legível de um erro desconhecido (`throw` pode soltar qualquer coisa). */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
