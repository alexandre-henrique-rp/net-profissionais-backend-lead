import type { Prisma } from '../generated/prisma/client.js';

/**
 * Relações devolvidas em toda resposta de lead: etapa do funil, dados da
 * empresa e contatos (decisor principal primeiro).
 *
 * Os contatos são filtrados pelo `tenantId` da sessão: o `Lead` é a identidade
 * fiscal **global** do cliente, mas `LeadContact` é dado pessoal de quem o
 * cadastrou (LGPD). Sem o filtro, um tenant que cadastra o CNPJ de um cliente
 * já atendido por outra corporação receberia telefone, e-mail e aniversário
 * dos decisores alheios na resposta.
 */
export function tenantLeadInclude(tenantId: string) {
  return {
    stage: true,
    lead: {
      include: {
        contacts: {
          where: { tenantId },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    },
  } satisfies Prisma.TenantLeadInclude;
}

/** `TenantLead` com as relações acima já resolvidas. */
export type TenantLeadWithRelations = Prisma.TenantLeadGetPayload<{
  include: ReturnType<typeof tenantLeadInclude>;
}>;

export interface LeadContactResponse {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  birthday: Date | null;
  isPrimary: boolean;
  isDecisionMaker: boolean;
}

export interface LeadResponse {
  id: string;
  personType: string;
  cnpj: string | null;
  cpf: string | null;
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
  sector: string;
  companySize: string | null;
  temperature: string | null;
  temperatureScore: number | null;
  createdAt: Date;
  updatedAt: Date;
  contacts: LeadContactResponse[];
}

export interface StageResponse {
  id: string;
  name: string;
  code: string;
  position: number;
  colorHex: string;
  isLostStage: boolean;
}

/**
 * Resposta de um lead no Pool: o `TenantLead` da corporação + a identidade
 * (`lead`) + a etapa. `ticketValue` sai como `number` porque `Decimal` do
 * Prisma não sobrevive ao JSON.
 */
export interface TenantLeadResponse {
  id: string;
  tenantId: string;
  leadId: string;
  stageId: string;
  assignedUserId: string | null;
  creatorUserId: string | null;
  status: string;
  ticketValue: number | null;
  closeProbability: number | null;
  expectedCloseDate: Date | null;
  proposalScope: string | null;
  customSector: string | null;
  lossReasonCode: string | null;
  lossReasonNotes: string | null;
  version: number;
  lastContactAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lead: LeadResponse;
  stage: StageResponse;
  contacts: LeadContactResponse[];
}

/** `Decimal` → `number` (a resposta é JSON, não um objeto Prisma). */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

export function toLeadResponse(
  lead: TenantLeadWithRelations['lead'],
): LeadResponse {
  return {
    id: lead.id,
    personType: lead.personType,
    cnpj: lead.cnpj,
    cpf: lead.cpf,
    companyName: lead.companyName,
    tradeName: lead.tradeName,
    primaryCnae: lead.primaryCnae,
    cnaeDescription: lead.cnaeDescription,
    capitalSocial: toNumber(lead.capitalSocial),
    postalCode: lead.postalCode,
    street: lead.street,
    number: lead.number,
    complement: lead.complement,
    neighborhood: lead.neighborhood,
    city: lead.city,
    state: lead.state,
    sector: lead.sector,
    companySize: lead.companySize,
    temperature: lead.temperature,
    temperatureScore: lead.temperatureScore,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    contacts: lead.contacts.map(toContactResponse),
  };
}

export function toContactResponse(
  contact: TenantLeadWithRelations['lead']['contacts'][number],
): LeadContactResponse {
  return {
    id: contact.id,
    name: contact.name,
    role: contact.role,
    phone: contact.phone,
    email: contact.email,
    birthday: contact.birthday,
    isPrimary: contact.isPrimary,
    isDecisionMaker: contact.isDecisionMaker,
  };
}

/**
 * Serializa o `TenantLead` para a resposta HTTP.
 *
 * `contacts` também aparece na raiz porque o card do Pool mostra o decisor
 * sem precisar navegar por `lead.contacts`.
 */
export function toTenantLeadResponse(
  row: TenantLeadWithRelations,
): TenantLeadResponse {
  const { lead, stage, ticketValue, ...rest } = row;

  return {
    ...rest,
    ticketValue: toNumber(ticketValue),
    lead: toLeadResponse(lead),
    stage: {
      id: stage.id,
      name: stage.name,
      code: stage.code,
      position: stage.position,
      colorHex: stage.colorHex,
      isLostStage: stage.isLostStage,
    },
    contacts: lead.contacts.map(toContactResponse),
  };
}
