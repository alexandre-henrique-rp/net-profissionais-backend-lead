import type { CompanySize } from '../../generated/prisma/client.js';
import { deriveSectorFromCnae } from '../../leads/cnae-sector.js';
import type {
  CnpjData,
  MappedCnpjContact,
  MappedCnpjLeadInput,
} from './cnpj.types.js';

/**
 * Remove acentos e normaliza para maiúsculas — usado só para interpretar o
 * `porte` da Receita, que vem como texto livre ("Micro Empresa", "DEMAIS"...).
 */
function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Traduz o `porte` fiscal para o enum do produto.
 *
 * `MEI` também é microempresa para efeito de filtro: a BrasilAPI devolve
 * `"MEI"` nesse caso e, sem o mapeamento, o lead sumia de `company_size=ME`.
 *
 * Desconhecido vira `null`: inventar `ME` num lead sem porte distorceria os
 * filtros do Pool (`company_size=ME`), que são lidos pela Receita.
 */
export function mapCompanySize(porte?: string | null): CompanySize | null {
  if (!porte) {
    return null;
  }

  const label = normalizeLabel(porte);

  if (label === 'ME' || label === 'MEI' || label.includes('MICRO')) {
    return 'ME';
  }

  if (label === 'EPP' || label.includes('PEQUENO PORTE')) {
    return 'EPP';
  }

  if (label === 'DEMAIS' || label.includes('DEMAIS')) {
    return 'DEMAIS';
  }

  return null;
}

/** Converte número/string em `number` finito, ou `null`. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/** Texto aparado, com vazio virando `null`. */
function toText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extrai os sócios do QSA como contatos decisores.
 *
 * A Receita não tem campo de e-mail/telefone por sócio, então o modal abre com
 * nome e qualificação e o captador completa o resto.
 */
function mapPartners(data: CnpjData): MappedCnpjContact[] {
  const partners = Array.isArray(data.qsa) ? data.qsa : [];

  return partners.flatMap((partner) => {
    const name = toText(partner?.nome_socio);

    if (!name) {
      return [];
    }

    return [
      {
        name,
        role: toText(partner?.qualificacao_socio),
        isDecisionMaker: true,
      },
    ];
  });
}

/**
 * Mapeador puro (sem I/O) do payload da BrasilAPI para o formato do cadastro
 * híbrido. Fica separado do serviço para poder ser testado sem rede e Redis.
 */
export function mapCnpjToLeadInput(data: CnpjData): MappedCnpjLeadInput {
  const cnae = toNumber(data.cnae_fiscal);

  return {
    companyName: toText(data.razao_social),
    tradeName: toText(data.nome_fantasia),
    primaryCnae: cnae === null ? null : String(cnae),
    cnaeDescription: toText(data.cnae_fiscal_descricao),
    capitalSocial: toNumber(data.capital_social),
    postalCode: toText(data.cep),
    street: toText(data.logradouro),
    number: toText(data.numero),
    complement: toText(data.complemento),
    neighborhood: toText(data.bairro),
    city: toText(data.municipio),
    state: toText(data.uf)?.toUpperCase().slice(0, 2) ?? null,
    sector: deriveSectorFromCnae(data.cnae_fiscal),
    companySize: mapCompanySize(data.porte),
    contacts: mapPartners(data),
  };
}
