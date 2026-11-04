import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Módulo global do Prisma — `PrismaService` fica disponível em qualquer
 * módulo sem precisar importar o módulo de novo (task-s01-03).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
