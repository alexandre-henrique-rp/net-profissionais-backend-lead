import { Module } from '@nestjs/common';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

/**
 * Exportação de leads em CSV/PDF.
 *
 * `ExportService` é exportado para que relatórios futuros (dashboard, funil)
 * reaproveitem a mesma serialização. `PrismaService` vem do módulo global.
 */
@Module({
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
