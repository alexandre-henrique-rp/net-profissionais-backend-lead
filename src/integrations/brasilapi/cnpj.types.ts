import type {
  CompanySize,
  TenantSector,
} from '../../generated/prisma/client.js';

/**
 * Sócio do Quadro de Sócios e Administradores (QSA) devolvido pela BrasilAPI.
 * Os campos chegam sem normalização — podem vir nulos ou ausentes.
 */
export interface CnpjPartner {
  nome_socio?: string | null;
  qualificacao_socio?: string | null;
  cnpj_cpf_do_socio?: string | null;
}

/**
 * Recorte do payload `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` que o
 * MVP realmente usa no cadastro híbrido (`03-C-D.Modal-CadastroLead`).
 *
 * Todos os campos são opcionais de propósito: a Receita Federal devolve
 * registros incompletos e o modal precisa continuar abrindo com o que existe.
 */
export interface CnpjData {
  cnpj?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cnae_fiscal?: number | string | null;
  cnae_fiscal_descricao?: string | null;
  capital_social?: number | string | null;
  descricao_situacao_cadastral?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  ddd_telefone_1?: string | null;
  qsa?: CnpjPartner[] | null;
  porte?: string | null;
}

/** Contato extraído do QSA, pronto para virar `LeadContact`. */
export interface MappedCnpjContact {
  name: string;
  role: string | null;
  isDecisionMaker: boolean;
}

/**
 * Payload de autopreenchimento do modal de cadastro — nomes já no formato do
 * `POST /leads/manual`, para o frontend despejar direto no formulário.
 */
export interface MappedCnpjLeadInput {
  companyName: string | null;
  tradeName: string | null;
  primaryCnae: string | null;
  cnaeDescription: string | null;
  capitalSocial: number | null;
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  sector: TenantSector;
  companySize: CompanySize | null;
  contacts: MappedCnpjContact[];
}
