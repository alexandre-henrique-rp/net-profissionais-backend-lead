// Os decorators do class-validator usam `Reflect.getMetadata`: o polyfill
// precisa estar carregado antes deste arquivo ser avaliado.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Type, plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

/**
 * Variáveis de ambiente do backend.
 *
 * Toda a configuração passa por aqui: a validação roda na subida da API e uma
 * variável faltando derruba o processo com o nome do problema — em vez de
 * virar `undefined` no meio de uma requisição.
 */
export class EnvironmentVariables {
  /**
   * Ambiente de execução. Só `production` muda regra de configuração (ex.:
   * `JWT_SECRET` passa a ser obrigatório).
   */
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  /** Origens liberadas no CORS, separadas por vírgula. */
  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  PORT?: number;

  @IsOptional()
  @IsString()
  OBSERVE_APP_KEY?: string;

  @IsOptional()
  @IsString()
  OBSERVE_APP_SECRET?: string;

  @IsOptional()
  @IsString()
  SEED_ADMIN_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SEED_TENANT_WEBHOOK_TOKEN?: string;

  /** Segredo de assinatura do JWT. Opcional em dev/teste; obrigatório em produção. */
  @IsOptional()
  @IsString()
  JWT_SECRET?: string;

  /** Validade do token (formato do `jsonwebtoken`, ex.: `8h`). */
  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  /** Remetente dos e-mails transacionais (convite, reset de senha). */
  @IsOptional()
  @IsString()
  MAIL_FROM?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;
}

/** Configuração validada e tipada que a aplicação usa. */
export interface AppEnv {
  NODE_ENV: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  CORS_ORIGINS: string[];
  PORT: number;
  OBSERVE_APP_KEY?: string;
  OBSERVE_APP_SECRET?: string;
  SEED_ADMIN_PASSWORD?: string;
  SEED_TENANT_WEBHOOK_TOKEN?: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN?: string;
  MAIL_FROM?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
}

const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';
const DEFAULT_PORT = 3000;
const DEFAULT_NODE_ENV = 'development';

/**
 * Defaults de autenticação e e-mail.
 *
 * Não existe segredo de JWT padrão: um valor constante no repositório permite
 * que qualquer pessoa assine um token válido (inclusive com `role: ADMIN`).
 * Sem `JWT_SECRET` no ambiente, `resolveJwtSecret` gera um segredo efêmero.
 */
const DEFAULT_JWT_EXPIRES_IN = '8h';
const DEFAULT_MAIL_FROM = 'nao-responda@netprofissionais.com.br';

/**
 * Segredo efêmero do processo.
 *
 * Fica no escopo do módulo (e não dentro de `validateEnv`) porque `env()` é
 * chamado por vários módulos: gerar um valor novo a cada validação invalidaria
 * todos os tokens já emitidos. `cached` cobre o caminho normal; esta variável
 * cobre as chamadas diretas a `validateEnv`.
 */
let ephemeralJwtSecret: string | undefined;
let warnedAboutEphemeralSecret = false;

const envLogger = new Logger('ConfigEnv');

/** Resolve o segredo do JWT: ambiente → efêmero (dev/teste) ou erro (produção). */
function resolveJwtSecret(configured: string | undefined, nodeEnv: string): string {
  if (configured) {
    return configured;
  }

  if (nodeEnv === 'production') {
    // Em produção, tokens que morrem a cada restart e sessões inválidas entre
    // instâncias seriam um bug silencioso: falhar na subida é o comportamento certo.
    throw new Error(
      'Configuração de ambiente inválida:\n  - JWT_SECRET: obrigatório quando NODE_ENV=production.',
    );
  }

  ephemeralJwtSecret ??= randomBytes(32).toString('hex');

  if (!warnedAboutEphemeralSecret) {
    warnedAboutEphemeralSecret = true;
    envLogger.warn(
      'JWT_SECRET ausente — usando segredo efêmero; tokens não sobrevivem a restart.',
    );
  }

  return ephemeralJwtSecret;
}

let cached: AppEnv | undefined;

/**
 * Valida a configuração de ambiente e devolve a versão tipada.
 *
 * Lança com a lista das variáveis problemáticas — a mensagem nomeia cada uma.
 */
export function validateEnv(
  raw: Record<string, unknown> = process.env,
): AppEnv {
  const parsed = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(parsed, {
    whitelist: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const detalhes = errors
      .map((error) => {
        const motivos = Object.values(error.constraints ?? {});
        return `  - ${error.property}: ${motivos.join(', ')}`;
      })
      .join('\n');

    throw new Error(`Configuração de ambiente inválida:\n${detalhes}`);
  }

  const nodeEnv = parsed.NODE_ENV ?? DEFAULT_NODE_ENV;

  cached = {
    NODE_ENV: nodeEnv,
    DATABASE_URL: parsed.DATABASE_URL,
    REDIS_URL: parsed.REDIS_URL,
    CORS_ORIGINS: (parsed.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    PORT: parsed.PORT ?? DEFAULT_PORT,
    OBSERVE_APP_KEY: parsed.OBSERVE_APP_KEY,
    OBSERVE_APP_SECRET: parsed.OBSERVE_APP_SECRET,
    SEED_ADMIN_PASSWORD: parsed.SEED_ADMIN_PASSWORD,
    SEED_TENANT_WEBHOOK_TOKEN: parsed.SEED_TENANT_WEBHOOK_TOKEN,
    JWT_SECRET: resolveJwtSecret(parsed.JWT_SECRET, nodeEnv),
    JWT_EXPIRES_IN: parsed.JWT_EXPIRES_IN ?? DEFAULT_JWT_EXPIRES_IN,
    MAIL_FROM: parsed.MAIL_FROM ?? DEFAULT_MAIL_FROM,
    SMTP_HOST: parsed.SMTP_HOST,
    SMTP_PORT: parsed.SMTP_PORT,
    SMTP_USER: parsed.SMTP_USER,
    SMTP_PASS: parsed.SMTP_PASS,
  };

  return cached;
}

/**
 * Configuração validada do processo.
 *
 * Na primeira chamada valida `process.env`; depois devolve o resultado guardado.
 * O `ConfigModule` valida no boot — esta função cobre o uso antes disso.
 */
export function env(): AppEnv {
  cached ??= validateEnv(process.env);
  return cached;
}
