import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  LeadTimelineNoteType,
  OperationalRole,
  PersonType,
  Prisma,
  TenantLeadStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT, type RedisLike } from '../redis/redis.service.js';
import type { WebhookLeadDto, WebhookLeadPayloadDto } from './dto/webhook-payload.dto.js';
import {
  DEFAULT_WEBHOOK_SOURCE,
  UUID_PATTERN,
  WEBHOOK_ERROR_CODES,
  WEBHOOK_IDEMPOTENCY_PREFIX,
  WEBHOOK_IDEMPOTENCY_TTL,
} from './webhook.constants.js';
import { assertSignatureIsValid } from './webhook.signature.js';

/** Entrada do `WebhookService.ingest` — tudo que o controller já extraiu. */
export interface WebhookIngestInput {
  tenantId: string;
  payload: WebhookLeadPayloadDto;
  /** Corpo bruto: a assinatura HMAC é calculada sobre ele, não sobre o objeto. */
  rawBody: Buffer;
  signature?: string;
  timestamp?: string;
  idempotencyKey?: string;
}

/** Resultado da captação (corpo da resposta 201/200). */
export interface WebhookLeadResult {
  tenant_lead_id: string;
  lead_id: string;
  duplicate: boolean;
}

/** Documento já normalizado: exatamente um dos dois é preenchido. */
interface ResolvedDocument {
  personType: PersonType;
  cnpj: string | null;
  cpf: string | null;
}

/**
 * Corrida detectada **dentro** da transação: outro webhook criou a mesma
 * oportunidade primeiro. Lançar (em vez de retornar) faz o rollback descartar
 * os contatos que este reenvio acabou de inserir; fora da transação a resposta
 * é `duplicate: true`, igual ao caso síncrono.
 */
class ConcurrentDuplicateError extends Error {
  constructor(
    readonly tenantLeadId: string,
    readonly leadId: string,
  ) {
    super('Oportunidade criada por um webhook concorrente.');
  }
}

/** Campos escalares do `Lead` que o payload do webhook pode preencher. */
interface LeadScalarPatch {
  companyName?: string;
  tradeName?: string;
  postalCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

/** Só os dígitos; string vazia vira `null` para não gravar "". */
function digitsOrNull(value?: string): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';

  return digits.length > 0 ? digits : null;
}

/** Texto aparado; vazio vira `null`. */
function textOrNull(value?: string): string | null {
  const text = value?.trim();

  return text && text.length > 0 ? text : null;
}

/**
 * Decide o tipo de pessoa e o documento a partir do que o integrador enviou.
 *
 * O CNPJ tem 14 dígitos e o CPF 11 — o tamanho identifica o tipo, e o
 * `person_type` opcional serve de conferência: se divergir, é erro do
 * integrador (400), nunca um registro meio PJ meio PF.
 */
function resolveDocument(lead: WebhookLeadDto): ResolvedDocument {
  const digits = lead.document.replace(/\D/g, '');

  const inferred: PersonType | null =
    digits.length === 14
      ? PersonType.PJ
      : digits.length === 11
        ? PersonType.PF
        : null;

  if (!inferred) {
    throw new BusinessException(
      400,
      WEBHOOK_ERROR_CODES.validationError,
      'O documento do lead deve ser um CNPJ (14 dígitos) ou um CPF (11 dígitos).',
    );
  }

  if (lead.person_type && lead.person_type !== inferred) {
    throw new BusinessException(
      400,
      WEBHOOK_ERROR_CODES.validationError,
      'O tipo de pessoa informado não corresponde ao documento enviado.',
    );
  }

  return {
    personType: inferred,
    cnpj: inferred === PersonType.PJ ? digits : null,
    cpf: inferred === PersonType.PF ? digits : null,
  };
}

/**
 * Patch do `Lead` só com o que veio: reaproveitar a identidade de outro tenant
 * não pode apagar dado que o cadastro anterior já tinha.
 */
function buildLeadPatch(lead: WebhookLeadDto): LeadScalarPatch {
  const patch: LeadScalarPatch = {};
  const address = lead.address;

  const companyName = textOrNull(lead.company_name);
  if (companyName) patch.companyName = companyName;

  const tradeName = textOrNull(lead.trade_name);
  if (tradeName) patch.tradeName = tradeName;

  const postalCode = textOrNull(address?.postal_code);
  if (postalCode) patch.postalCode = postalCode;

  const street = textOrNull(address?.street);
  if (street) patch.street = street;

  const number = textOrNull(address?.number);
  if (number) patch.number = number;

  const complement = textOrNull(address?.complement);
  if (complement) patch.complement = complement;

  const neighborhood = textOrNull(address?.neighborhood);
  if (neighborhood) patch.neighborhood = neighborhood;

  const city = textOrNull(address?.city);
  if (city) patch.city = city;

  const state = textOrNull(address?.state);
  if (state) patch.state = state.toUpperCase();

  return patch;
}

/** Contato do payload pronto para gravar (o `leadId` entra depois do upsert). */
type LeadContactSeed = Omit<Prisma.LeadContactCreateManyInput, 'leadId'>;

/**
 * Contatos do payload viram linhas **novas** com o `tenantId` do webhook.
 *
 * O `Lead` pode já existir na base por causa de outra corporação: reaproveitar
 * um contato existente vazaria telefone/e-mail de decisor alheio (LGPD), então
 * cada tenant grava a própria cópia do que recebeu.
 */
function toContactsData(
  contacts: WebhookLeadDto['contacts'],
  tenantId: string,
): LeadContactSeed[] {
  return contacts.map((contact) => ({
    tenantId,
    name: contact.name.trim(),
    role: textOrNull(contact.role),
    phone: digitsOrNull(contact.phone),
    email: textOrNull(contact.email)?.toLowerCase() ?? null,
    birthday: contact.birthday ? new Date(contact.birthday) : null,
    isPrimary: contact.is_primary ?? false,
    isDecisionMaker: contact.is_decision_maker ?? false,
  }));
}

/** `null`, `undefined` e string em branco contam como "campo ainda vazio". */
function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  );
}

/**
 * REGRA DE OURO do `Lead` global: no reaproveitamento, o webhook **só preenche
 * campo vazio**.
 *
 * Razão social, nome fantasia e endereço podem ter sido qualificados por outra
 * corporação que atende o mesmo CNPJ. Sobrescrever com o que o integrador
 * mandou apagaria (sem auditoria) o dado que o outro tenant vê na ficha.
 */
function fillOnlyPatch(
  current: Record<string, unknown>,
  patch: LeadScalarPatch,
): Prisma.LeadUpdateInput {
  const fill: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && isEmptyValue(current[key])) {
      fill[key] = value;
    }
  }

  return fill as Prisma.LeadUpdateInput;
}

/** Campos do `Lead` lidos para decidir o que o payload ainda pode preencher. */
const leadScalarSelect = {
  companyName: true,
  tradeName: true,
  postalCode: true,
  street: true,
  number: true,
  complement: true,
  neighborhood: true,
  city: true,
  state: true,
} satisfies Prisma.LeadSelect;

/**
 * Captura passiva de leads por webhook (`TASK-S05-04`).
 *
 * O integrador externo (landing page, Typeform, Meta/Google Ads) não tem sessão
 * e não conhece o tenant: ele chama a URL com o id da corporação e assina o
 * corpo com o `webhookToken`. Aceitar o lead é o único efeito — enriquecimento,
 * distribuição e atribuição ficam para o fluxo normal do Pool.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Opcional de propósito: sem Redis o webhook continua captando, só perde a
     * idempotência. Melhor aceitar o lead duas vezes (o `@@unique` do tenant
     * segura a duplicata) do que derrubar a integração inteira.
     */
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redis?: RedisLike,
  ) {}

  /**
   * Valida e grava o lead recebido.
   *
   * A ordem importa: corporação → assinatura → consentimento LGPD →
   * idempotência → gravação. Assinatura antes de tudo que é regra de negócio
   * garante que ninguém sem a chave descubra como o payload é validado.
   */
  async ingest(input: WebhookIngestInput): Promise<WebhookLeadResult> {
    const tenant = await this.findTenant(input.tenantId);

    assertSignatureIsValid({
      rawBody: input.rawBody,
      secret: tenant.webhookToken,
      signature: input.signature,
      timestamp: input.timestamp,
    });

    if (input.payload.lgpd_consent !== true) {
      throw new BusinessException(
        422,
        WEBHOOK_ERROR_CODES.lgpdConsentRequired,
        'O lead não pode ser captado sem consentimento LGPD explícito (lgpd_consent: true).',
      );
    }

    const idempotencyKey = textOrNull(input.idempotencyKey);
    const cached = await this.readIdempotency(input.tenantId, idempotencyKey);

    if (cached) {
      return { ...cached, duplicate: true };
    }

    const result = await this.persist(input.tenantId, input.payload);

    await this.writeIdempotency(input.tenantId, idempotencyKey, result);

    return result;
  }

  /** Corporação do `:tenantId` — 404 `NOT_FOUND` quando não existe. */
  private async findTenant(tenantId: string): Promise<{ webhookToken: string }> {
    // Id fora do formato UUID estouraria no Postgres: trata como inexistente.
    if (!UUID_PATTERN.test(tenantId)) {
      throw this.tenantNotFound();
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webhookToken: true },
    });

    if (!tenant) {
      throw this.tenantNotFound();
    }

    return tenant;
  }

  private tenantNotFound(): BusinessException {
    return new BusinessException(
      404,
      WEBHOOK_ERROR_CODES.notFound,
      'Corporação não encontrada.',
    );
  }

  /**
   * Grava identidade + oportunidade + contatos + primeira nota numa transação.
   *
   * `Lead` é a identidade global: se o CNPJ/CPF já é conhecido, ele é
   * completado em vez de duplicado. O que não pode repetir é a oportunidade no
   * tenant (`@@unique([tenantId, leadId])`) — e esse caso não é erro, é o
   * integrador reenviando o mesmo lead: devolve `duplicate: true` para ele
   * parar de tentar.
   */
  private async persist(
    tenantId: string,
    payload: WebhookLeadPayloadDto,
  ): Promise<WebhookLeadResult> {
    const document = resolveDocument(payload.lead);
    const patch = buildLeadPatch(payload.lead);
    const contacts = toContactsData(payload.lead.contacts, tenantId);

    // A chave do `upsert` é o documento (`@unique` no schema): dois webhooks
    // concorrentes do mesmo CNPJ novo não criam duas identidades globais.
    const documentKey: Prisma.LeadWhereUniqueInput = document.cnpj
      ? { cnpj: document.cnpj }
      : { cpf: document.cpf as string };

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Reenvio do integrador: a oportunidade já existe neste tenant. A
        // checagem vem **antes** de qualquer escrita para o retry não criar
        // contatos repetidos no tenant.
        const existingLead = await tx.lead.findUnique({
          where: documentKey,
          select: { id: true },
        });

        if (existingLead) {
          const existingTenantLead = await tx.tenantLead.findUnique({
            where: { tenantId_leadId: { tenantId, leadId: existingLead.id } },
            select: { id: true },
          });

          if (existingTenantLead) {
            return {
              tenant_lead_id: existingTenantLead.id,
              lead_id: existingLead.id,
              duplicate: true,
            };
          }
        }

        // Todo lead captado entra na primeira etapa do funil e no Pool.
        const firstStage = await tx.stage.findFirst({
          where: { tenantId },
          orderBy: { position: 'asc' },
          select: { id: true },
        });

        if (!firstStage) {
          throw new BusinessException(
            422,
            WEBHOOK_ERROR_CODES.unprocessable,
            'A corporação ainda não possui etapas configuradas no funil.',
          );
        }

        const lead = await tx.lead.upsert({
          where: documentKey,
          // `update: {}` é intencional: o upsert garante a identidade; a
          // qualificação acontece abaixo, campo vazio por campo.
          create: {
            personType: document.personType,
            cnpj: document.cnpj,
            cpf: document.cpf,
            ...patch,
          },
          update: {},
          select: { id: true, ...leadScalarSelect },
        });

        const fill = fillOnlyPatch(lead as Record<string, unknown>, patch);

        if (Object.keys(fill).length > 0) {
          await tx.lead.update({ where: { id: lead.id }, data: fill });
        }

        // Contatos são sempre linhas novas do tenant que recebeu o webhook.
        if (contacts.length > 0) {
          await tx.leadContact.createMany({
            data: contacts.map((contact) => ({ ...contact, leadId: lead.id })),
          });
        }

        // Segunda checagem: dois webhooks do mesmo lead podem ter passado
        // juntos pela leitura acima. Quem perdeu a corrida responde duplicado.
        const racedTenantLead = await tx.tenantLead.findUnique({
          where: { tenantId_leadId: { tenantId, leadId: lead.id } },
          select: { id: true },
        });

        if (racedTenantLead) {
          throw new ConcurrentDuplicateError(racedTenantLead.id, lead.id);
        }

        const tenantLead = await tx.tenantLead.create({
          data: {
            tenantId,
            leadId: lead.id,
            stageId: firstStage.id,
            status: TenantLeadStatus.AVAILABLE,
            assignedUserId: null,
            creatorUserId: null,
          },
          select: { id: true },
        });

        // `// ASM:` o enriquecimento de CNPJ não é enfileirado aqui (fila
        // BullMQ `queue:lead-enrichment`); a captação só grava o lead. Fica
        // registrado como pendência consciente desta rodada.
        const authorId = await this.resolveNoteAuthor(tx, tenantId);

        if (authorId) {
          await tx.leadTimelineNote.create({
            data: {
              tenantLeadId: tenantLead.id,
              userId: authorId,
              type: LeadTimelineNoteType.NOTE,
              title: 'Lead recebido via webhook',
              content: this.buildNoteContent(payload),
            },
          });
        } else {
          this.logger.warn(
            `Tenant ${tenantId} não tem usuário para assinar a nota do lead ${tenantLead.id}.`,
          );
        }

        return {
          tenant_lead_id: tenantLead.id,
          lead_id: lead.id,
          duplicate: false,
        };
      });
    } catch (error) {
      // Corrida perdida dentro da transação: o rollback já descartou o que
      // este reenvio tentou gravar; a resposta é a do reenvio idempotente.
      if (error instanceof ConcurrentDuplicateError) {
        return {
          tenant_lead_id: error.tenantLeadId,
          lead_id: error.leadId,
          duplicate: true,
        };
      }

      // Corrida perdida na criação da oportunidade (`@@unique([tenantId,
      // leadId])`): a resposta correta é a do reenvio, não um 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicated = await this.findExistingOpportunity(tenantId, document);

        if (duplicated) {
          return duplicated;
        }
      }

      throw error;
    }
  }

  /** Releitura da oportunidade que causou o `P2002` (reenvio concorrente). */
  private async findExistingOpportunity(
    tenantId: string,
    document: ResolvedDocument,
  ): Promise<WebhookLeadResult | null> {
    const lead = await this.prisma.lead.findUnique({
      where: document.cnpj
        ? { cnpj: document.cnpj }
        : { cpf: document.cpf as string },
      select: { id: true },
    });

    if (!lead) {
      return null;
    }

    const tenantLead = await this.prisma.tenantLead.findUnique({
      where: { tenantId_leadId: { tenantId, leadId: lead.id } },
      select: { id: true },
    });

    if (!tenantLead) {
      return null;
    }

    return { tenant_lead_id: tenantLead.id, lead_id: lead.id, duplicate: true };
  }

  /**
   * Autor da nota de recebimento.
   *
   * `LeadTimelineNote.userId` é obrigatório no schema, e o webhook não tem
   * usuário: a nota fica assinada pelo administrador mais antigo do tenant
   * (o "sistema" da corporação). Sem nenhum usuário, o lead entra e a nota é
   * omitida — recusar a captação por causa disso seria pior.
   */
  private async resolveNoteAuthor(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string | null> {
    const admin = await tx.user.findFirst({
      where: { tenantId, operationalRole: OperationalRole.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (admin) {
      return admin.id;
    }

    const anyUser = await tx.user.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    return anyUser?.id ?? null;
  }

  /** Primeira nota do lead: de onde veio, o consentimento e a mensagem. */
  private buildNoteContent(payload: WebhookLeadPayloadDto): string {
    const origin = payload.source ?? payload.channel ?? DEFAULT_WEBHOOK_SOURCE;
    const parts = [`Origem: ${origin}`];

    if (payload.consent_at) {
      parts.push(`consentimento LGPD em ${payload.consent_at}`);
    }

    const message = textOrNull(payload.lead.message);

    if (message) {
      parts.push(message);
    }

    return parts.join(' · ');
  }

  /** Chave de idempotência do tenant (`webhook:idem:<tenant>:<key>`). */
  private idempotencyKey(tenantId: string, key: string): string {
    return `${WEBHOOK_IDEMPOTENCY_PREFIX}${tenantId}:${key}`;
  }

  /** Resposta gravada de uma chave já processada, se existir. */
  private async readIdempotency(
    tenantId: string,
    key: string | null,
  ): Promise<WebhookLeadResult | null> {
    if (!key || !this.redis) {
      return null;
    }

    try {
      const raw = await this.redis.get(this.idempotencyKey(tenantId, key));

      if (!raw) {
        return null;
      }

      const parsed: unknown = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      const record = parsed as Record<string, unknown>;

      if (
        typeof record.tenant_lead_id !== 'string' ||
        typeof record.lead_id !== 'string'
      ) {
        return null;
      }

      return {
        tenant_lead_id: record.tenant_lead_id,
        lead_id: record.lead_id,
        duplicate: record.duplicate === true,
      };
    } catch (error) {
      // Redis fora do ar não pode derrubar a captação: segue sem idempotência.
      this.logger.warn(`Idempotência indisponível: ${(error as Error).message}`);

      return null;
    }
  }

  /** Guarda o resultado por 24h — reenvio do integrador não cria outro lead. */
  private async writeIdempotency(
    tenantId: string,
    key: string | null,
    result: WebhookLeadResult,
  ): Promise<void> {
    if (!key || !this.redis) {
      return;
    }

    try {
      await this.redis.set(
        this.idempotencyKey(tenantId, key),
        JSON.stringify(result),
        'EX',
        WEBHOOK_IDEMPOTENCY_TTL,
      );
    } catch (error) {
      this.logger.warn(`Falha ao gravar idempotência: ${(error as Error).message}`);
    }
  }
}
