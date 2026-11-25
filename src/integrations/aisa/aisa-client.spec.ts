import { vi } from 'vitest';
import {
  AisaClient,
  buildProspectingQuery,
  extractHeuristicLeads,
} from './aisa-client.js';

describe('AisaClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('monta a query com segmento, localização, porte e palavras-chave', () => {
    const query = buildProspectingQuery({
      segment: 'Energia Solar',
      city: 'Belo Horizonte',
      state: 'mg',
      companySize: 'EPP',
      keywords: 'integradores B2B',
    });

    expect(query).toContain('Energia Solar');
    expect(query).toContain('empresa pequeno porte EPP');
    expect(query).toContain('Belo Horizonte MG');
    expect(query).toContain('integradores B2B');
  });

  it('consulta Tavily e enriquece via Tavily Extract quando deepExtract=true', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Solar Minas Engenharia',
                url: 'https://solarminas.com.br',
                content: 'Integradora em BH.',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                url: 'https://solarminas.com.br',
                raw_content: 'CNPJ 12.345.678/0001-90 contato@solarminas.com.br',
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const client = new AisaClient();
    const res = await client.discoverSources('https://api.aisa.one', 'sk-aisa', {
      segment: 'Energia Solar',
      city: 'Belo Horizonte',
      state: 'MG',
      engine: 'auto',
      deepExtract: true,
      maxResults: 5,
    });

    expect(res.engineUsed).toBe('tavily');
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0].content).toContain('12.345.678/0001-90');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.aisa.one/apis/v1/tavily/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-aisa' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.aisa.one/apis/v1/tavily/extract',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('faz fallback de Tavily para Exa quando Tavily falha no modo auto', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('erro', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Exa Empresa LTDA',
                url: 'https://exaempresa.com.br',
                text: 'Empresa de engenharia.',
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const client = new AisaClient();
    const res = await client.discoverSources('https://api.aisa.one', 'sk-aisa', {
      segment: 'Engenharia',
      engine: 'auto',
    });

    expect(res.engineUsed).toBe('exa');
    expect(res.warnings[0]).toContain('Tavily indisponível');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.aisa.one/apis/v1/exa/search',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('suporta Gemini, Claude e endpoint Customizado na estruturação dos leads', async () => {
    const client = new AisaClient();
    const sources = [
      {
        title: 'Alfa Energia',
        url: 'https://alfa.com.br',
        content: 'CNPJ 11.222.333/0001-44',
        engine: 'tavily',
      },
    ];
    const llmResponse = JSON.stringify({
      leads: [
        {
          company_name: 'Alfa Energia LTDA',
          cnpj: '11222333000144',
          website: 'https://alfa.com.br',
          temperature: 'QUENTE',
          fit_score: 90,
          summary: 'Empresa de energia.',
        },
      ],
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: llmResponse }] } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ content: [{ type: 'text', text: llmResponse }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: llmResponse } }] }),
          { status: 200 },
        ),
      );

    const geminiLeads = await client.structureLeadsWithLlm(
      {
        aisaApiKey: 'sk-aisa',
        aisaBaseUrl: 'https://api.aisa.one',
        llmProvider: 'GEMINI',
        llmModel: 'gemini-2.5-flash',
        llmApiKey: 'gem-123',
        llmBaseUrl: null,
      },
      { segment: 'Energia' },
      sources,
    );
    expect(geminiLeads[0].companyName).toBe('Alfa Energia LTDA');
    expect(fetchMock.mock.calls[0][0]).toContain(
      'generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );

    await client.structureLeadsWithLlm(
      {
        aisaApiKey: 'sk-aisa',
        aisaBaseUrl: 'https://api.aisa.one',
        llmProvider: 'CLAUDE',
        llmModel: 'claude-sonnet-4-5',
        llmApiKey: 'ant-123',
        llmBaseUrl: null,
      },
      { segment: 'Energia' },
      sources,
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.anthropic.com/v1/messages',
    );

    await client.structureLeadsWithLlm(
      {
        aisaApiKey: 'sk-aisa',
        aisaBaseUrl: 'https://api.aisa.one',
        llmProvider: 'CUSTOM',
        llmModel: 'llama-3.3-70b',
        llmApiKey: 'cust-123',
        llmBaseUrl: 'https://llm.exemplo.com/v1',
      },
      { segment: 'Energia' },
      sources,
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://llm.exemplo.com/v1/chat/completions',
    );
  });

  it('extrai CNPJ, telefone e e-mail por heurística quando não usa LLM', () => {
    const leads = extractHeuristicLeads(
      [
        {
          title: 'Beta Solar — Soluções em Energia',
          url: 'https://betasolar.com.br',
          content:
            'CNPJ 22.333.444/0001-55 WhatsApp (31) 98888-7777 vendas@betasolar.com.br',
          engine: 'tavily',
        },
      ],
      { segment: 'Energia Solar', city: 'Contagem', state: 'MG' },
    );

    expect(leads[0]).toMatchObject({
      companyName: 'Beta Solar',
      cnpj: '22333444000155',
      city: 'Contagem',
      state: 'MG',
      temperature: 'QUENTE',
      contact: {
        phone: '31988887777',
        email: 'vendas@betasolar.com.br',
      },
    });
  });
});
