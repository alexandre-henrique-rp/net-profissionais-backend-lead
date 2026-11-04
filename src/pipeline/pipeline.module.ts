import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller.js';
import { PipelineEventsService } from './pipeline-events.service.js';
import { PipelineService } from './pipeline.service.js';

/**
 * Funil de Vendas (Kanban, Lista e overlays de card).
 *
 * O `PipelineEventsService` é exportado para que o futuro gateway WebSocket
 * (que ainda não existe nesta sprint) assine `stream(tenantId)` sem precisar
 * importar o service do funil.
 */
@Module({
  controllers: [PipelineController],
  providers: [PipelineService, PipelineEventsService],
  exports: [PipelineService, PipelineEventsService],
})
export class PipelineModule {}
