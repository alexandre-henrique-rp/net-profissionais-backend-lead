import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth.types.js';
import { CurrentTenant } from '../common/auth/current-user.decorator.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { BlockUserDto } from './dto/block-user.dto.js';
import { InviteUserDto } from './dto/invite-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import {
  UsersService,
  type BlockResult,
  type InviteResult,
  type ManageableUser,
  type UsersPage,
} from './users.service.js';

/**
 * Gestão de colaboradores (Telas `05-B-D.Modais-Users`).
 *
 * Todo o controller é restrito ao Administrador: convidar, editar e bloquear
 * mexem no acesso de outras pessoas.
 */
@ApiTags('users')
@ApiCookieAuth('np_session')
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os colaboradores da corporação' })
  @ApiResponse({ status: 200, description: 'Lista paginada de colaboradores.' })
  @ApiResponse({ status: 403, description: 'Perfil sem permissão.' })
  list(
    @Query() query: ListUsersQueryDto,
    @CurrentTenant() tenantId: string,
  ): Promise<UsersPage> {
    return this.users.list(query, tenantId);
  }

  @Post('invite')
  @ApiOperation({ summary: 'Convida um colaborador por e-mail (Modal 01)' })
  @ApiResponse({ status: 201, description: 'Convite criado e enviado.' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado no tenant.' })
  @ApiResponse({ status: 422, description: 'Cota de usuários esgotada.' })
  invite(
    @Body() dto: InviteUserDto,
    @CurrentTenant() tenantId: string,
  ): Promise<InviteResult> {
    return this.users.invite(dto, tenantId);
  }

  @Post(':id/resend-invite')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reenvia o convite para um colaborador pendente' })
  @ApiResponse({ status: 200, description: 'Convite reenviado com novo token.' })
  @ApiResponse({ status: 404, description: 'Colaborador fora da corporação.' })
  @ApiResponse({ status: 409, description: 'Colaborador não está pendente.' })
  resendInvite(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.users.resendInvite(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita nome, papéis e situação (Modal 03)' })
  @ApiResponse({ status: 200, description: 'Colaborador atualizado.' })
  @ApiResponse({ status: 404, description: 'Colaborador fora da corporação.' })
  @ApiResponse({ status: 422, description: 'Tentativa de rebaixar o último admin.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentTenant() tenantId: string,
  ): Promise<ManageableUser> {
    return this.users.update(id, dto, tenantId);
  }

  @Post(':id/block')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bloqueia o colaborador e reatribui os leads (Modal 02)' })
  @ApiResponse({ status: 200, description: 'Colaborador bloqueado.' })
  @ApiResponse({ status: 404, description: 'Colaborador fora da corporação.' })
  @ApiResponse({ status: 422, description: 'Bloqueio de si mesmo ou do último admin.' })
  block(
    @Param('id') id: string,
    @Body() dto: BlockUserDto,
    @CurrentUser() actor: AuthUser,
    @CurrentTenant() tenantId: string,
  ): Promise<BlockResult> {
    return this.users.block(id, dto, tenantId, actor);
  }
}
