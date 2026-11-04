import { BusinessException } from '../errors/business.exception.js';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPageMeta,
  resolvePagination,
} from './pagination.js';

describe('resolvePagination', () => {
  it('usa página 1 e limite 20 quando nada é informado', () => {
    expect(resolvePagination()).toEqual({ page: 1, limit: 20 });
    expect(DEFAULT_PAGE).toBe(1);
    expect(DEFAULT_PAGE_SIZE).toBe(20);
  });

  it('repassa os valores válidos informados', () => {
    expect(resolvePagination(3, 50)).toEqual({ page: 3, limit: 50 });
  });

  it('aceita string numérica vinda da query string', () => {
    expect(
      resolvePagination('2' as unknown as number, '10' as unknown as number),
    ).toEqual({
      page: 2,
      limit: 10,
    });
  });

  it('recusa limite acima de 100 com 400 INVALID_PAGINATION @spec:AC-065', () => {
    let capturado: unknown;

    try {
      resolvePagination(1, MAX_PAGE_SIZE + 1);
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(BusinessException);
    const business = capturado as BusinessException;
    expect(business.getStatus()).toBe(400);
    expect(business.code).toBe('INVALID_PAGINATION');
    expect(business.message).toContain('100');
  });

  it('aceita exatamente o limite máximo', () => {
    expect(resolvePagination(1, MAX_PAGE_SIZE)).toEqual({
      page: 1,
      limit: 100,
    });
  });

  it('cai no default quando o valor não é um número (NaN)', () => {
    expect(resolvePagination(Number.NaN, Number.NaN)).toEqual({
      page: 1,
      limit: 20,
    });
    expect(
      resolvePagination(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    ).toEqual({
      page: 1,
      limit: 20,
    });
  });

  it('cai no default para zero e valores negativos', () => {
    expect(resolvePagination(0, 0)).toEqual({
      page: DEFAULT_PAGE,
      limit: DEFAULT_PAGE_SIZE,
    });
    expect(resolvePagination(-3, -7)).toEqual({
      page: DEFAULT_PAGE,
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it('trunca valores fracionários', () => {
    expect(resolvePagination(2.9, 15.7)).toEqual({ page: 2, limit: 15 });
  });
});

describe('buildPageMeta', () => {
  it('sinaliza has_more quando ainda há itens depois da página', () => {
    expect(buildPageMeta(1, 20, 45)).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      has_more: true,
    });
  });

  it('não sinaliza has_more na última página', () => {
    expect(buildPageMeta(3, 20, 45)).toEqual({
      page: 3,
      limit: 20,
      total: 45,
      has_more: false,
    });
  });

  it('não sinaliza has_more quando o total é exatamente o fim da página', () => {
    expect(buildPageMeta(2, 20, 40).has_more).toBe(false);
    expect(buildPageMeta(1, 20, 20).has_more).toBe(false);
  });

  it('sinaliza has_more quando sobra um único item', () => {
    expect(buildPageMeta(1, 20, 21).has_more).toBe(true);
  });

  it('trata total zero e total inválido sem quebrar', () => {
    expect(buildPageMeta(1, 20, 0)).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    });
    expect(buildPageMeta(1, 20, Number.NaN).total).toBe(0);
    expect(buildPageMeta(1, 20, -5).total).toBe(0);
  });
});
