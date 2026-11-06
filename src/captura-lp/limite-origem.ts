/**
 * Limite por origem, em memória do processo.
 *
 * A rota de captura é pública (a landing page é um site terceiro), então
 * precisa de um freio contra envio em massa. O freio é simples de propósito:
 * um contador por origem dentro de uma janela deslizante.
 *
 * **Falha aberto:** se o limitador errar, a entrega passa. Um problema do
 * limitador não pode custar um lead — o pior caso de um limite exagerado é
 * deixar passar um abusing, o pior caso de um limite quebrado é perder
 * pedido de orçamento.
 */

export interface OpcoesDoLimite {
  /** Quantas entregas a mesma origem pode fazer dentro da janela. */
  maximo: number;
  /** Tamanho da janela, em milissegundos. */
  janelaMs: number;
  /** Relógio — injetável para teste determinístico. */
  agora?: () => number;
}

export interface LimiteDeOrigem {
  /**
   * Registra uma tentativa.
   *
   * @returns `true` quando a origem está dentro do limite; `false` quando
   *   estourou.
   */
  permitir(chave: string): boolean;
  /** Esquece todos os registros (usado no teste). */
  limpar(): void;
}

/** Quantas origens differentes ficam guardadas antes da limpeza. */
const LIMITE_DE_CHAVES = 5000;

/**
 * Cria um limitador por origem.
 *
 * @param opcoes máximo por janela e o relógio usado.
 */
export function criarLimiteDeOrigem(opcoes: OpcoesDoLimite): LimiteDeOrigem {
  const agora = opcoes.agora ?? ((): number => Date.now());
  const registros = new Map<string, number[]>();

  function esquecerChavesAntigas(instante: number): void {
    if (registros.size <= LIMITE_DE_CHAVES) return;

    for (const [chave, marcas] of registros) {
      if (marcas.every((marca) => instante - marca >= opcoes.janelaMs)) {
        registros.delete(chave);
      }
    }
  }

  return {
    permitir(chave: string): boolean {
      const instante = agora();
      const dentro = (registros.get(chave) ?? []).filter(
        (marca) => instante - marca < opcoes.janelaMs,
      );

      dentro.push(instante);
      registros.set(chave, dentro);
      esquecerChavesAntigas(instante);

      return dentro.length <= opcoes.maximo;
    },
    limpar(): void {
      registros.clear();
    },
  };
}
