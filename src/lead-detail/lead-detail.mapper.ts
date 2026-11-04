import type { Prisma } from '../generated/prisma/client.js';
import { TIMELINE_NOTES_LIMIT } from './lead-detail.constants.js';

/**
 * Relações carregadas por toda leitura da gaveta (`GET /leads/:id`).
 *
 * A gaveta mostra as 3 abas de uma vez, então a ficha traz tudo numa consulta:
 * etapa + vendedor, empresa com contatos e datas especiais, e as notas da
 * linha do tempo (mais recentes primeiro, teto de 100).
 *
 * Contatos e datas especiais são filtrados pelo `tenantId` da sessão: o
 * `Lead` é a identidade fiscal **global** do cliente, mas o telefone, o e-mail
 * e o aniversário dos decisores pertencem a quem os cadastrou (LGPD). Sem o
 * filtro, a ficha de um tenant mostraria os contatos de outro.
 */
export function leadDetailInclude(tenantId: string) {
  return {
    stage: true,
    assignedUser: { select: { id: true, name: true, email: true } },
    lead: {
      include: {
        contacts: {
          where: { tenantId },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        specialDates: { where: { tenantId }, orderBy: [{ dayMonth: 'asc' }] },
      },
    },
    timelineNotes: {
      orderBy: { createdAt: 'desc' },
      take: TIMELINE_NOTES_LIMIT,
      include: { user: { select: { id: true, name: true } } },
    },
  } satisfies Prisma.TenantLeadInclude;
}

/** `TenantLead` com todas as relações da gaveta resolvidas. */
export type LeadDetailRow = Prisma.TenantLeadGetPayload<{
  include: ReturnType<typeof leadDetailInclude>;
}>;

/** Etapa como a gaveta a exibe no cabeçalho. */
export interface LeadDetailStage {
  id: string;
  name: string;
  code: string;
  position: number;
  color_hex: string;
  is_lost_stage: boolean;
}

/** Vendedor responsável (aba 1 e rodapé da gaveta). */
export interface LeadDetailAssignedUser {
  id: string;
  name: string;
  email: string;
}

/** Identidade da empresa (`Lead`) — base das abas 2 e 3. */
export interface LeadDetailCompany {
  id: string;
  person_type: string;
  cnpj: string | null;
  cpf: string | null;
  company_name: string | null;
  trade_name: string | null;
  primary_cnae: string | null;
  cnae_description: string | null;
  capital_social: number | null;
  postal_code: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  sector: string;
  company_size: string | null;
  temperature: string | null;
  temperature_score: number | null;
}

/** Nota da linha do tempo (aba 1). */
export interface TimelineNoteResponse {
  id: string;
  type: string;
  title: string;
  content: string | null;
  created_at: Date;
  user: { id: string; name: string };
}

/** Sócio/decisor do lead (aba 2). */
export interface LeadDetailContact {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  birthday: Date | null;
  is_primary: boolean;
  is_decision_maker: boolean;
  /** Link de 1 clique do WhatsApp Web, com DDI 55. */
  whatsapp_url: string | null;
}

export interface LeadDetailSpecialDate {
  id: string;
  date_type: string;
  day_month: string;
  description: string | null;
}

/** Dados fiscais da Receita Federal (aba 3). */
export interface LeadDetailFiscal {
  cnpj: string | null;
  company_name: string | null;
  trade_name: string | null;
  primary_cnae: string | null;
  cnae_description: string | null;
  capital_social: number | null;
  company_size: string | null;
  state: string | null;
  city: string | null;
  sector: string;
}

/** Resposta completa da gaveta — as 3 abas num só objeto. */
export interface LeadDetailResponse {
  id: string;
  version: number;
  status: string;
  ticket_value: number | null;
  close_probability: number | null;
  expected_close_date: Date | null;
  proposal_scope: string | null;
  loss_reason_code: string | null;
  loss_reason_notes: string | null;
  last_contact_at: Date | null;
  stage: LeadDetailStage;
  assigned_user: LeadDetailAssignedUser | null;
  lead: LeadDetailCompany;
  timeline: TimelineNoteResponse[];
  contacts: LeadDetailContact[];
  special_dates: LeadDetailSpecialDate[];
  fiscal: LeadDetailFiscal;
}

/**
 * `Decimal` → `number`: a resposta é JSON e `Decimal` do Prisma não sobrevive
 * à serialização do jeito que o frontend espera.
 */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * URL do WhatsApp Web com o DDI 55 — o botão da gaveta abre em 1 clique.
 *
 * Números já internacionais (13 dígitos começando em 55) não recebem o
 * prefixo de novo; telefones sem DDD não geram link.
 */
export function buildWhatsappUrl(phone: string | null, name?: string): string | null {
  const digits = phone?.replace(/\D/g, '') ?? '';

  if (digits.length < 10) {
    return null;
  }

  const international =
    digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  const firstName = name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Olá, ${firstName}!` : 'Olá!';

  return `https://web.whatsapp.com/send?phone=${international}&text=${encodeURIComponent(greeting)}`;
}

export function toTimelineNoteResponse(note: {
  id: string;
  type: string;
  title: string;
  content: string | null;
  createdAt: Date;
  user: { id: string; name: string };
}): TimelineNoteResponse {
  return {
    id: note.id,
    type: note.type,
    title: note.title,
    content: note.content,
    created_at: note.createdAt,
    user: { id: note.user.id, name: note.user.name },
  };
}

function toCompany(row: LeadDetailRow): LeadDetailCompany {
  const { lead } = row;

  return {
    id: lead.id,
    person_type: lead.personType,
    cnpj: lead.cnpj,
    cpf: lead.cpf,
    company_name: lead.companyName,
    trade_name: lead.tradeName,
    primary_cnae: lead.primaryCnae,
    cnae_description: lead.cnaeDescription,
    capital_social: toNumber(lead.capitalSocial),
    postal_code: lead.postalCode,
    street: lead.street,
    number: lead.number,
    complement: lead.complement,
    neighborhood: lead.neighborhood,
    city: lead.city,
    state: lead.state,
    sector: lead.sector,
    company_size: lead.companySize,
    temperature: lead.temperature,
    temperature_score: lead.temperatureScore,
  };
}

/**
 * Serializa o `TenantLead` da gaveta.
 *
 * `fiscal` repete campos de `lead` de propósito: a aba 3 é a leitura da
 * Receita Federal e o frontend não precisa saber de onde o dado veio.
 */
export function toLeadDetailResponse(row: LeadDetailRow): LeadDetailResponse {
  const company = toCompany(row);

  return {
    id: row.id,
    version: row.version,
    status: row.status,
    ticket_value: toNumber(row.ticketValue),
    close_probability: row.closeProbability,
    expected_close_date: row.expectedCloseDate,
    proposal_scope: row.proposalScope,
    loss_reason_code: row.lossReasonCode,
    loss_reason_notes: row.lossReasonNotes,
    last_contact_at: row.lastContactAt,
    stage: {
      id: row.stage.id,
      name: row.stage.name,
      code: row.stage.code,
      position: row.stage.position,
      color_hex: row.stage.colorHex,
      is_lost_stage: row.stage.isLostStage,
    },
    assigned_user: row.assignedUser
      ? {
          id: row.assignedUser.id,
          name: row.assignedUser.name,
          email: row.assignedUser.email,
        }
      : null,
    lead: company,
    timeline: row.timelineNotes.map(toTimelineNoteResponse),
    contacts: row.lead.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      phone: contact.phone,
      email: contact.email,
      birthday: contact.birthday,
      is_primary: contact.isPrimary,
      is_decision_maker: contact.isDecisionMaker,
      whatsapp_url: buildWhatsappUrl(contact.phone, contact.name),
    })),
    special_dates: row.lead.specialDates.map((date) => ({
      id: date.id,
      date_type: date.dateType,
      day_month: date.dayMonth,
      description: date.description,
    })),
    fiscal: {
      cnpj: company.cnpj,
      company_name: company.company_name,
      trade_name: company.trade_name,
      primary_cnae: company.primary_cnae,
      cnae_description: company.cnae_description,
      capital_social: company.capital_social,
      company_size: company.company_size,
      state: company.state,
      city: company.city,
      sector: company.sector,
    },
  };
}
