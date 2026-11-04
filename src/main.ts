import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp } from './app.setup.js';
import { env } from './config/env.js';

async function bootstrap() {
  // Valida o ambiente antes de subir qualquer coisa.
  const config = env();

  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    // Mantém o corpo bruto disponível em `req.rawBody`: o webhook assina os
    // bytes originais com HMAC-SHA256 e `JSON.stringify(req.body)` não os
    // reproduz (ordem de chaves, espaços e escape de acentos se perdem).
    rawBody: true,
  });

  configureApp(app);

  // SIGTERM/SIGINT (deploy, orquestrador, Ctrl+C) passam a fechar o app de
  // forma graciosa: para de aceitar conexões e dispara `onModuleDestroy` do
  // Prisma (`$disconnect`) e do Redis (`disconnect`). Sem isso o Node mata o
  // processo na hora e as conexões ficam penduradas até o timeout do banco.
  app.enableShutdownHooks();

  await app.listen(config.PORT);
}
await bootstrap();
