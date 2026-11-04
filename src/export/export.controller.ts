import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { ExportQueryDto } from './dto/export-query.dto.js';
import { ExportService } from './export.service.js';

/**
 * Exportação filtrada de leads (`⬇ Exportar PDF/CSV` das telas 03-D e 04-B).
 *
 * ⚠️ **Ordem de registro:** `GET /leads/export` divide o prefixo com
 * `GET /leads/:id` (módulo de detalhe do lead). O `ExportController` precisa
 * ser registrado **antes** do controller de detalhe no `app.module.ts`, senão
 * o Nest casa `export` com o parâmetro `:id` e a rota devolve 404/400 no lugar
 * do arquivo.
 */
@ApiTags('leads')
@ApiCookieAuth('np_session')
@Controller('leads')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('export')
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiProduces('text/csv', 'application/pdf')
  @ApiOperation({
    summary: 'Exporta a lista de leads filtrada em CSV ou PDF',
    description:
      'Aplica os mesmos filtros da listagem (busca, UF, setor, porte, temperatura, etapa, responsável, faixa de ticket e período). Vendedor exporta apenas a própria carteira. Limite de 5000 linhas por arquivo.',
  })
  @ApiResponse({
    status: 200,
    description: 'Arquivo para download (`text/csv` com BOM UTF-8 ou `application/pdf`).',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — filtro ou período inválido.' })
  @ApiResponse({ status: 401, description: '`UNAUTHORIZED` — sessão ausente ou expirada.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — papel operacional sem acesso.' })
  async exportLeads(
    @CurrentUser() user: AuthUser,
    @Query() query: ExportQueryDto,
  ): Promise<StreamableFile> {
    const file = await this.exportService.exportLeads(user, query);

    return new StreamableFile(file.buffer, {
      type: file.content_type,
      disposition: `attachment; filename="${file.filename}"`,
      length: file.buffer.length,
    });
  }
}
