/**
 * Cenário determinístico da homilia de homologação (`TASK-S06-06`).
 *
 * Este módulo é **puro**: recebe o instante e os segredos do ambiente e
 * devolve todos os registros que a seed de E2E grava. Nada de `Date.now()`
 * escondido nem de conexão com o banco — assim o cenário pode ser conferido
 * por teste sem Postgres.
 *
 * O cenário cobre os caminhos que o Playwright precisa exercitar:
 * três perfis operacionais, Pool com filtros, funil com as sete etapas,
 * alerta de inatividade, perda com motivo, agenda do dia, aniversariantes,
 * linha do tempo e convite pendente para ativação.
 */

import { createHash } from 'node:crypto';

/** Domínio dos e-mails de teste — não colide com contas reais. */
export const E2E_DOMAIN = 'e2e.netprofissional.test';

/** Nome do tenant de homologação (também serve de marcador de segurança). */
export const E2E_TENANT_NAME = 'NetProfissional E2E (homologação)';

/**
 * UUID estável derivado de uma chave legível.
 *
 * IDs fixos permitem reaplicar a seed sem duplicar registros e deixam o
 * Playwright referenciar o mesmo lead entre execuções. O formato segue o de
 * UUID v4 (`4` na versão e `a` na variante) para o `@db.Uuid` do Postgres.
 */
export function e2eId(key: string): string {
  const hex = createHash('sha256')
    .update(`netprofissional:e2e:${key}`)
    .digest('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export const E2E_TENANT_ID = e2eId('tenant');

export const E2E_STAGES = [
  { code: '1_novo_lead', name: '1. Novo Lead / Recebido', colorHex: '#38BDF8' },
  { code: '2_qualificacao', name: '2. Qualificação', colorHex: '#8B5CF6' },
  {
    code: '3_apresentacao',
    name: '3. Apresentação / Reunião',
    colorHex: '#F59E0B',
  },
  { code: '4_proposta', name: '4. Envio de Proposta', colorHex: '#EB3A42' },
  { code: '5_negociacao', name: '5. Negociação', colorHex: '#D60037' },
  { code: '6_fechado_ganho', name: '6. Fechado / Ganho', colorHex: '#10B981' },
  { code: '7_perdido', name: '7. Perdido', colorHex: '#737887' },
] as const;

export type E2eStageCode = (typeof E2E_STAGES)[number]['code'];

export type E2eUserRole = 'ADMIN' | 'USUARIO';
export type E2eOperationalRole = 'ADMIN' | 'CAPTADOR' | 'VENDEDOR';
export type E2eUserStatus = 'ACTIVE' | 'PENDING' | 'BLOCKED';
export type E2ePersonType = 'PJ' | 'PF';
export type E2eSector =
  'SOLAR' | 'TECNOLOGIA' | 'CONSTRUCAO' | 'SERVICOS' | 'OUTROS';
export type E2eCompanySize = 'ME' | 'EPP' | 'DEMAIS';
export type E2eTemperature = 'QUENTE' | 'MORNO' | 'FRIO';
export type E2eLeadStatus =
  'AVAILABLE' | 'CLAIMED' | 'RETURNED_TO_POOL' | 'LOST';
export type E2eNoteType = 'NOTE' | 'CALL' | 'MEETING' | 'STATUS_CHANGE';
export type E2eSpecialDateType = 'ANIVERSARIO_SOCIO' | 'ANIVERSARIO_EMPRESA';

/** Contas de homologação. `admin` é o único administrador do tenant. */
export const E2E_ACCOUNTS = {
  admin: {
    slug: 'admin',
    email: `admin@${E2E_DOMAIN}`,
    name: 'Carlos Admin (E2E)',
    role: 'ADMIN',
    operationalRole: 'ADMIN',
    status: 'ACTIVE',
  },
  vendedor1: {
    slug: 'vendedor1',
    email: `vendedor1@${E2E_DOMAIN}`,
    name: 'Rafael Nunes',
    role: 'USUARIO',
    operationalRole: 'VENDEDOR',
    status: 'ACTIVE',
  },
  vendedor2: {
    slug: 'vendedor2',
    email: `vendedor2@${E2E_DOMAIN}`,
    name: 'Diego Martins',
    role: 'USUARIO',
    operationalRole: 'VENDEDOR',
    status: 'ACTIVE',
  },
  captador: {
    slug: 'captador',
    email: `captador@${E2E_DOMAIN}`,
    name: 'Mariana Costa',
    role: 'USUARIO',
    operationalRole: 'CAPTADOR',
    status: 'ACTIVE',
  },
  pendente: {
    slug: 'pendente',
    email: `pendente@${E2E_DOMAIN}`,
    name: 'Juliana Prado',
    role: 'USUARIO',
    operationalRole: 'VENDEDOR',
    status: 'PENDING',
  },
  bloqueado: {
    slug: 'bloqueado',
    email: `bloqueado@${E2E_DOMAIN}`,
    name: 'Felipe Santos',
    role: 'USUARIO',
    operationalRole: 'VENDEDOR',
    status: 'BLOCKED',
  },
} as const;

export type E2eAccountSlug = keyof typeof E2E_ACCOUNTS;

export interface E2eTenant {
  id: string;
  name: string;
  tradeName: string;
  webhookToken: string;
  maxUsers: number;
}

export interface E2eUser {
  id: string;
  email: string;
  name: string;
  role: E2eUserRole;
  operationalRole: E2eOperationalRole;
  status: E2eUserStatus;
  passwordHash: string;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
  slug: E2eAccountSlug;
}

export interface E2eContact {
  id: string;
  leadSlug: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  birthday: Date | null;
  isPrimary: boolean;
  isDecisionMaker: boolean;
}

export interface E2eSpecialDate {
  id: string;
  leadSlug: string;
  dateType: E2eSpecialDateType;
  dayMonth: string;
  description: string;
}

export interface E2eLead {
  id: string;
  slug: string;
  personType: E2ePersonType;
  cnpj: string | null;
  cpf: string | null;
  companyName: string;
  tradeName: string;
  primaryCnae: string;
  cnaeDescription: string;
  capitalSocial: number;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  sector: E2eSector;
  companySize: E2eCompanySize;
  temperature: E2eTemperature;
  temperatureScore: number;
  contacts: E2eContact[];
  specialDates: E2eSpecialDate[];
}

export interface E2eNote {
  id: string;
  userSlug: E2eAccountSlug;
  type: E2eNoteType;
  title: string;
  content: string;
  createdAt: Date;
}

export interface E2eOpportunity {
  id: string;
  leadSlug: string;
  stageCode: E2eStageCode;
  assignedUserSlug: E2eAccountSlug | null;
  creatorUserSlug: E2eAccountSlug | null;
  status: E2eLeadStatus;
  ticketValue: number;
  closeProbability: number | null;
  expectedCloseDate: Date | null;
  proposalScope: string | null;
  lossReasonCode: string | null;
  lossReasonNotes: string | null;
  lastContactAt: Date | null;
  claimedAt: Date | null;
  version: number;
  notes: E2eNote[];
}

export interface E2eScenario {
  generatedAt: Date;
  tenant: E2eTenant;
  stages: Array<{
    id: string;
    code: E2eStageCode;
    name: string;
    position: number;
    colorHex: string;
    isLostStage: boolean;
  }>;
  users: E2eUser[];
  leads: E2eLead[];
  opportunities: E2eOpportunity[];
}

export interface BuildScenarioInput {
  /** Instante de referência (injetado para o teste ser determinístico). */
  now: Date;
  /** Hash argon2 da senha de teste — o segredo vem do ambiente, nunca daqui. */
  passwordHash: string;
  /** Token HMAC do webhook da corporação (segredo do ambiente). */
  webhookToken: string;
  /** Token do convite pendente (segredo do ambiente). */
  inviteToken: string;
}

/** Meia-noite local de `now` deslocada em dias. */
function dayOffset(now: Date, days: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}

/** `DD/MM` de uma data — formato que `LeadSpecialDate` guarda. */
function dayMonth(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(
    date.getMonth() + 1,
  ).padStart(2, '0')}`;
}

function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

interface LeadSpec {
  slug: string;
  personType: E2ePersonType;
  document: string;
  companyName: string;
  tradeName: string;
  sector: E2eSector;
  companySize: E2eCompanySize;
  temperature: E2eTemperature;
  score: number;
  city: string;
  state: string;
  ticket: number;
  contact: {
    name: string;
    role: string;
    phone: string;
    email: string | null;
    /** Deslocamento em dias para o aniversário; omitido quando não há. */
    birthdayIn?: number;
  };
  specialDate?: {
    type: E2eSpecialDateType;
    inDays: number;
    description: string;
  };
  /** Datas adicionais (ex.: aniversário da empresa) para o widget de relacionamento. */
  extraSpecialDates?: Array<{
    type: E2eSpecialDateType;
    inDays: number;
    description: string;
  }>;
  stage: E2eStageCode;
  assignee: E2eAccountSlug | null;
  status: E2eLeadStatus;
  probability: number | null;
  /** Previsão de fechamento em dias (negativo = vencida). */
  closeInDays: number | null;
  /** Dias desde o último contato; `null` = nunca contatado. */
  lastContactInDays: number | null;
  lossReason?: { code: string; notes: string };
  proposalScope?: string;
  notes?: Array<{
    type: E2eNoteType;
    title: string;
    content: string;
    hoursAgo: number;
  }>;
}

/**
 * Carteira de homologação.
 *
 * - Pool: 5 leads disponíveis, com UF, setor, porte e temperatura variados.
 * - Devolvido: 1 lead que voltou ao Pool (nasce sem responsável).
 * - Vendedor 1: 8 cards cobrindo as sete etapas (inclui perdido e ganho).
 * - Vendedor 2: 2 cards, para o Administrador filtrar por vendedor.
 */
const LEADS: readonly LeadSpec[] = [
  // ----- Pool -----
  {
    slug: 'pool-alianca',
    personType: 'PJ',
    document: '44987654000111',
    companyName: 'Construtora Aliança Minas LTDA',
    tradeName: 'Aliança Minas',
    sector: 'CONSTRUCAO',
    companySize: 'DEMAIS',
    temperature: 'MORNO',
    score: 62,
    city: 'Uberlândia',
    state: 'MG',
    ticket: 85000,
    contact: {
      name: 'Renata Duarte',
      role: 'Engenheira',
      phone: '31991112233',
      email: 'renata@aliancaminas.test',
    },
    stage: '1_novo_lead',
    assignee: null,
    status: 'AVAILABLE',
    probability: null,
    closeInDays: null,
    lastContactInDays: null,
  },
  {
    slug: 'pool-triangulo',
    personType: 'PJ',
    document: '11222333000144',
    companyName: 'Agropecuária Triângulo Mineiro S/A',
    tradeName: 'Triângulo Agro',
    sector: 'OUTROS',
    companySize: 'DEMAIS',
    temperature: 'QUENTE',
    score: 81,
    city: 'Uberaba',
    state: 'MG',
    ticket: 130000,
    contact: {
      name: 'Geraldo Magela',
      role: 'Diretor',
      phone: '31981112233',
      email: 'geraldo@trianguloagro.test',
    },
    specialDate: {
      type: 'ANIVERSARIO_SOCIO',
      inDays: 4,
      description: 'Aniversário do decisor Geraldo Magela',
    },
    stage: '1_novo_lead',
    assignee: null,
    status: 'AVAILABLE',
    probability: null,
    closeInDays: null,
    lastContactInDays: null,
  },
  {
    slug: 'pool-horizonte',
    personType: 'PJ',
    document: '77888999000112',
    companyName: 'Indústria Química Horizonte LTDA',
    tradeName: 'Química Horizonte',
    sector: 'SERVICOS',
    companySize: 'EPP',
    temperature: 'FRIO',
    score: 35,
    city: 'Campinas',
    state: 'SP',
    ticket: 55000,
    contact: {
      name: 'Fernando Rocha',
      role: 'Gerente',
      phone: '19977776611',
      email: 'fernando@horizonte.test',
    },
    stage: '1_novo_lead',
    assignee: null,
    status: 'AVAILABLE',
    probability: null,
    closeInDays: null,
    lastContactInDays: null,
  },
  {
    slug: 'pool-bompreco',
    personType: 'PJ',
    document: '22333444000155',
    companyName: 'Supermercado Bom Preço LTDA',
    tradeName: 'Bom Preço',
    sector: 'SERVICOS',
    companySize: 'EPP',
    temperature: 'QUENTE',
    score: 90,
    city: 'Belo Horizonte',
    state: 'MG',
    ticket: 47000,
    contact: {
      name: 'Paula Reis',
      role: 'Proprietária',
      phone: '31988880011',
      email: 'paula@bompreco.test',
    },
    stage: '1_novo_lead',
    assignee: null,
    status: 'AVAILABLE',
    probability: null,
    closeInDays: null,
    lastContactInDays: null,
  },
  {
    slug: 'pool-marcos',
    personType: 'PF',
    document: '12345678901',
    companyName: 'Marcos Vinícius Andrade',
    tradeName: 'Marcos Andrade',
    sector: 'TECNOLOGIA',
    companySize: 'ME',
    temperature: 'MORNO',
    score: 58,
    city: 'Belo Horizonte',
    state: 'MG',
    ticket: 15000,
    contact: {
      name: 'Marcos Vinícius Andrade',
      role: 'Autônomo',
      phone: '31977770022',
      email: 'marcos@andrade.test',
    },
    stage: '1_novo_lead',
    assignee: null,
    status: 'AVAILABLE',
    probability: null,
    closeInDays: null,
    lastContactInDays: null,
  },

  // ----- Devolvido ao Pool -----
  {
    slug: 'returned-grafica',
    personType: 'PJ',
    document: '99888777000166',
    companyName: 'Gráfica Impressa Bem LTDA',
    tradeName: 'Impressa Bem',
    sector: 'SERVICOS',
    companySize: 'ME',
    temperature: 'MORNO',
    score: 55,
    city: 'Contagem',
    state: 'MG',
    ticket: 31000,
    contact: {
      name: 'Sérgio Lopes',
      role: 'Sócio',
      phone: '31995550033',
      email: 'sergio@impressabem.test',
    },
    stage: '1_novo_lead',
    assignee: null,
    status: 'RETURNED_TO_POOL',
    probability: null,
    closeInDays: null,
    lastContactInDays: -2,
  },

  // ----- Carteira do vendedor 1 -----
  {
    slug: 'solar-tech',
    personType: 'PJ',
    document: '33456789000102',
    companyName: 'Solar Tech Engenharia LTDA',
    tradeName: 'Solar Tech',
    sector: 'SOLAR',
    companySize: 'EPP',
    temperature: 'QUENTE',
    score: 88,
    city: 'Belo Horizonte',
    state: 'MG',
    ticket: 42000,
    contact: {
      name: 'Marcelo Dias',
      role: 'Sócio-Diretor',
      phone: '31988887777',
      email: 'marcelo@solartech.test',
      birthdayIn: 3,
    },
    specialDate: {
      type: 'ANIVERSARIO_SOCIO',
      inDays: 3,
      description: 'Aniversário do decisor Marcelo Dias',
    },
    stage: '2_qualificacao',
    assignee: 'vendedor1',
    status: 'CLAIMED',
    probability: 65,
    closeInDays: 10,
    lastContactInDays: -1,
    proposalScope: 'Instalação de 40 painéis e inversor híbrido.',
    notes: [
      {
        type: 'CALL',
        title: 'Ligação de qualificação',
        content: 'Cliente pediu proposta revisada com prazo de instalação.',
        hoursAgo: 50,
      },
      {
        type: 'NOTE',
        title: 'Reunião agendada',
        content: 'Visita técnica confirmada para a próxima terça.',
        hoursAgo: 26,
      },
      {
        type: 'MEETING',
        title: 'Visita técnica realizada',
        content: 'Telhado comporta 40 painéis; laudo anexado por e-mail.',
        hoursAgo: 6,
      },
    ],
  },
  {
    slug: 'clinica-vida-plena',
    personType: 'PJ',
    document: '55666777000188',
    companyName: 'Clínica Vida Plena LTDA',
    tradeName: 'Vida Plena',
    sector: 'SERVICOS',
    companySize: 'ME',
    temperature: 'MORNO',
    score: 58,
    city: 'Belo Horizonte',
    state: 'MG',
    ticket: 64000,
    contact: {
      name: 'Ana Beatriz',
      role: 'Diretora Clínica',
      phone: '31996543210',
      email: 'ana@vidaplena.test',
      birthdayIn: 2,
    },
    specialDate: {
      type: 'ANIVERSARIO_SOCIO',
      inDays: 2,
      description: 'Aniversário da decisora Ana Beatriz',
    },
    extraSpecialDates: [
      {
        type: 'ANIVERSARIO_EMPRESA',
        inDays: 6,
        description: 'Aniversário da clínica',
      },
    ],
    stage: '3_apresentacao',
    assignee: 'vendedor1',
    status: 'CLAIMED',
    probability: 70,
    closeInDays: 7,
    lastContactInDays: -1,
    proposalScope: 'Projeto de climatização da recepção e dos consultórios.',
    notes: [
      {
        type: 'NOTE',
        title: 'Apresentação enviada',
        content: 'Enviado o deck institucional e o case de clínicas.',
        hoursAgo: 30,
      },
    ],
  },
  {
    slug: 'transportes-rota-sul',
    personType: 'PJ',
    document: '66777888000199',
    companyName: 'Transportes Rota Sul LTDA',
    tradeName: 'Rota Sul',
    sector: 'SERVICOS',
    companySize: 'DEMAIS',
    temperature: 'QUENTE',
    score: 84,
    city: 'Betim',
    state: 'MG',
    ticket: 98000,
    contact: {
      name: 'Cláudio Ferraz',
      role: 'Gerente de Frota',
      phone: '31994440044',
      email: 'claudio@rotasul.test',
    },
    stage: '4_proposta',
    assignee: 'vendedor1',
    status: 'CLAIMED',
    probability: 55,
    closeInDays: 0,
    lastContactInDays: -1,
    proposalScope: 'Proposta de 12 veículos com rastreamento.',
  },
  {
    slug: 'studio-bela-imagem',
    personType: 'PJ',
    document: '88999000000133',
    companyName: 'Studio Bela Imagem LTDA',
    tradeName: 'Bela Imagem',
    sector: 'SERVICOS',
    companySize: 'ME',
    temperature: 'MORNO',
    score: 60,
    city: 'Belo Horizonte',
    state: 'MG',
    ticket: 72000,
    contact: {
      name: 'Bianca Moura',
      role: 'Proprietária',
      phone: '31993330055',
      email: 'bianca@bela-imagem.test',
    },
    stage: '5_negociacao',
    assignee: 'vendedor1',
    status: 'CLAIMED',
    probability: 80,
    closeInDays: 20,
    lastContactInDays: -5,
    proposalScope: 'Reforma do estúdio com iluminação cênica.',
  },
  {
    slug: 'otica-visao-clara',
    personType: 'PJ',
    document: '44555666000177',
    companyName: 'Ótica Visão Clara LTDA',
    tradeName: 'Visão Clara',
    sector: 'SERVICOS',
    companySize: 'ME',
    temperature: 'QUENTE',
    score: 92,
    city: 'Belo Horizonte',
    state: 'MG',
    ticket: 35000,
    contact: {
      name: 'Otávio Pires',
      role: 'Sócio',
      phone: '31992220066',
      email: 'otavio@visaoclara.test',
    },
    stage: '6_fechado_ganho',
    assignee: 'vendedor1',
    status: 'CLAIMED',
    probability: 100,
    closeInDays: -5,
    lastContactInDays: -2,
  },
  {
    slug: 'metalurgica-sao-jorge',
    personType: 'PJ',
    document: '33555666000188',
    companyName: 'Metalúrgica São Jorge LTDA',
    tradeName: 'São Jorge',
    sector: 'CONSTRUCAO',
    companySize: 'DEMAIS',
    temperature: 'FRIO',
    score: 32,
    city: 'Betim',
    state: 'MG',
    ticket: 22000,
    contact: {
      name: 'Paulo Cesar',
      role: 'Comprador',
      phone: '31990001177',
      email: 'paulo@saojorge.test',
    },
    stage: '7_perdido',
    assignee: 'vendedor1',
    status: 'LOST',
    probability: 0,
    closeInDays: -12,
    lastContactInDays: -3,
    lossReason: {
      code: 'preco',
      notes: 'Concorrente apresentou proposta 18% menor.',
    },
  },
  {
    slug: 'padaria-pao-dourado',
    personType: 'PJ',
    document: '55666777000199',
    companyName: 'Padaria Pão Dourado LTDA',
    tradeName: 'Pão Dourado',
    sector: 'OUTROS',
    companySize: 'ME',
    temperature: 'MORNO',
    score: 50,
    city: 'Sabará',
    state: 'MG',
    ticket: 18000,
    contact: {
      name: 'Lúcia Alves',
      role: 'Proprietária',
      phone: '31996660088',
      email: 'lucia@paodourado.test',
    },
    stage: '2_qualificacao',
    assignee: 'vendedor1',
    status: 'CLAIMED',
    probability: 40,
    closeInDays: -2,
    // Nunca contatado: entra na agenda por previsão vencida **e** inatividade.
    lastContactInDays: null,
  },
  {
    slug: 'escola-semear',
    personType: 'PJ',
    document: '66777888000100',
    companyName: 'Escola Semear LTDA',
    tradeName: 'Escola Semear',
    sector: 'OUTROS',
    companySize: 'ME',
    temperature: 'FRIO',
    score: 45,
    city: 'Nova Lima',
    state: 'MG',
    ticket: 40000,
    contact: {
      name: 'Helena Castro',
      role: 'Coordenadora',
      phone: '31997770099',
      email: 'helena@semear.test',
    },
    stage: '1_novo_lead',
    assignee: 'vendedor1',
    status: 'CLAIMED',
    probability: 30,
    closeInDays: null,
    lastContactInDays: -10,
  },

  // ----- Carteira do vendedor 2 -----
  {
    slug: 'auto-pecas-central',
    personType: 'PJ',
    document: '77888999000123',
    companyName: 'Auto Peças Central LTDA',
    tradeName: 'Central',
    sector: 'SERVICOS',
    companySize: 'EPP',
    temperature: 'QUENTE',
    score: 76,
    city: 'Contagem',
    state: 'MG',
    ticket: 51000,
    contact: {
      name: 'Roberto Sales',
      role: 'Gerente',
      phone: '31991230077',
      email: 'roberto@central.test',
    },
    stage: '2_qualificacao',
    assignee: 'vendedor2',
    status: 'CLAIMED',
    probability: 50,
    closeInDays: 3,
    lastContactInDays: -1,
  },
  {
    slug: 'hotel-serra-azul',
    personType: 'PJ',
    document: '88999000000144',
    companyName: 'Hotel Serra Azul LTDA',
    tradeName: 'Serra Azul',
    sector: 'SERVICOS',
    companySize: 'DEMAIS',
    temperature: 'MORNO',
    score: 68,
    city: 'Ouro Preto',
    state: 'MG',
    ticket: 120000,
    contact: {
      name: 'Camila Fontes',
      role: 'Gerente Geral',
      phone: '31993340011',
      email: 'camila@serraazul.test',
    },
    stage: '4_proposta',
    assignee: 'vendedor2',
    status: 'CLAIMED',
    probability: 60,
    closeInDays: 15,
    lastContactInDays: -1,
    proposalScope: 'Projeto de eficiência energética das 42 suítes.',
  },
];

function buildUsers(input: BuildScenarioInput): E2eUser[] {
  return Object.values(E2E_ACCOUNTS).map((account) => {
    const pending = account.slug === 'pendente';

    return {
      id: e2eId(`user:${account.slug}`),
      slug: account.slug,
      email: account.email,
      name: account.name,
      role: account.role,
      operationalRole: account.operationalRole,
      status: account.status,
      passwordHash: input.passwordHash,
      // Só a conta pendente tem convite ativo (fluxo de ativação).
      inviteToken: pending ? input.inviteToken : null,
      inviteExpiresAt: pending ? dayOffset(input.now, 2) : null,
    };
  });
}

function buildLead(spec: LeadSpec, now: Date): E2eLead {
  const leadId = e2eId(`lead:${spec.slug}`);
  const birthday =
    spec.contact.birthdayIn === undefined
      ? null
      : dayOffset(now, spec.contact.birthdayIn);

  const contact: E2eContact = {
    id: e2eId(`contact:${spec.slug}:primary`),
    leadSlug: spec.slug,
    name: spec.contact.name,
    role: spec.contact.role,
    phone: spec.contact.phone,
    email: spec.contact.email,
    birthday,
    isPrimary: true,
    isDecisionMaker: true,
  };

  const specialDates: E2eSpecialDate[] = [
    ...(spec.specialDate ? [spec.specialDate] : []),
    ...(spec.extraSpecialDates ?? []),
  ].map((special, index) => ({
    id: e2eId(`date:${spec.slug}:${index}`),
    leadSlug: spec.slug,
    dateType: special.type,
    dayMonth: dayMonth(dayOffset(now, special.inDays)),
    description: special.description,
  }));

  return {
    id: leadId,
    slug: spec.slug,
    personType: spec.personType,
    cnpj: spec.personType === 'PJ' ? spec.document : null,
    cpf: spec.personType === 'PF' ? spec.document : null,
    companyName: spec.companyName,
    tradeName: spec.tradeName,
    primaryCnae: spec.personType === 'PJ' ? '4321500' : '8599604',
    cnaeDescription:
      spec.personType === 'PJ'
        ? 'Instalação e manutenção elétrica'
        : 'Treinamento e consultoria em tecnologia',
    capitalSocial: spec.personType === 'PJ' ? 150000 : 10000,
    postalCode: '30130-110',
    street: 'Av. Afonso Pena',
    number: '1500',
    complement: 'Sala 402',
    neighborhood: 'Centro',
    city: spec.city,
    state: spec.state,
    sector: spec.sector,
    companySize: spec.companySize,
    temperature: spec.temperature,
    temperatureScore: spec.score,
    contacts: [contact],
    specialDates,
  };
}

function buildOpportunity(spec: LeadSpec, now: Date): E2eOpportunity {
  const notes: E2eNote[] = (spec.notes ?? []).map((note, index) => ({
    id: e2eId(`note:${spec.slug}:${index}`),
    userSlug: spec.assignee ?? 'admin',
    type: note.type,
    title: note.title,
    content: note.content,
    createdAt: hoursAgo(now, note.hoursAgo),
  }));

  return {
    id: e2eId(`opp:${spec.slug}`),
    leadSlug: spec.slug,
    stageCode: spec.stage,
    assignedUserSlug: spec.assignee,
    creatorUserSlug: 'captador',
    status: spec.status,
    ticketValue: spec.ticket,
    closeProbability: spec.probability,
    expectedCloseDate:
      spec.closeInDays === null ? null : dayOffset(now, spec.closeInDays),
    proposalScope: spec.proposalScope ?? null,
    lossReasonCode: spec.lossReason?.code ?? null,
    lossReasonNotes: spec.lossReason?.notes ?? null,
    lastContactAt:
      spec.lastContactInDays === null
        ? null
        : dayOffset(now, spec.lastContactInDays),
    claimedAt:
      spec.status === 'AVAILABLE'
        ? null
        : dayOffset(now, spec.status === 'RETURNED_TO_POOL' ? -3 : -1),
    version: 1,
    notes,
  };
}

/**
 * Monta o cenário completo a partir de um instante.
 *
 * O mesmo `now` (e os mesmos segredos) sempre produzem exatamente o mesmo
 * objeto — é o que torna a seed reaplicável.
 */
export function buildE2eScenario(input: BuildScenarioInput): E2eScenario {
  return {
    generatedAt: input.now,
    tenant: {
      id: E2E_TENANT_ID,
      name: E2E_TENANT_NAME,
      tradeName: 'NetProfissional E2E',
      webhookToken: input.webhookToken,
      maxUsers: 10,
    },
    stages: E2E_STAGES.map((stage, index) => ({
      id: e2eId(`stage:${stage.code}`),
      code: stage.code,
      name: stage.name,
      position: index + 1,
      colorHex: stage.colorHex,
      isLostStage: stage.code === '7_perdido',
    })),
    users: buildUsers(input),
    leads: LEADS.map((spec) => buildLead(spec, input.now)),
    opportunities: LEADS.map((spec) => buildOpportunity(spec, input.now)),
  };
}

/**
 * Plano de limpeza aplicado antes de recriar o cenário.
 *
 * Apagar o tenant inteiro (cascade em usuários, etapas, oportunidades,
 * contatos, datas e notas) é o reset mais simples e confiável: qualquer
 * alteração feita por um teste anterior desaparece. `Lead` é global, então os
 * documentos do cenário são removidos à parte quando não têm mais vínculo.
 */
export interface E2eResetPlan {
  tenantId: string;
  cnpjs: string[];
  cpfs: string[];
}

export function buildE2eResetPlan(scenario: E2eScenario): E2eResetPlan {
  return {
    tenantId: scenario.tenant.id,
    cnpjs: scenario.leads
      .map((lead) => lead.cnpj)
      .filter((value): value is string => value !== null),
    cpfs: scenario.leads
      .map((lead) => lead.cpf)
      .filter((value): value is string => value !== null),
  };
}

/**
 * Segurança da seed.
 *
 * Homologação apaga e recria um tenant: em produção isso só acontece com
 * confirmação explícita. Os segredos (senha, token do webhook e token do
 * convite) vêm do ambiente — nenhum fica no código.
 */
export const E2E_REQUIRED_ENV = [
  'DATABASE_URL',
  'SEED_E2E_PASSWORD',
  'SEED_E2E_WEBHOOK_TOKEN',
  'SEED_E2E_INVITE_TOKEN',
] as const;

export function assertE2eAllowed(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.SEED_E2E_ALLOW_PROD !== '1') {
    throw new Error(
      'Seed de E2E apaga e recria o tenant de homologação. Em produção, defina SEED_E2E_ALLOW_PROD=1 para confirmar.',
    );
  }

  const missing = E2E_REQUIRED_ENV.filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Variáveis obrigatórias da seed de E2E ausentes: ${missing.join(', ')}. Veja backend/.env.example.`,
    );
  }
}
