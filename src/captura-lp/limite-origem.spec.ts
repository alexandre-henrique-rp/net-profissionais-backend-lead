import { criarLimiteDeOrigem } from './limite-origem';

describe('limite por origem', () => {
  it('AC-236: libera até o máximo e barra o que passa @spec:AC-236', () => {
    let agora = 1_000_000;
    const limite = criarLimiteDeOrigem({
      maximo: 3,
      janelaMs: 60_000,
      agora: () => agora,
    });

    expect(limite.permitir('1.2.3.4')).toBe(true);
    expect(limite.permitir('1.2.3.4')).toBe(true);
    expect(limite.permitir('1.2.3.4')).toBe(true);
    expect(limite.permitir('1.2.3.4')).toBe(false);

    // outra origem tem o próprio contador
    expect(limite.permitir('5.6.7.8')).toBe(true);

    // e a janela deslizante: passado o prazo, a origem volta a ser liberada
    agora += 60_001;
    expect(limite.permitir('1.2.3.4')).toBe(true);
  });

  it('AC-236: a janela é deslizante, não uma trava permanente @spec:AC-236', () => {
    let agora = 2_000_000;
    const limite = criarLimiteDeOrigem({
      maximo: 2,
      janelaMs: 10_000,
      agora: () => agora,
    });

    limite.permitir('9.9.9.9');
    agora += 5_000;
    limite.permitir('9.9.9.9');
    expect(limite.permitir('9.9.9.9')).toBe(false);

    // a janela desliza: passados 10 s, as marcas antigas saem da contagem
    agora += 11_000;
    expect(limite.permitir('9.9.9.9')).toBe(true);
  });
});
