import {
  LOSS_REASON_CODES,
  LOSS_REASONS,
  lossReasonLabel,
  normalizeLossReasonCode,
} from './loss-reasons.js';

/** Os 6 códigos canônicos persistidos em `TenantLead.lossReasonCode`. */
const CANONICAL_CODES = [
  'preco',
  'concorrencia',
  'sem_orcamento',
  'timing',
  'sem_interesse',
  'outro',
];

/** Nomes longos usados pela especificação de produto (`task-s04-04`). */
const SPEC_ALIASES: Record<string, string> = {
  preco_alto_fora_orcamento: 'preco',
  fechou_concorrente: 'concorrencia',
  sem_verba_cancelado: 'sem_orcamento',
  cliente_sumiu_sem_retorno: 'sem_interesse',
  desistencia_contratacao: 'sem_interesse',
  outro_motivo_comercial: 'outro',
};

describe('loss-reasons', () => {
  it('aceita os 6 códigos canônicos', () => {
    expect(LOSS_REASON_CODES).toEqual(CANONICAL_CODES);

    for (const code of CANONICAL_CODES) {
      expect(normalizeLossReasonCode(code)).toBe(code);
    }
  });

  it('normaliza os aliases longos da spec para o código canônico', () => {
    for (const [alias, canonical] of Object.entries(SPEC_ALIASES)) {
      expect(normalizeLossReasonCode(alias)).toBe(canonical);
    }
  });

  it('normaliza caixa e espaços em volta do código', () => {
    expect(normalizeLossReasonCode('  PRECO  ')).toBe('preco');
    expect(normalizeLossReasonCode('Fechou_Concorrente')).toBe('concorrencia');
  });

  it('recusa código fora do catálogo @spec:AC-095', () => {
    expect(normalizeLossReasonCode('mudou_de_ideia')).toBeNull();
    expect(normalizeLossReasonCode('preço')).toBeNull();
    expect(normalizeLossReasonCode('')).toBeNull();
    expect(normalizeLossReasonCode(undefined)).toBeNull();
    expect(normalizeLossReasonCode(null)).toBeNull();
  });

  it('devolve o rótulo legível de cada motivo', () => {
    for (const reason of LOSS_REASONS) {
      expect(lossReasonLabel(reason.code)).toBe(reason.label);
      expect(reason.label.length).toBeGreaterThan(0);
    }
  });

  it('devolve o próprio código quando o motivo é desconhecido', () => {
    expect(lossReasonLabel('inexistente')).toBe('inexistente');
  });
});
