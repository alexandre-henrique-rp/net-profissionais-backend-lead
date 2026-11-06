import 'dotenv/config';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { PipelineModule } from './pipeline/pipeline.module.js';
import { ExportModule } from './export/export.module.js';
import { LeadDetailModule } from './lead-detail/lead-detail.module.js';
import { WebhookModule } from './webhook/webhook.module.js';
import { CapturaLpModule } from './captura-lp/captura-lp.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { MailModule } from './mail/mail.module.js';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard.js';
import { RolesGuard } from './common/auth/roles.guard.js';
import { ApiResponseInterceptor } from './common/http/api-response.interceptor.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { env, validateEnv } from './config/env.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Valida o ambiente na subida: variável faltando derruba o processo com o
    // nome do problema, em vez de virar `undefined` numa requisição.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ObserveModule.forRootAsync({
      useFactory: () => ({
        appKey: env().OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
        appSecret: env().OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
        serviceId: 'backend',
      }),
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    MailModule,
    UsersModule,

    // ---------------------------------------------------------------------
    // ORDEM IMPORTA para as rotas sob `/leads`.
    //
    // O Express casa rotas na ordem de registro. O controller de `lead-detail`
    // declara `GET /leads/:id`; se fosse registrado antes, engoliria
    // `/leads/pool`, `/leads/pipeline` e `/leads/export`. Por isso os
    // controllers com caminho literal vêm primeiro e o paramétrico por último.
    // ---------------------------------------------------------------------
    LeadsModule,
    PipelineModule,
    ExportModule,
    LeadDetailModule,

    WebhookModule,
    CapturaLpModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    // Autenticação e autorização valem para a API inteira: cada controller
    // decide o que é público com `@Public()` e quem entra com `@Roles(...)`.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    // O envelope `{ success, data, meta }` e o formato de erro são aplicados
    // globalmente — nenhum controller precisa (nem deve) montá-los à mão.
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
