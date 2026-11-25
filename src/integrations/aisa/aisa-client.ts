import { Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/errors/business.exception.js';
import {
  AISA_DEFAULT_BASE_URL,
  type AiLlmProvider,
  type AisaLeadCandidate,
  type AisaSearchEngine,
} from './aisa.types.js';

const SEARCH_TIMEOUT_MS = 25_000;
const EXTRACT_TIMEOUT_MS = 12_000;

export interface RawAisaSource {
  title: string;
  url: string;
  content: string;
  engine: string;
}

export interface SearchAisaInput {
  segment: string;
  city?: string;
  state?: string;
  keywords?: string;
  companySize?: 'ME' | 'EPP' | 'DEMAIS';
  engine?: AisaSearchEngine;
  deepExtract?: boolean;
  maxResults?: number;
}

export interface DiscoverSourcesResult {
  query: string;
  engineUsed: string;
  sources: RawAisaSource[];
  warnings: string[];
}

export interface LlmConfigInput {
  aisaApiKey: string;
  aisaBaseUrl: string;
  llmProvider: AiLlmProvider;
  llmModel: string;
  llmApiKey: string | null;
  llmBaseUrl: string | null;
}

/** Normaliza uma URL HTTP(S) removendo barras finais e valida o protocolo. */
export function normalizeHttpUrl(raw: string, fieldLabel: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BusinessException(
      400,
      'VALIDATION_ERROR',
      `${fieldLabel} deve ser uma URL válida (http:// ou https://).`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BusinessException(
      400,
      'VALIDATION_ERROR',
      `${fieldLabel} deve usar protocolo http:// ou https://.`,
    );
  }

  return trimmed;
}

/** Monta a query comercial para prospecção de empresas brasileiras na API Aisa. */
export function buildProspectingQuery(input: SearchAisaInput): string {
  const parts: string[] = ['empresas', input.segment.trim()];

  if (input.companySize === 'ME') {
    parts.push('microempresa ME');
  } else if (input.companySize === 'EPP') {
    parts.push('empresa pequeno porte EPP');
  } else if (input.companySize === 'DEMAIS') {
    parts.push('média grande empresa');
  }

  const location = [input.city?.trim(), input.state?.trim().toUpperCase()]
    .filter(Boolean)
    .join(' ');
  if (location) {
    parts.push(location);
  }

  if (input.keywords?.trim()) {
    parts.push(input.keywords.trim());
  }

  parts.push('Brasil "CNPJ" OR "contato" OR "WhatsApp"');
  return parts.join(' ');
}

function normalizeCustomChatUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (
    clean.endsWith('/chat/completions') ||
    clean.endsWith('/messages') ||
    clean.includes(':generateContent')
  ) {
    return clean;
  }
  return `${clean}/chat/completions`;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonPayload(text: string): unknown {
  const cleaned = stripJsonFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Resposta do modelo não contém JSON válido.');
  }
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function onlyDigits(value: string | null | undefined): string {
  return value ? value.replace(/\D/g, '') : '';
}

function normalizeCnpj(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = onlyDigits(value);
  return digits.length === 14 ? digits : null;
}

function normalizeState(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const uf = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(uf) ? uf : null;
}

function normalizeCompanySize(
  value: unknown,
): 'ME' | 'EPP' | 'DEMAIS' | null {
  if (typeof value !== 'string') return null;
  const norm = value.trim().toUpperCase();
  if (norm === 'ME' || norm === 'EPP' || norm === 'DEMAIS') {
    return norm;
  }
  return null;
}

function normalizeTemperature(value: unknown): 'QUENTE' | 'MORNO' | 'FRIO' {
  if (typeof value === 'string') {
    const norm = value.trim().toUpperCase();
    if (norm === 'QUENTE' || norm === 'MORNO' || norm === 'FRIO') {
      return norm;
    }
  }
  return 'MORNO';
}

function normalizeFitScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  return null;
}

function extractRegexCnpj(text: string): string | null {
  const match = text.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  return match ? normalizeCnpj(match[0]) : null;
}

function extractRegexEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractRegexPhone(text: string): string | null {
  const match = text.match(
    /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\d{4}|\d{4})[-\s]?\d{4}/,
  );
  if (!match) return null;
  const digits = onlyDigits(match[0]);
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

function cleanCompanyTitle(title: string, url: string): string {
  const base = title
    .split(/\s[-|–—•]\s/)[0]
    ?.replace(/\s+/g, ' ')
    .trim();
  if (base && base.length >= 3) {
    return base.slice(0, 140);
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return title.slice(0, 140) || 'Empresa encontrada';
  }
}

/**
 * Extrator heurístico de fallback quando o provedor de IA não está configurado
 * ou falha temporariamente: preserva os resultados brutos da Aisa sem perder a busca.
 */
export function extractHeuristicLeads(
  sources: RawAisaSource[],
  input: SearchAisaInput,
): AisaLeadCandidate[] {
  const city = cleanText(input.city);
  const state = normalizeState(input.state);
  const customSector = cleanText(input.segment);

  return sources.map((source) => {
    const combined = `${source.title}\n${source.content}`;
    const cnpj = extractRegexCnpj(combined);
    const phone = extractRegexPhone(combined);
    const email = extractRegexEmail(combined);
    const companyName = cleanCompanyTitle(source.title, source.url);
    const hasDirectContact = Boolean(cnpj || phone || email);

    return {
      companyName,
      tradeName: null,
      cnpj,
      website: cleanText(source.url),
      city,
      state,
      customSector,
      companySize: input.companySize ?? null,
      temperature: hasDirectContact ? 'QUENTE' : 'MORNO',
      fitScore: hasDirectContact ? 75 : 55,
      summary: source.content.replace(/\s+/g, ' ').trim().slice(0, 280) || null,
      sourceUrl: cleanText(source.url),
      sourceEngine: source.engine,
      contact:
        phone || email
          ? {
              name: 'Contato Comercial',
              role: null,
              phone,
              email,
            }
          : null,
    };
  });
}

function mapLlmLeadItems(
  rawPayload: unknown,
  input: SearchAisaInput,
  fallbackEngine: string,
): AisaLeadCandidate[] {
  const root =
    rawPayload && typeof rawPayload === 'object'
      ? (rawPayload as Record<string, unknown>)
      : {};
  const list = Array.isArray(rawPayload)
    ? rawPayload
    : Array.isArray(root.leads)
      ? root.leads
      : [];

  const defaultCity = cleanText(input.city);
  const defaultState = normalizeState(input.state);
  const defaultSector = cleanText(input.segment);

  const mapped: AisaLeadCandidate[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const companyName =
      cleanText(item.company_name) ??
      cleanText(item.companyName) ??
      cleanText(item.name);
    if (!companyName) continue;

    const rawContact =
      item.contact && typeof item.contact === 'object'
        ? (item.contact as Record<string, unknown>)
        : null;
    const contactName = cleanText(rawContact?.name);
    const contactRole = cleanText(rawContact?.role);
    const contactPhone = cleanText(rawContact?.phone);
    const contactEmail = cleanText(rawContact?.email);

    mapped.push({
      companyName,
      tradeName: cleanText(item.trade_name) ?? cleanText(item.tradeName),
      cnpj: normalizeCnpj(item.cnpj),
      website: cleanText(item.website) ?? cleanText(item.url),
      city: cleanText(item.city) ?? defaultCity,
      state: normalizeState(item.state) ?? defaultState,
      customSector:
        cleanText(item.custom_sector) ??
        cleanText(item.customSector) ??
        defaultSector,
      companySize:
        normalizeCompanySize(item.company_size ?? item.companySize) ??
        input.companySize ??
        null,
      temperature: normalizeTemperature(item.temperature),
      fitScore: normalizeFitScore(item.fit_score ?? item.fitScore),
      summary: cleanText(item.summary),
      sourceUrl: cleanText(item.source_url) ?? cleanText(item.sourceUrl) ?? cleanText(item.website),
      sourceEngine: cleanText(item.source_engine) ?? fallbackEngine,
      contact:
        contactName || contactPhone || contactEmail
          ? {
              name: contactName ?? 'Contato Comercial',
              role: contactRole,
              phone: contactPhone,
              email: contactEmail,
            }
          : null,
    });
  }

  return mapped;
}

/**
 * Cliente REST direto para os endpoints da Aisa (`https://api.aisa.one`) e
 * provedores de IA configurados pelo tenant (Aisa Gateway, Gemini, OpenAI,
 * Claude ou endpoint Customizado). Não usa MCP.
 */
@Injectable()
export class AisaClient {
  private readonly logger = new Logger(AisaClient.name);

  async discoverSources(
    baseUrl: string,
    apiKey: string,
    input: SearchAisaInput,
  ): Promise<DiscoverSourcesResult> {
    const cleanBase = (baseUrl || AISA_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const query = buildProspectingQuery(input);
    const maxResults = Math.max(1, Math.min(20, input.maxResults ?? 10));
    const engine = input.engine ?? 'auto';
    const deepExtract = input.deepExtract !== false;
    const warnings: string[] = [];

    if (engine === 'tavily') {
      const sources = await this.searchTavily(cleanBase, apiKey, query, maxResults);
      const enriched = deepExtract
        ? await this.enrichWithTavilyExtract(cleanBase, apiKey, sources, warnings)
        : sources;
      return { query, engineUsed: 'tavily', sources: enriched, warnings };
    }

    if (engine === 'exa') {
      const sources = await this.searchExa(cleanBase, apiKey, query, maxResults);
      return { query, engineUsed: 'exa', sources, warnings };
    }

    if (engine === 'akta') {
      const aktaQuery = [input.segment.trim(), input.city?.trim(), input.state?.trim()]
        .filter(Boolean)
        .join(' ');
      const sources = await this.searchAkta(cleanBase, apiKey, aktaQuery, maxResults);
      return { query: aktaQuery, engineUsed: 'akta', sources, warnings };
    }

    // Modo `auto`: Tavily (+ extract profundo) -> fallback para Exa -> Smart Search.
    let lastError: unknown = null;

    try {
      const tavilySources = await this.searchTavily(
        cleanBase,
        apiKey,
        query,
        maxResults,
      );
      if (tavilySources.length > 0) {
        const enriched = deepExtract
          ? await this.enrichWithTavilyExtract(
              cleanBase,
              apiKey,
              tavilySources,
              warnings,
            )
          : tavilySources;
        return { query, engineUsed: 'tavily', sources: enriched, warnings };
      }
    } catch (error) {
      if (error instanceof BusinessException && error.getStatus() === 401) {
        throw error;
      }
      lastError = error;
      warnings.push(
        `Motor Tavily indisponível (${this.describeError(error)}); alternando para Exa.`,
      );
    }

    try {
      const exaSources = await this.searchExa(cleanBase, apiKey, query, maxResults);
      if (exaSources.length > 0) {
        return { query, engineUsed: 'exa', sources: exaSources, warnings };
      }
    } catch (error) {
      if (error instanceof BusinessException && error.getStatus() === 401) {
        throw error;
      }
      lastError = error;
      warnings.push(
        `Motor Exa indisponível (${this.describeError(error)}); alternando para Smart Search.`,
      );
    }

    try {
      const smartSources = await this.searchSmart(
        cleanBase,
        apiKey,
        query,
        maxResults,
      );
      return { query, engineUsed: 'smart', sources: smartSources, warnings };
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }
      const message = this.describeError(lastError ?? error);
      throw new BusinessException(
        502,
        'AISA_UPSTREAM_ERROR',
        `Não foi possível consultar a API da Aisa: ${message}`,
      );
    }
  }

  async searchTavily(
    baseUrl: string,
    apiKey: string,
    query: string,
    maxResults: number,
  ): Promise<RawAisaSource[]> {
    const data = await this.postJson<{
      results?: Array<{ title?: string; url?: string; content?: string }>;
    }>(
      `${baseUrl}/apis/v1/tavily/search`,
      {
        query,
        search_depth: 'advanced',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      },
      { Authorization: `Bearer ${apiKey}` },
      SEARCH_TIMEOUT_MS,
      'Aisa Tavily',
    );

    return (data.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title?.trim() || item.url || 'Empresa',
        url: item.url as string,
        content: item.content?.trim() || '',
        engine: 'tavily',
      }));
  }

  async enrichWithTavilyExtract(
    baseUrl: string,
    apiKey: string,
    sources: RawAisaSource[],
    warnings: string[],
  ): Promise<RawAisaSource[]> {
    const urls = sources
      .map((s) => s.url)
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 5);
    if (urls.length === 0) return sources;

    try {
      const data = await this.postJson<{
        results?: Array<{ url?: string; raw_content?: string; content?: string }>;
      }>(
        `${baseUrl}/apis/v1/tavily/extract`,
        { urls },
        { Authorization: `Bearer ${apiKey}` },
        EXTRACT_TIMEOUT_MS,
        'Aisa Tavily Extract',
      );

      const extractedByUrl = new Map<string, string>();
      for (const item of data.results ?? []) {
        const text = (item.raw_content ?? item.content ?? '').trim();
        if (item.url && text) {
          extractedByUrl.set(item.url, text.slice(0, 1800));
        }
      }

      return sources.map((source) => {
        const extra = extractedByUrl.get(source.url);
        if (!extra) return source;
        return {
          ...source,
          content: `${source.content}\n[Conteúdo extraído]: ${extra}`.trim(),
        };
      });
    } catch (error) {
      warnings.push(
        `Extração profunda indisponível (${this.describeError(error)}); exibindo dados da busca principal.`,
      );
      return sources;
    }
  }

  async searchExa(
    baseUrl: string,
    apiKey: string,
    query: string,
    maxResults: number,
  ): Promise<RawAisaSource[]> {
    const data = await this.postJson<{
      results?: Array<{ title?: string; url?: string; text?: string; snippet?: string }>;
    }>(
      `${baseUrl}/apis/v1/exa/search`,
      {
        query,
        numResults: maxResults,
        contents: { text: { maxCharacters: 1500 } },
      },
      { Authorization: `Bearer ${apiKey}` },
      SEARCH_TIMEOUT_MS,
      'Aisa Exa',
    );

    return (data.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title?.trim() || item.url || 'Empresa',
        url: item.url as string,
        content: (item.text ?? item.snippet ?? '').trim(),
        engine: 'exa',
      }));
  }

  async searchAkta(
    baseUrl: string,
    apiKey: string,
    query: string,
    maxResults: number,
  ): Promise<RawAisaSource[]> {
    const url = `${baseUrl}/apis/v1/akta/company/search?q=${encodeURIComponent(query)}&limit=${maxResults}`;
    const data = await this.getJson<
      | Array<Record<string, unknown>>
      | {
          data?: Array<Record<string, unknown>>;
          companies?: Array<Record<string, unknown>>;
          results?: Array<Record<string, unknown>>;
        }
    >(url, { Authorization: `Bearer ${apiKey}` }, SEARCH_TIMEOUT_MS, 'Aisa Akta');

    const rows = Array.isArray(data)
      ? data
      : (data.data ?? data.companies ?? data.results ?? []);

    return rows.map((row) => {
      const name =
        cleanText(row.name) ??
        cleanText(row.company_name) ??
        cleanText(row.legal_name) ??
        'Empresa';
      const site =
        cleanText(row.website) ??
        cleanText(row.domain) ??
        cleanText(row.url) ??
        '';
      const normalizedUrl =
        site && !/^https?:\/\//i.test(site) ? `https://${site}` : site;
      const summaryParts = [
        cleanText(row.description),
        cleanText(row.industry),
        cleanText(row.location),
        cleanText(row.city),
        cleanText(row.country),
      ].filter(Boolean);

      return {
        title: name,
        url: normalizedUrl || 'https://api.aisa.one',
        content: summaryParts.join(' • '),
        engine: 'akta',
      };
    });
  }

  async searchSmart(
    baseUrl: string,
    apiKey: string,
    query: string,
    maxResults: number,
  ): Promise<RawAisaSource[]> {
    const url = `${baseUrl}/apis/v1/search/smart?q=${encodeURIComponent(query)}&limit=${maxResults}`;
    const data = await this.getJson<{
      results?: Array<{ title?: string; url?: string; link?: string; snippet?: string; content?: string }>;
      web?: Array<{ title?: string; url?: string; link?: string; snippet?: string; content?: string }>;
    }>(url, { Authorization: `Bearer ${apiKey}` }, SEARCH_TIMEOUT_MS, 'Aisa Smart Search');

    const rows = data.results ?? data.web ?? [];
    return rows
      .filter((item) => item.url || item.link)
      .map((item) => ({
        title: item.title?.trim() || item.url || item.link || 'Empresa',
        url: (item.url ?? item.link) as string,
        content: (item.content ?? item.snippet ?? '').trim(),
        engine: 'smart',
      }));
  }

  async structureLeadsWithLlm(
    config: LlmConfigInput,
    input: SearchAisaInput,
    sources: RawAisaSource[],
  ): Promise<AisaLeadCandidate[]> {
    if (sources.length === 0) {
      return [];
    }

    const prompt = this.buildExtractionPrompt(input, sources);
    let rawText: string;

    switch (config.llmProvider) {
      case 'AISA':
        rawText = await this.callOpenAiCompatible(
          `${config.aisaBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
          config.aisaApiKey,
          config.llmModel,
          prompt,
          true,
          'Aisa Gateway LLM',
        );
        break;
      case 'OPENAI':
        rawText = await this.callOpenAiCompatible(
          'https://api.openai.com/v1/chat/completions',
          config.llmApiKey ?? '',
          config.llmModel,
          prompt,
          true,
          'OpenAI GPT',
        );
        break;
      case 'GEMINI':
        rawText = await this.callGemini(
          config.llmApiKey ?? '',
          config.llmModel,
          prompt,
        );
        break;
      case 'CLAUDE':
        rawText = await this.callClaude(
          config.llmApiKey ?? '',
          config.llmModel,
          prompt,
        );
        break;
      case 'CUSTOM':
        rawText = await this.callOpenAiCompatible(
          normalizeCustomChatUrl(config.llmBaseUrl ?? ''),
          config.llmApiKey ?? '',
          config.llmModel,
          prompt,
          false,
          'Provedor Customizado',
        );
        break;
    }

    const parsed = parseJsonPayload(rawText);
    return mapLlmLeadItems(parsed, input, sources[0]?.engine ?? 'aisa');
  }

  private buildExtractionPrompt(
    input: SearchAisaInput,
    sources: RawAisaSource[],
  ): string {
    const compactSources = sources.slice(0, 15).map((src, idx) => ({
      index: idx + 1,
      title: src.title,
      url: src.url,
      engine: src.engine,
      content: src.content.slice(0, 1400),
    }));

    return [
      'Você é um analista B2B de prospecção comercial no Brasil.',
      `Critérios da busca: segmento="${input.segment}", cidade="${input.city ?? ''}", uf="${input.state ?? ''}", porte="${input.companySize ?? ''}", palavras_chave="${input.keywords ?? ''}".`,
      'Extraia APENAS empresas reais presentes nas fontes abaixo. Nunca invente CNPJ, telefone ou e-mail que não estejam no texto.',
      'Descarte diretórios genéricos (ex.: listas de vagas, notícias sem empresa compradora/fornecedora, Wikipédia) quando não representarem uma empresa prospectável.',
      'Responda SOMENTE com JSON válido no formato:',
      '{"leads":[{"company_name":"","trade_name":null,"cnpj":null,"website":"","city":null,"state":null,"custom_sector":"","company_size":null,"temperature":"QUENTE|MORNO|FRIO","fit_score":0,"summary":"","source_url":"","contact":{"name":null,"role":null,"phone":null,"email":null}}]}',
      `Fontes:\n${JSON.stringify(compactSources)}`,
    ].join('\n\n');
  }

  private async callOpenAiCompatible(
    url: string,
    apiKey: string,
    model: string,
    prompt: string,
    includeJsonFormat: boolean,
    providerLabel: string,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Retorne exclusivamente JSON válido em português.',
        },
        { role: 'user', content: prompt },
      ],
    };

    if (includeJsonFormat) {
      body.response_format = { type: 'json_object' };
    }

    const data = await this.postJson<{
      choices?: Array<{ message?: { content?: string } }>;
    }>(
      url,
      body,
      { Authorization: `Bearer ${apiKey}` },
      SEARCH_TIMEOUT_MS,
      providerLabel,
    );

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${providerLabel} não retornou conteúdo.`);
    }
    return content;
  }

  private async callGemini(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const data = await this.postJson<{
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    }>(
      endpoint,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      },
      {},
      SEARCH_TIMEOUT_MS,
      'Google Gemini',
    );

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Google Gemini não retornou conteúdo.');
    }
    return text;
  }

  private async callClaude(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const data = await this.postJson<{
      content?: Array<{ type?: string; text?: string }>;
    }>(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: 4096,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      SEARCH_TIMEOUT_MS,
      'Anthropic Claude',
    );

    const text = data.content?.find((part) => part.text)?.text;
    if (!text) {
      throw new Error('Anthropic Claude não retornou conteúdo.');
    }
    return text;
  }

  private async postJson<T>(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return this.handleHttpResponse<T>(response, label);
  }

  private async getJson<T>(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    return this.handleHttpResponse<T>(response, label);
  }

  private async handleHttpResponse<T>(
    response: Response,
    label: string,
  ): Promise<T> {
    if (response.ok) {
      return (await response.json()) as T;
    }

    let detail = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      if (text.trim()) {
        detail = `${detail}: ${text.slice(0, 180)}`;
      }
    } catch {
      // Ignora erro ao ler corpo de falha.
    }

    if (response.status === 401 || response.status === 403) {
      throw new BusinessException(
        401,
        'AISA_AUTH_ERROR',
        `Credencial recusada em ${label} (${detail}). Confira a chave configurada.`,
      );
    }

    this.logger.warn(`Falha em ${label}: ${detail}`);
    throw new Error(`${label} respondeu ${detail}`);
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
