import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BusinessException } from '../../common/errors/business.exception.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { BrasilApiService } from './brasilapi.service.js';
import { mapCnpjToLeadInput } from './cnpj.mapper.js';
import type { MappedCnpjLeadInput } from './cnpj.types.js';

/** Código de contrato do módulo quando a BrasilAPI não devolve o CNPJ. */
export const CNPJ_NOT_FOUND = 'CNPJ_NOT_FOUND';

/**
 * Autopreenchimento do Modal de Cadastro Híbrido (`03-C-D.Modal-CadastroLead`).
 *
 * Fica sob `/integrations` porque é uma consulta externa, não um recurso de
 * lead — e devolve o payload já no formato do `POST /leads/manual`.
 */
@ApiTags('integrations')
@ApiCookieAuth('np_session')
@Controller('integrations/cnpj')
export class BrasilApiController {
  constructor(private readonly brasilApi: BrasilApiService) {}

  @Get(':cnpj')
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary:
      'Consulta um CNPJ e devolve os dados para autopreencher o cadastro',
  })
  @ApiParam({
    name: 'cnpj',
    example: '33456789000102',
    description: '14 dígitos (aceita máscara).',
  })
  @ApiResponse({
    status: 200,
    description: 'Dados fiscais mapeados para o formulário de cadastro.',
    schema: {
      example: {
        companyName: 'Solar Tech Engenharia LTDA',
        tradeName: 'Solar Tech',
        primaryCnae: '4321500',
        cnaeDescription: 'Instalação e manutenção elétrica',
        capitalSocial: 150000,
        postalCode: '30130-110',
        street: 'Av. Afonso Pena',
        number: '1500',
        complement: 'Sala 402',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
        sector: 'CONSTRUCAO',
        companySize: 'EPP',
        contacts: [
          {
            name: 'Marcelo Dias',
            role: 'Sócio-Diretor',
            isDecisionMaker: true,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  @ApiResponse({
    status: 422,
    description: 'CNPJ inválido ou não encontrado nas bases públicas.',
  })
  async lookupCnpj(@Param('cnpj') cnpj: string): Promise<MappedCnpjLeadInput> {
    const data = await this.brasilApi.lookupCnpj(cnpj);

    if (!data) {
      throw new BusinessException(
        422,
        CNPJ_NOT_FOUND,
        'Não foi possível obter os dados deste CNPJ. Preencha o cadastro manualmente.',
      );
    }

    return mapCnpjToLeadInput(data);
  }
}
