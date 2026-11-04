import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import type { Tenant, User } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth/auth.types.js';
import { SessionService } from '../common/auth/session.service.js';
import { BusinessException } from '../common/errors/business.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
  REDIS_TTL,
  RedisService,
  type RedisLike,
} from '../redis/redis.service.js';
import { MailService } from '../mail/mail.service.js';
import type { ActivateAccountDto } from './dto/activate-account.dto.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';

/** Tentativas erradas permitidas dentro da janela de 15 minutos. */
export const MAX_LOGIN_ATTEMPTS = 5;

/** TTL do token de redefinição de senha (15 minutos). */
export const RESET_PASSWORD_TTL_SECONDS = 15 * 60;

/** Validade do convite de colaborador: 48 horas. */
export const INVITE_TTL_HOURS = 48;

/** Chave do token de reset — token de uso único, fora do banco. */
const resetPasswordKey = (token: string): string => `reset:${token}`;

/**
 * Hash descartável para igualar o custo do login sem usuário.
 *
 * Gerado com os mesmos parâmetros do `argon2.hash` padrão (`m=65536, p=4,
 * t=3`). É verificado contra a senha enviada quando o e-mail não existe: sem
 * esse trabalho extra, o tempo de resposta revelaria quais e-mails têm conta.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$qvGrUrH6uVVi7rtezv0B8g$FEmXik8TWovsGHBjaaJ4zJf3l1GuxCL9aMmVzOOTNyE';

/**
 * Campos do usuário que podem sair da API.
 *
 * `select` explícito em vez de `omit`: `passwordHash` e `inviteToken` nunca
 * chegam perto do serializador.
 */
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  operationalRole: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Usuário exposto ao cliente. */
export type PublicUser = Pick<User, keyof typeof PUBLIC_USER_SELECT>;

/** Corporação exposta ao cliente. */
export type PublicTenant = Pick<Tenant, 'id' | 'name' | 'tradeName'>;

/** Resultado interno do login: o controller usa a sessão para o cookie. */
export interface LoginResult {
  sessionId: string;
  token: string;
  user: PublicUser;
}

/** Normaliza e-mail para busca e comparação (o banco guarda em minúsculas). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Autenticação da API: login por senha, sessão no Redis, recuperação de senha
 * e ativação de conta por convite.
 *
 * A sessão é a fonte de verdade (`sess:<id>`); o JWT carrega apenas os
 * identificadores e papéis e é aceito somente enquanto a sessão existir — é o
 * que permite o logout e o bloqueio revogarem o acesso na hora.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly mail: MailService,
    /**
     * Cliente cru do Redis: o `RedisService` só expõe as chaves de sessão e de
     * cache de CNPJ. Aqui ele é usado para o token de reset e para zerar o
     * contador de tentativas de login.
     */
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redis?: RedisLike,
  ) {}

  /** `POST /auth/login` — valida credenciais, abre a sessão e assina o JWT. */
  async login(dto: LoginDto, ip?: string): Promise<LoginResult> {
    const email = normalizeEmail(dto.email);
    // Contador por e-mail (sem IP): trocar de endereço não pode zerar o teto de
    // tentativas de uma conta — é a conta que o ataque quer, não a origem.
    const accountAttempts = await this.readLoginAttempts(email);

    if (accountAttempts >= MAX_LOGIN_ATTEMPTS) {
      throw this.rateLimitException();
    }

    // O e-mail é único por tenant. Sem tenant conhecido antes do login, a
    // busca global pode devolver mais de um: nesse caso não há como escolher
    // a corporação e a resposta é a mesma de credencial inválida.
    const matches = await this.prisma.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      take: 2,
    });

    const user = matches.length === 1 ? matches[0] : undefined;

    if (!user) {
      // Sem conta para contar tentativas, o IP é a chave disponível.
      const ipKey = ip ?? 'desconhecido';
      const ipAttempts = await this.readLoginAttempts(ipKey);

      if (ipAttempts >= MAX_LOGIN_ATTEMPTS) {
        throw this.rateLimitException();
      }

      // Mesmo custo de argon2 do caminho com usuário: o tempo de resposta não
      // pode servir de oráculo de existência.
      await this.verifyPassword(dto.password, DUMMY_PASSWORD_HASH);
      await this.registerFailedAttempt(ipKey);
      throw this.invalidCredentials();
    }

    // A senha é verificada antes de qualquer checagem de situação da conta:
    // `ACCOUNT_BLOCKED`/`ACCOUNT_NOT_ACTIVE` para quem não sabe a senha
    // revelaria a existência e o estado da conta a qualquer um.
    if (!(await this.verifyPassword(dto.password, user.passwordHash))) {
      await this.registerFailedAttempt(email);
      throw this.invalidCredentials();
    }

    if (user.status === 'BLOCKED') {
      throw new BusinessException(
        403,
        'ACCOUNT_BLOCKED',
        'Esta conta está bloqueada. Fale com o administrador da corporação.',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new BusinessException(
        403,
        'ACCOUNT_NOT_ACTIVE',
        'Esta conta ainda não foi ativada. Use o link recebido por e-mail.',
      );
    }

    const sessionId = await this.sessionService.create(user);

    const token = await this.jwtService.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      operationalRole: user.operationalRole,
      sessionId,
    });

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: PUBLIC_USER_SELECT,
    });

    // Login válido limpa o histórico: o contador existe para senha errada.
    await this.clearLoginAttempts(email);

    return { sessionId, token, user: updated };
  }

  /** `POST /auth/logout` — apaga a sessão; o cookie é limpo no controller. */
  async logout(sessionId: string | undefined): Promise<{ loggedOut: true }> {
    if (sessionId) {
      await this.sessionService.destroy(sessionId);
    }

    return { loggedOut: true };
  }

  /** `GET /auth/me` — usuário autenticado + corporação. */
  async me(authUser: AuthUser): Promise<{ user: PublicUser; tenant: PublicTenant }> {
    const user = await this.prisma.user.findFirst({
      where: { id: authUser.userId, tenantId: authUser.tenantId },
      select: {
        ...PUBLIC_USER_SELECT,
        tenant: { select: { id: true, name: true, tradeName: true } },
      },
    });

    if (!user) {
      throw new BusinessException(
        404,
        'USER_NOT_FOUND',
        'Usuário não encontrado na corporação.',
      );
    }

    const { tenant, ...publicUser } = user;

    return { user: publicUser, tenant };
  }

  /**
   * `POST /auth/forgot-password`.
   *
   * A resposta é sempre `{ sent: true }` — inclusive para e-mail inexistente,
   * inativo ou quando o envio falha. Qualquer variação permitiria enumerar
   * quem tem conta no sistema.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ sent: true }> {
    const email = normalizeEmail(dto.email);
    const matches = await this.prisma.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      take: 2,
    });

    const user = matches.length === 1 ? matches[0] : undefined;

    if (!user || user.status !== 'ACTIVE') {
      return { sent: true };
    }

    if (!this.redis) {
      this.logger.warn(
        'Redis indisponível: token de redefinição não foi gravado.',
      );
      return { sent: true };
    }

    const token = randomUUID();

    try {
      await this.redis.set(
        resetPasswordKey(token),
        JSON.stringify({ userId: user.id }),
        'EX',
        RESET_PASSWORD_TTL_SECONDS,
      );
      await this.mail.sendPasswordReset(user.email, user.name, token);
    } catch (error) {
      // Falha de infraestrutura não pode virar pista para o cliente.
      this.logger.error(
        `Falha ao emitir token de redefinição: ${(error as Error).message}`,
      );
    }

    return { sent: true };
  }

  /** `POST /auth/reset-password` — troca a senha e revoga todas as sessões. */
  async resetPassword(dto: ResetPasswordDto): Promise<{ reset: true }> {
    const key = resetPasswordKey(dto.token);
    const stored = await this.readResetToken(key);
    const userId = stored ? this.parseResetToken(stored) : undefined;

    if (!userId) {
      throw this.tokenExpired('Token de redefinição inválido ou expirado.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw this.tokenExpired('Token de redefinição inválido ou expirado.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(dto.password) },
    });

    await this.deleteResetToken(key);
    // Trocar a senha derruba quem estava logado com a senha antiga.
    await this.sessionService.destroyAllForUser(user.id);

    return { reset: true };
  }

  /** `POST /auth/activate-account` — consome o convite e ativa a conta. */
  async activateAccount(dto: ActivateAccountDto): Promise<{ activated: true }> {
    const user = await this.prisma.user.findFirst({
      where: { inviteToken: dto.token },
    });

    const expired =
      !user ||
      !user.inviteExpiresAt ||
      user.inviteExpiresAt.getTime() < Date.now();

    if (expired) {
      throw this.tokenExpired(
        'Convite inválido ou expirado. Peça um novo convite ao administrador.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        passwordHash: await hash(dto.password),
        // Convite é de uso único: o token sai do banco na ativação.
        inviteToken: null,
        inviteExpiresAt: null,
      },
    });

    try {
      await this.mail.sendAccountActivated(user.email, user.name);
    } catch (error) {
      // Conta já está ativa; falha de e-mail não desfaz a ativação.
      this.logger.warn(
        `Falha ao enviar confirmação de ativação: ${(error as Error).message}`,
      );
    }

    return { activated: true };
  }

  /**
   * `argon2.verify` estoura com hash vazio/corrompido — isso é senha errada.
   *
   * Conta pendente (hash vazio) não tem custo de argon2: verificar contra o
   * hash descartável mantém o tempo de resposta igual ao de uma conta real.
   */
  private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const usableHash = passwordHash === '' ? DUMMY_PASSWORD_HASH : passwordHash;

    try {
      const matches = await verify(usableHash, password);

      // O hash descartável nunca vale como credencial válida.
      return matches && passwordHash !== '';
    } catch {
      return false;
    }
  }

  private async readLoginAttempts(rateKey: string): Promise<number> {
    if (!this.redis) {
      return 0;
    }

    try {
      const raw = await this.redis.get(REDIS_KEYS.loginRateLimit(rateKey));
      const parsed = Number(raw ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (error) {
      // Falha de leitura não pode barrar login legítimo: o Redis fora do ar
      // derruba a criação de sessão logo adiante, com o erro real.
      this.logger.warn(
        `Falha ao ler o contador de login: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  private async registerFailedAttempt(rateKey: string): Promise<void> {
    try {
      await this.redisService.incrementLoginRateLimit(rateKey);
    } catch (error) {
      this.logger.warn(
        `Falha ao incrementar o contador de login: ${(error as Error).message}`,
      );
    }
  }

  private async clearLoginAttempts(rateKey: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(REDIS_KEYS.loginRateLimit(rateKey));
    } catch (error) {
      this.logger.warn(
        `Falha ao zerar o contador de login: ${(error as Error).message}`,
      );
    }
  }

  private async readResetToken(key: string): Promise<string | null> {
    if (!this.redis) {
      return null;
    }

    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.warn(
        `Falha ao ler o token de redefinição: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async deleteResetToken(key: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(
        `Falha ao apagar o token de redefinição: ${(error as Error).message}`,
      );
    }
  }

  /** O token guarda `{ userId }`; JSON inválido equivale a token inexistente. */
  private parseResetToken(raw: string): string | undefined {
    try {
      const parsed: unknown = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }

      const { userId } = parsed as Record<string, unknown>;

      return typeof userId === 'string' && userId !== '' ? userId : undefined;
    } catch {
      return undefined;
    }
  }

  private invalidCredentials(): BusinessException {
    return new BusinessException(
      401,
      'INVALID_CREDENTIALS',
      'E-mail ou senha inválidos.',
    );
  }

  private tokenExpired(message: string): BusinessException {
    return new BusinessException(410, 'TOKEN_EXPIRED', message);
  }

  private rateLimitException(): BusinessException {
    return new BusinessException(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Muitas tentativas de login. Tente novamente em 15 minutos.',
      { retry_after_seconds: REDIS_TTL.loginRateLimit },
    );
  }
}
