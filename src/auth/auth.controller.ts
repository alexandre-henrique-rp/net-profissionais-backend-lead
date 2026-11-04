import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Public } from '../common/auth/public.decorator.js';
import { SESSION_COOKIE_NAME } from '../common/auth/session.service.js';
import { BusinessException } from '../common/errors/business.exception.js';
import { REDIS_TTL } from '../redis/redis.service.js';
import { AuthService, type PublicUser } from './auth.service.js';
import { ActivateAccountDto } from './dto/activate-account.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

/**
 * Autenticação da API.
 *
 * O cookie `np_session` é HttpOnly (o JavaScript do frontend não o lê) e
 * `SameSite=Lax`; o token JWT devolvido no corpo atende quem consome a API
 * fora do browser (`Authorization: Bearer`).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Autentica o usuário e abre a sessão' })
  @ApiResponse({
    status: 200,
    description: 'Sessão criada. O cookie `np_session` vai na resposta.',
    schema: {
      example: {
        user: {
          id: '00000000-0000-0000-0000-000000000000',
          name: 'Carlos Admin',
          email: 'carlos.admin@netprofissional.com.br',
          role: 'ADMIN',
          operationalRole: 'ADMIN',
          status: 'ACTIVE',
        },
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas.' })
  @ApiResponse({ status: 403, description: 'Conta bloqueada ou não ativada.' })
  @ApiResponse({ status: 429, description: 'Muitas tentativas de login.' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser; token: string }> {
    try {
      const result = await this.auth.login(dto, request.ip);

      response.cookie(SESSION_COOKIE_NAME, result.sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        // `false` porque o dev roda em http://localhost. Em produção (HTTPS)
        // esta opção passa a `true`.
        secure: false,
        path: '/',
        // O cookie morre junto com a sessão no Redis (8h).
        maxAge: REDIS_TTL.session * 1000,
      });

      return { user: result.user, token: result.token };
    } catch (error) {
      // O filtro global publica `retry_after_seconds` a partir deste header.
      if (error instanceof BusinessException && error.getStatus() === 429) {
        response.setHeader('Retry-After', String(REDIS_TTL.loginRateLimit));
      }

      throw error;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth('np_session')
  @ApiOperation({ summary: 'Encerra a sessão e limpa o cookie' })
  @ApiResponse({ status: 200, description: 'Sessão encerrada.' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    const result = await this.auth.logout(user?.sessionId);

    response.clearCookie(SESSION_COOKIE_NAME, { path: '/' });

    return result;
  }

  @Get('me')
  @ApiCookieAuth('np_session')
  @ApiOperation({ summary: 'Dados do usuário autenticado e da corporação' })
  @ApiResponse({ status: 200, description: 'Usuário autenticado.' })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  me(@CurrentUser() user: AuthUser): ReturnType<AuthService['me']> {
    return this.auth.me(user);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Solicita o link de redefinição de senha' })
  @ApiResponse({
    status: 200,
    description: 'Pedido aceito. A resposta é a mesma exista ou não a conta.',
    schema: { example: { sent: true } },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ sent: true }> {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Redefine a senha com o token recebido por e-mail' })
  @ApiResponse({ status: 200, description: 'Senha redefinida; sessões encerradas.' })
  @ApiResponse({ status: 410, description: 'Token inválido ou expirado.' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ reset: true }> {
    return this.auth.resetPassword(dto);
  }

  @Public()
  @Post('activate-account')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ativa a conta a partir do convite' })
  @ApiResponse({ status: 200, description: 'Conta ativada.' })
  @ApiResponse({ status: 410, description: 'Convite inválido ou expirado.' })
  activateAccount(@Body() dto: ActivateAccountDto): Promise<{ activated: true }> {
    return this.auth.activateAccount(dto);
  }
}
