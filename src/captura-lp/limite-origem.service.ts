import { Injectable, Logger } from '@nestjs/common';
import { criarLimiteDeOrigem } from './limite-origem.js';

/** Quantas entregas a mesma origem faz em dez minutos. */
export const MAXIMO_POR_ORIGEM = 20;

/** Tamanho da janela do limite, em milissegundos. */
export const JANELA_DO_LIMITE_MS = 10 * 60 * 1000;

/**
 * Freio de envio em massa da rota de captura.
 *
 * Fica em memória do processo: o backend roda em um container só, então o
 * limite é do processo. O limitador **falha aberto** — se algo der errado
 * aqui, a entrega passa. Perder um lead por causa do freio é pior do que
 * deixar passar uma entrega a mais.
 */
@Injectable()
export class LimiteDeOrigemService {
  private readonly logger = new Logger(LimiteDeOrigemService.name);
  private readonly limite = criarLimiteDeOrigem({
    maximo: MAXIMO_POR_ORIGEM,
    janelaMs: JANELA_DO_LIMITE_MS,
  });

  /**
   * Registra uma tentativa da origem.
   *
   * @returns `true` quando a origem está dentro do limite.
   */
  permitir(origem: string): boolean {
    try {
      return this.limite.permitir(origem);
    } catch (erro) {
      this.logger.warn(
        `limitador de origem falhou — liberando a entrega: ${
          erro instanceof Error ? erro.name : 'erro desconhecido'
        }`,
      );

      return true;
    }
  }
}
