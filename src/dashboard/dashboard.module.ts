import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Dashboards por perfil.
 *
 * `DashboardService` é exportado porque a tela de homologação e o futuro
 * relatório consolidado reaproveitam as mesmas agregações. `PrismaService`
 * vem do módulo global.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
