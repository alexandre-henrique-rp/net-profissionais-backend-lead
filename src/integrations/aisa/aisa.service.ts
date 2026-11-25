import { Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/errors/business.exception.js';
import {
  LeadTimelineNoteType,
  Prisma,
  type CompanySize,
  type LeadTemperature,
  type TenantLeadStatus,
  type TenantSector,
} from '../../generated/prisma/client.js';
import { deriveSectorFromCnae } from '../../leads/cnae-sector.js';
import { LEAD_ERROR_CODES } from '../../leads/leads.constants.js';
import {
  tenantLeadInclude,
  toTenantLeadResponse,
  type TenantLeadResponse,
} from '../../leads/leads.mapper.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BrasilApiService } from '../brasilapi/brasilapi.service.js';
import { mapCnpjToLeadInput } from '../brasilapi/cnpj.mapper.js';
import { AisaClient, extractHeuristicLeads, normalizeHttpUrl } from './aisa-client.js';
import { decryptSecret, encryptSecret, maskSecret } from './aisa-crypto.js';
import {
  AI_LLM_PROVIDERS,
  AISA_DEFAULT_BASE_URL,
  DEFAULT_LLM_MODELS,
  type AiLlmProvider,
  type AisaConfigResponse,
  type AisaImportResponse,
  type AisaLeadCandidate,
  type AisaSearchResponse,
} from './aisa.types.js';
import type { ImportAisaLeadsDto } from './dto/import-aisa-leads.dto.js';
import type { SearchAisaLeadsDto } from './dto/search-aisa-leads.dto.js';
import type { UpdateAisaConfigDto } from './dto/update-aisa-config.dto.js';

const TENANT_CONFIG_SELECT = {
  id: true,
  aisaApiKeyEncrypted: true,
  aisaBaseUrl: true,
  aiLlmProvider: true,
  aiLlmModel: true,
  aiLlmApiKeyEncrypted: true,
  aiLlmBaseUrl: true,
  updatedAt: true,
} as const;

function normalizeProvider(raw: string | null | undefined): AiLlmProvider {
  if (raw && (AI_LLM_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as AiLlmProvider;
  }
  return 'AISA';
}

function normalizeCnpj(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length === 14 ? digits : null;
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  );
}

function deduplicateCandidates(
  leads: AisaLeadCandidate[],
): AisaLeadCandidate[] {
  const seen = new Set<string>();
  const result: AisaLeadCandidate[] = [];

  for (const lead of leads) {
    const key = lead.cnpj
      ? `cnpj:${lead.cnpj}`
      : `name:${lead.companyName.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(lead);
  }

  return result;
}

/**
 * Orquestração de configuração, pesquisa via API REST da Aisa e importação
 * de leads para o Pool do tenant autenticado.
 */
@Injectable()
export class AisaService {
  private readonly logger = new Logger(AisaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aisaClient: AisaClient,
    private readonly brasilApi: BrasilApiService,
  ) {}

  async getConfig(tenantId: string): Promise<AisaConfigResponse> {
    const tenant = await this.loadTenantConfig(tenantId);
    return this.toConfigResponse(tenant);
  }

  async updateConfig(
    tenantId: string,
    dto: UpdateAisaConfigDto,
  ): Promise<AisaConfigResponse> {
    const current = await this.loadTenantConfig(tenantId);

    const nextProvider = dto.llm_provider ?? normalizeProvider(current.aiLlmProvider);
    const nextModel =
      dto.llm_model?.trim() ||
      (dto.llm_provider && dto.llm_provider !== current.aiLlmProvider
        ? DEFAULT_LLM_MODELS[nextProvider]
        : current.aiLlmModel) ||
      DEFAULT_LLM_MODELS[nextProvider];

    const nextAisaBaseUrl =
      dto.aisa_base_url !== undefined
        ? dto.aisa_base_url.trim()
          ? normalizeHttpUrl(dto.aisa_base_url, 'URL base da Aisa')
          : AISA_DEFAULT_BASE_URL
        : (current.aisaBaseUrl ?? AISA_DEFAULT_BASE_URL);

    let nextLlmBaseUrl: string | null = current.aiLlmBaseUrl;
    if (dto.llm_base_url !== undefined) {
      nextLlmBaseUrl = dto.llm_base_url.trim()
        ? normalizeHttpUrl(dto.llm_base_url, 'URL do provedor customizado')
        : null;
    } else if (dto.llm_provider && dto.llm_provider !== 'CUSTOM') {
      nextLlmBaseUrl = null;
    }

    if (nextProvider === 'CUSTOM' && !nextLlmBaseUrl) {
      throw new BusinessException(
        400,
        'VALIDATION_ERROR',
        'Informe a URL do endpoint para o provedor de IA customizado.',
      );
    }

    let nextAisaEncrypted = current.aisaApiKeyEncrypted;
    if (dto.clear_aisa_api_key) {
      nextAisaEncrypted = null;
    } else if (dto.aisa_api_key?.trim()) {
      nextAisaEncrypted = encryptSecret(dto.aisa_api_key.trim());
    }

    let nextLlmEncrypted = current.aiLlmApiKeyEncrypted;
    if (dto.clear_llm_api_key) {
      nextLlmEncrypted = null;
    } else if (dto.llm_api_key?.trim()) {
      nextLlmEncrypted = encryptSecret(dto.llm_api_key.trim());
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        aisaApiKeyEncrypted: nextAisaEncrypted,
        aisaBaseUrl: nextAisaBaseUrl,
        aiLlmProvider: nextProvider,
        aiLlmModel: nextModel,
        aiLlmApiKeyEncrypted: nextLlmEncrypted,
        aiLlmBaseUrl: nextLlmBaseUrl,
      },
      select: TENANT_CONFIG_SELECT,
    });

    return this.toConfigResponse(updated);
  }

  async searchLeads(
    tenantId: string,
    dto: SearchAisaLeadsDto,
  ): Promise<AisaSearchResponse> {
    const tenant = await this.loadTenantConfig(tenantId);
    const aisaApiKey = decryptSecret(tenant.aisaApiKeyEncrypted);

    if (!aisaApiKey) {
      throw new BusinessException(
        422,
        'AISA_NOT_CONFIGURED',
        'Configure a chave da API Aisa nas configurações do modal antes de pesquisar.',
      );
    }

    const aisaBaseUrl = tenant.aisaBaseUrl ?? AISA_DEFAULT_BASE_URL;
    const llmProvider = normalizeProvider(tenant.aiLlmProvider);
    const llmModel = tenant.aiLlmModel || DEFAULT_LLM_MODELS[llmProvider];
    const llmApiKey = decryptSecret(tenant.aiLlmApiKeyEncrypted);
    const llmBaseUrl = tenant.aiLlmBaseUrl;

    const discovery = await this.aisaClient.discoverSources(
      aisaBaseUrl,
      aisaApiKey,
      {
        segment: dto.segment,
        city: dto.city,
        state: dto.state,
        keywords: dto.keywords,
        companySize: dto.company_size,
        engine: dto.engine,
        deepExtract: dto.deep_extract,
        maxResults: dto.max_results,
      },
    );

    const warnings = [...discovery.warnings];
    const canUseLlm =
      discovery.sources.length > 0 &&
      (llmProvider === 'AISA' ||
        (Boolean(llmApiKey) && (llmProvider !== 'CUSTOM' || Boolean(llmBaseUrl))));

    let leads: AisaLeadCandidate[];
    let llmUsed = false;

    if (canUseLlm) {
      try {
        leads = await this.aisaClient.structureLeadsWithLlm(
          {
            aisaApiKey,
            aisaBaseUrl,
            llmProvider,
            llmModel,
            llmApiKey,
            llmBaseUrl,
          },
          {
            segment: dto.segment,
            city: dto.city,
            state: dto.state,
            keywords: dto.keywords,
            companySize: dto.company_size,
          },
          discovery.sources,
        );
        llmUsed = true;
      } catch (error) {
        if (error instanceof BusinessException && error.getStatus() === 401) {
          warnings.push(`${error.message} Exibindo extração automática.`);
        } else {
          this.logger.warn(
            `Falha ao estruturar leads com ${llmProvider}: ${(error as Error).message}`,
          );
          warnings.push(
            `Modelo ${llmProvider} indisponível no momento; exibindo extração automática dos resultados da Aisa.`,
          );
        }
        leads = extractHeuristicLeads(discovery.sources, {
          segment: dto.segment,
          city: dto.city,
          state: dto.state,
          companySize: dto.company_size,
        });
      }
    } else {
      if (discovery.sources.length > 0 && llmProvider !== 'AISA') {
        warnings.push(
          `Provedor ${llmProvider} sem chave configurada; exibindo extração automática dos resultados da Aisa.`,
        );
      }
      leads = extractHeuristicLeads(discovery.sources, {
        segment: dto.segment,
        city: dto.city,
        state: dto.state,
        companySize: dto.company_size,
      });
    }

    return {
      query: discovery.query,
      engineUsed: discovery.engineUsed,
      llmProvider,
      llmModel,
      llmUsed,
      totalSources: discovery.sources.length,
      warnings,
      leads: deduplicateCandidates(leads),
    };
  }

  async importLeads(
    tenantId: string,
    userId: string,
    dto: ImportAisaLeadsDto,
  ): Promise<AisaImportResponse> {
    const firstStage = await this.prisma.stage.findFirst({
      where: { tenantId },
      orderBy: { position: 'asc' },
    });

    if (!firstStage) {
      throw new BusinessException(
        422,
        LEAD_ERROR_CODES.stageNotConfigured,
        'A corporação ainda não possui etapas configuradas no funil.',
      );
    }

    const items: TenantLeadResponse[] = [];
    const skipped: Array<{ companyName: string; reason: string }> = [];

    for (const item of dto.leads) {
      const companyName = item.company_name.trim();
      const cnpj = normalizeCnpj(item.cnpj);

      const enriched = cnpj ? await this.lookupCnpjSafe(cnpj) : null;
      const customSector =
        item.custom_sector?.trim() || dto.custom_sector?.trim() || null;

      try {
        const created = await this.prisma.$transaction(async (tx) => {
          let leadId: string;

          if (cnpj) {
            const patch = {
              companyName: enriched?.companyName ?? companyName,
              tradeName:
                enriched?.tradeName ?? item.trade_name?.trim() ?? null,
              primaryCnae: enriched?.primaryCnae ?? null,
              cnaeDescription: enriched?.cnaeDescription ?? null,
              capitalSocial: enriched?.capitalSocial ?? null,
              postalCode: enriched?.postalCode ?? null,
              street: enriched?.street ?? null,
              number: enriched?.number ?? null,
              complement: enriched?.complement ?? null,
              neighborhood: enriched?.neighborhood ?? null,
              city: enriched?.city ?? item.city?.trim() ?? null,
              state:
                enriched?.state ??
                (item.state?.trim().toUpperCase() || null),
              sector: (enriched?.sector ?? 'OUTROS') as TenantSector,
              companySize:
                (enriched?.companySize ?? item.company_size ?? null) as
                  | CompanySize
                  | null,
              temperature: (item.temperature ?? 'MORNO') as LeadTemperature,
            };

            const existing = await tx.lead.upsert({
              where: { cnpj },
              create: {
                personType: 'PJ',
                cnpj,
                ...patch,
              },
              update: {},
            });

            const fill: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(patch)) {
              if (
                value !== null &&
                value !== undefined &&
                isEmpty((existing as Record<string, unknown>)[key])
              ) {
                fill[key] = value;
              }
            }
            if (enriched?.primaryCnae) {
              const derived = deriveSectorFromCnae(enriched.primaryCnae);
              if (existing.sector !== derived) {
                fill.sector = derived;
              }
            }
            if (Object.keys(fill).length > 0) {
              await tx.lead.update({
                where: { id: existing.id },
                data: fill as Prisma.LeadUpdateInput,
              });
            }

            const alreadyInTenant = await tx.tenantLead.findUnique({
              where: { tenantId_leadId: { tenantId, leadId: existing.id } },
              select: { id: true },
            });
            if (alreadyInTenant) {
              return { skippedReason: 'CNPJ já cadastrado neste tenant.' };
            }

            leadId = existing.id;
          } else {
            const duplicateByName = await tx.tenantLead.findFirst({
              where: {
                tenantId,
                lead: {
                  companyName: { equals: companyName, mode: 'insensitive' },
                },
              },
              select: { id: true },
            });
            if (duplicateByName) {
              return {
                skippedReason: 'Empresa já cadastrada neste tenant.',
              };
            }

            const createdLead = await tx.lead.create({
              data: {
                personType: 'PJ',
                cnpj: null,
                companyName,
                tradeName: item.trade_name?.trim() || null,
                city: item.city?.trim() || null,
                state: item.state?.trim().toUpperCase() || null,
                sector: 'OUTROS',
                companySize: (item.company_size ?? null) as CompanySize | null,
                temperature: (item.temperature ?? 'MORNO') as LeadTemperature,
              },
            });
            leadId = createdLead.id;
          }

          if (
            item.contact &&
            (item.contact.name?.trim() ||
              item.contact.phone?.trim() ||
              item.contact.email?.trim())
          ) {
            await tx.leadContact.create({
              data: {
                tenantId,
                leadId,
                name: item.contact.name?.trim() || 'Contato Comercial',
                role: item.contact.role?.trim() || null,
                phone: item.contact.phone?.trim() || null,
                email: item.contact.email?.trim() || null,
                isPrimary: true,
                isDecisionMaker: true,
              },
            });
          }

          const scopeNotes = [item.summary?.trim(), item.website?.trim()]
            .filter(Boolean)
            .join(' | ');

          const tenantLead = await tx.tenantLead.create({
            data: {
              tenantId,
              leadId,
              stageId: firstStage.id,
              creatorUserId: userId,
              status: 'AVAILABLE' as TenantLeadStatus,
              customSector,
              proposalScope: scopeNotes ? scopeNotes.slice(0, 1000) : null,
            },
            include: tenantLeadInclude(tenantId),
          });

          const noteContent = [
            item.summary?.trim(),
            item.website?.trim() ? `Site: ${item.website.trim()}` : null,
            item.source_url?.trim() &&
            item.source_url.trim() !== item.website?.trim()
              ? `Fonte Aisa: ${item.source_url.trim()}`
              : null,
          ]
            .filter(Boolean)
            .join('\n');

          await tx.leadTimelineNote.create({
            data: {
              tenantLeadId: tenantLead.id,
              userId,
              type: LeadTimelineNoteType.NOTE,
              title: 'Lead importado via Prospecção Aisa',
              content:
                noteContent ||
                'Empresa importada pela busca inteligente Aisa para o Pool.',
            },
          });

          return { tenantLead };
        });

        if ('skippedReason' in created) {
          skipped.push({
            companyName,
            reason: created.skippedReason as string,
          });
        } else {
          items.push(toTenantLeadResponse(created.tenantLead));
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          skipped.push({
            companyName,
            reason: 'Empresa já cadastrada neste tenant.',
          });
          continue;
        }
        throw error;
      }
    }

    return {
      importedCount: items.length,
      skippedCount: skipped.length,
      items,
      skipped,
    };
  }

  private async lookupCnpjSafe(cnpj: string) {
    try {
      const raw = await this.brasilApi.lookupCnpj(cnpj);
      return raw ? mapCnpjToLeadInput(raw) : null;
    } catch {
      return null;
    }
  }

  private async loadTenantConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: TENANT_CONFIG_SELECT,
    });

    if (!tenant) {
      throw new BusinessException(
        404,
        'TENANT_NOT_FOUND',
        'Corporação não encontrada.',
      );
    }

    return tenant;
  }

  private toConfigResponse(tenant: {
    aisaApiKeyEncrypted: string | null;
    aisaBaseUrl: string | null;
    aiLlmProvider: string | null;
    aiLlmModel: string | null;
    aiLlmApiKeyEncrypted: string | null;
    aiLlmBaseUrl: string | null;
    updatedAt: Date;
  }): AisaConfigResponse {
    const aisaKey = decryptSecret(tenant.aisaApiKeyEncrypted);
    const llmKey = decryptSecret(tenant.aiLlmApiKeyEncrypted);
    const llmProvider = normalizeProvider(tenant.aiLlmProvider);

    return {
      hasAisaApiKey: Boolean(aisaKey),
      aisaApiKeyHint: maskSecret(aisaKey),
      aisaBaseUrl: tenant.aisaBaseUrl ?? AISA_DEFAULT_BASE_URL,
      llmProvider,
      llmModel: tenant.aiLlmModel ?? DEFAULT_LLM_MODELS[llmProvider],
      llmBaseUrl: tenant.aiLlmBaseUrl,
      hasLlmApiKey: Boolean(llmKey),
      llmApiKeyHint: maskSecret(llmKey),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }
}
