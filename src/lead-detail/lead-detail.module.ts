import { Module } from '@nestjs/common';
import { LeadDetailController } from './lead-detail.controller.js';
import { LeadDetailService } from './lead-detail.service.js';

/**
 * Gaveta lateral do lead: ficha completa, linha do tempo e desvinculação.
 *
 * `PrismaService` vem do módulo global do Prisma, então o módulo não precisa
 * de `imports`. O `LeadDetailService` é exportado para que o futuro gateway de
 * WebSocket (eventos `pool:lead_returned` / `pipeline:lead_removed`) notifique
 * o Pool e o Kanban a partir da própria devolução, sem reimplementar a regra.
 */
@Module({
  controllers: [LeadDetailController],
  providers: [LeadDetailService],
  exports: [LeadDetailService],
})
export class LeadDetailModule {}
