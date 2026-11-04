import { Module } from '@nestjs/common';
import { BrasilApiModule } from '../integrations/brasilapi/brasilapi.module.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

/**
 * Módulo do Pool de leads e do cadastro híbrido.
 *
 * Importa `BrasilApiModule` para que a rota de consulta de CNPJ suba junto
 * com o módulo — o frontend do modal 03-C-D só precisa deste módulo no app.
 * `PrismaService` e `RedisService` vêm dos módulos globais.
 */
@Module({
  imports: [BrasilApiModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
