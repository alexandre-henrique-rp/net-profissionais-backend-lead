import type { RedisService } from '../../redis/redis.service.js';
import { BrasilApiService, normalizeCnpj } from './brasilapi.service.js';
import type { CnpjData } from './cnpj.types.js';

const CNPJ = '33456789000102';
const API_URL = `https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`;

const PAYLOAD: CnpjData = {
  cnpj: CNPJ,
  razao_social: 'Solar Tech Engenharia LTDA',
  nome_fantasia: 'Solar Tech',
  uf: 'MG',
  porte: 'EPP',
};

const OPEN_CNPJ_PAYLOAD = {
  cnpj: CNPJ,
  razao_social: 'Solar Tech Engenharia LTDA',
  nome_fantasia: 'Solar Tech',
  cnae_principal: '4321500',
  cnaes: [{ codigo: '4321500', descricao: 'Instalação elétrica' }],
  capital_social: '1.234.567,89',
  porte_empresa: 'Empresa de Pequeno Porte',
  cep: '30130-110',
  logradouro: 'Av. Afonso Pena',
  numero: '1500',
  complemento: 'Sala 402',
  bairro: 'Centro',
  municipio: 'Belo Horizonte',
  uf: 'MG',
  QSA: [{ nome_socio: 'Marcelo Dias', qualificacao_socio: 'Sócio-Diretor' }],
};

/** Dublê do cache de CNPJ — sem Redis no ar. */
function createRedisDouble() {
  return {
    getCnpjCache: vi.fn<(cnpj: string) => Promise<string | null>>(),
    setCnpjCache: vi.fn<(cnpj: string, value: string) => Promise<void>>(),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('BrasilApiService', () => {
  let redis: ReturnType<typeof createRedisDouble>;
  let service: BrasilApiService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    redis = createRedisDouble();
    redis.getCnpjCache.mockResolvedValue(null);
    redis.setCnpjCache.mockResolvedValue(undefined);

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    service = new BrasilApiService(redis as unknown as RedisService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('normalizeCnpj', () => {
    it('reduz CNPJ com máscara aos 14 dígitos', () => {
      expect(normalizeCnpj('33.456.789/0001-02')).toBe(CNPJ);
      expect(normalizeCnpj(CNPJ)).toBe(CNPJ);
    });

    it('recusa documento que não tem exatamente 14 dígitos', () => {
      expect(normalizeCnpj('3345678900010')).toBeNull();
      expect(normalizeCnpj('334567890001023')).toBeNull();
      expect(normalizeCnpj('')).toBeNull();
      expect(normalizeCnpj('abcdefghijklmn')).toBeNull();
      expect(normalizeCnpj(null)).toBeNull();
      expect(normalizeCnpj(undefined)).toBeNull();
    });
  });

  it('cache hit não chama a BrasilAPI @spec:AC-082', async () => {
    redis.getCnpjCache.mockResolvedValue(JSON.stringify(PAYLOAD));

    await expect(service.lookupCnpj(CNPJ)).resolves.toEqual(PAYLOAD);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(redis.setCnpjCache).not.toHaveBeenCalled();
  });

  it('cache miss consulta a URL correta e grava o resultado no cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAYLOAD));

    await expect(service.lookupCnpj(CNPJ)).resolves.toEqual(PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(redis.setCnpjCache).toHaveBeenCalledWith(
      CNPJ,
      JSON.stringify(PAYLOAD),
    );
  });

  it('normaliza o CNPJ com máscara antes de consultar', async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAYLOAD));

    await service.lookupCnpj('33.456.789/0001-02');

    expect(redis.getCnpjCache).toHaveBeenCalledWith(CNPJ);
    expect(fetchMock.mock.calls[0][0]).toBe(API_URL);
  });

  it('CNPJ inválido devolve null sem consultar a API nem o cache', async () => {
    await expect(service.lookupCnpj('123')).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(redis.getCnpjCache).not.toHaveBeenCalled();
  });

  it('404 da BrasilAPI devolve null sem tentar outro provedor nem gravar cache', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: 'CNPJ não encontrado' }, 404),
    );

    await expect(service.lookupCnpj(CNPJ)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redis.setCnpjCache).not.toHaveBeenCalled();
  });

  it('usa OpenCNPJ quando BrasilAPI bloqueia o servidor e mapeia os dados @spec:AC-178', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, 403))
      .mockResolvedValueOnce(jsonResponse(OPEN_CNPJ_PAYLOAD));

    const result = await service.lookupCnpj(CNPJ);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.opencnpj.org/${CNPJ}`,
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toMatchObject({
      razao_social: 'Solar Tech Engenharia LTDA',
      nome_fantasia: 'Solar Tech',
      cnae_fiscal: '4321500',
      cnae_fiscal_descricao: 'Instalação elétrica',
      capital_social: 1234567.89,
      cep: '30130-110',
      logradouro: 'Av. Afonso Pena',
      numero: '1500',
      complemento: 'Sala 402',
      bairro: 'Centro',
      municipio: 'Belo Horizonte',
      uf: 'MG',
      porte: 'EPP',
      qsa: [
        { nome_socio: 'Marcelo Dias', qualificacao_socio: 'Sócio-Diretor' },
      ],
    });
    expect(redis.setCnpjCache).toHaveBeenCalledWith(
      CNPJ,
      JSON.stringify(result),
    );
  });

  it.each([500, 503])(
    'usa OpenCNPJ quando BrasilAPI responde %i',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, status))
        .mockResolvedValueOnce(jsonResponse(OPEN_CNPJ_PAYLOAD));

      await expect(service.lookupCnpj(CNPJ)).resolves.toMatchObject({
        razao_social: OPEN_CNPJ_PAYLOAD.razao_social,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('erro de rede devolve null em vez de propagar a exceção @spec:AC-083', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(service.lookupCnpj(CNPJ)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(redis.setCnpjCache).not.toHaveBeenCalled();
  });

  it('timeout da consulta devolve null em vez de travar o modal', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeoutError);

    await expect(service.lookupCnpj(CNPJ)).resolves.toBeNull();
    expect(redis.setCnpjCache).not.toHaveBeenCalled();
  });

  it('JSON inválido no cache é tratado como miss', async () => {
    redis.getCnpjCache.mockResolvedValue('{nao-e-json');
    fetchMock.mockResolvedValue(jsonResponse(PAYLOAD));

    await expect(service.lookupCnpj(CNPJ)).resolves.toEqual(PAYLOAD);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Redis fora do ar vira cache miss', async () => {
    redis.getCnpjCache.mockRejectedValue(new Error('connect ECONNREFUSED'));
    fetchMock.mockResolvedValue(jsonResponse(PAYLOAD));

    await expect(service.lookupCnpj(CNPJ)).resolves.toEqual(PAYLOAD);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falha ao gravar o cache não derruba a resposta', async () => {
    redis.setCnpjCache.mockRejectedValue(new Error('connect ECONNREFUSED'));
    fetchMock.mockResolvedValue(jsonResponse(PAYLOAD));

    await expect(service.lookupCnpj(CNPJ)).resolves.toEqual(PAYLOAD);
  });
});
