import { Module } from '@nestjs/common';
import { BrasilApiModule } from '../brasilapi/brasilapi.module.js';
import { AisaClient } from './aisa-client.js';
import { AisaController } from './aisa.controller.js';
import { AisaService } from './aisa.service.js';

/**
 * Módulo de prospecção de leads pela API REST da Aisa (`https://api.aisa.one`).
 */
@Module({
  imports: [BrasilApiModule],
  controllers: [AisaController],
  providers: [AisaService, AisaClient],
  exports: [AisaService],
})
export class AisaModule {}
