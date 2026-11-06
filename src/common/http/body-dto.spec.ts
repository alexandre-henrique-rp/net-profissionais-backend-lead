import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Os DTOs do corpo da requisição precisam ser importados como **valor**.
 *
 * Com `emitDecoratorMetadata` ligado, o Nest descobre o tipo do `@Body()` pela
 * metadata `design:paramtypes`. Um `import type` faz o TypeScript apagar a
 * importação: o metatype vira `Object`, o `ValidationPipe` global entra em
 * modo "objeto simples" e — como o projeto liga `whitelist: true` — **descarta
 * todas as propriedades do corpo**. O pedido chega no controller vazio, sem
 * erro de validação, e o lead some.
 *
 * O sintoma é silencioso no teste e aparece só no build de produção (é o
 * `tsc` que emite a metadata; o vitest/esbuild não emite), por isso este
 * teste existe: ele lê o código-fonte e barra o padrão.
 */
describe('DTO do corpo da requisição', () => {
  const raizSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  /** Todos os controllers do backend. */
  function controllers(): string[] {
    const achados: string[] = [];

    const varre = (pasta: string): void => {
      for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
        if (entrada.name === 'generated' || entrada.name === 'node_modules') continue;

        const completo = join(pasta, entrada.name);

        if (entrada.isDirectory()) {
          varre(completo);
          continue;
        }

        if (entrada.name.endsWith('.controller.ts')) achados.push(completo);
      }
    };

    varre(raizSrc);

    return achados;
  }

  it('AC-224: nenhum @Body() usa DTO importado só como tipo @spec:AC-224', () => {
    const infratores: string[] = [];

    for (const arquivo of controllers()) {
      const conteudo = readFileSync(arquivo, 'utf8');
      const corpos = [
        ...conteudo.matchAll(/@Body\(\)\s*\w+\s*:\s*([A-Za-z0-9_]+)/g),
      ];

      for (const [, dto] of corpos) {
        const somenteTipo = new RegExp(
          `import\\s+type\\s+\\{[^}]*\\b${dto}\\b[^}]*\\}`,
          'm',
        );

        if (somenteTipo.test(conteudo)) {
          infratores.push(`${arquivo.replace(raizSrc, 'src')} → ${dto}`);
        }
      }
    }

    expect(infratores).toEqual([]);
  });

  it('AC-224: os controllers com @Body() importam o DTO como valor @spec:AC-224', () => {
    const semValor: string[] = [];

    for (const arquivo of controllers()) {
      const conteudo = readFileSync(arquivo, 'utf8');
      const corpos = [
        ...conteudo.matchAll(/@Body\(\)\s*\w+\s*:\s*([A-Za-z0-9_]+)/g),
      ];

      for (const [, dto] of corpos) {
        const comoValor = new RegExp(`import\\s+\\{[^}]*\\b${dto}\\b[^}]*\\}`, 'm');

        if (!comoValor.test(conteudo)) {
          semValor.push(`${arquivo.replace(raizSrc, 'src')} → ${dto}`);
        }
      }
    }

    expect(semValor).toEqual([]);
  });
});
