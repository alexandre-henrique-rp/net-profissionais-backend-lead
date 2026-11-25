import type { TenantLeadResponse } from '../../leads/leads.mapper.js';

export const AISA_DEFAULT_BASE_URL = 'https://api.aisa.one';

export const AI_LLM_PROVIDERS = [
  'AISA',
  'GEMINI',
  'OPENAI',
  'CLAUDE',
  'CUSTOM',
] as const;

export type AiLlmProvider = (typeof AI_LLM_PROVIDERS)[number];

export const AISA_SEARCH_ENGINES = ['auto', 'tavily', 'exa', 'akta'] as const;

export type AisaSearchEngine = (typeof AISA_SEARCH_ENGINES)[number];

export const DEFAULT_LLM_MODELS: Record<AiLlmProvider, string> = {
  AISA: 'gpt-4o-mini',
  GEMINI: 'gemini-2.5-flash',
  OPENAI: 'gpt-4o-mini',
  CLAUDE: 'claude-sonnet-4-5',
  CUSTOM: 'gpt-4o-mini',
};

export interface AisaConfigResponse {
  hasAisaApiKey: boolean;
  aisaApiKeyHint: string | null;
  aisaBaseUrl: string;
  llmProvider: AiLlmProvider;
  llmModel: string;
  llmBaseUrl: string | null;
  hasLlmApiKey: boolean;
  llmApiKeyHint: string | null;
  updatedAt: string;
}

export interface AisaLeadContactCandidate {
  name: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export interface AisaLeadCandidate {
  companyName: string;
  tradeName: string | null;
  cnpj: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  customSector: string | null;
  companySize: 'ME' | 'EPP' | 'DEMAIS' | null;
  temperature: 'QUENTE' | 'MORNO' | 'FRIO';
  fitScore: number | null;
  summary: string | null;
  sourceUrl: string | null;
  sourceEngine: string;
  contact: AisaLeadContactCandidate | null;
}

export interface AisaSearchResponse {
  query: string;
  engineUsed: string;
  llmProvider: AiLlmProvider;
  llmModel: string;
  llmUsed: boolean;
  totalSources: number;
  warnings: string[];
  leads: AisaLeadCandidate[];
}

export interface AisaImportResponse {
  importedCount: number;
  skippedCount: number;
  items: TenantLeadResponse[];
  skipped: Array<{ companyName: string; reason: string }>;
}
