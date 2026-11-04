import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types.js';
import { toNumber } from '../dashboard/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { buildLeadsCsv } from './csv.js';
import { buildExportWhere } from './export.query.js';
import type { ExportQueryDto } from './dto/export-query.dto.js';
import {
  DEFAULT_EXPORT_FORMAT,
  EXPORT_ROW_LIMIT,
  type ExportFile,
  type ExportLeadRow,
} from './export.types.js';
import { buildLeadsPdf } from './pdf.js';

/** Colunas que o relatório precisa — nada de trazer o lead inteiro. */
const EXPORT_SELECT = {
  ticketValue: true,
  closeProbability: true,
  expectedCloseDate: true,
  lastContactAt: true,
  stage: { select: { name: true } },
  assignedUser: { select: { name: true } },
  lead: {
    select: {
      companyName: true,
      tradeName: true,
      cnpj: true,
      cpf: true,
      city: true,
      state: true,
      sector: true,
      companySize: true,
      temperature: true,
    },
  },
} satisfies Prisma.TenantLeadSelect;

type ExportRowSource = Prisma.TenantLeadGetPayload<{ select: typeof EXPORT_SELECT }>;

/**
 * Data do nome do arquivo (`AAAA-MM-DD`).
 *
 * Usa a data UTC de propósito: o nome é um carimbo estável, não um recorte —
 * o recorte temporal do conteúdo é o `period` da query.
 */
function fileStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Achata o `TenantLead` na linha do relatório. */
function toExportRow(row: ExportRowSource): ExportLeadRow {
  return {
    company_name: row.lead.companyName,
    trade_name: row.lead.tradeName,
    // PJ tem CNPJ e PF tem CPF: o relatório mostra o documento que existir.
    document: row.lead.cnpj ?? row.lead.cpf,
    state: row.lead.state,
    city: row.lead.city,
    sector: row.lead.sector,
    company_size: row.lead.companySize,
    temperature: row.lead.temperature,
    stage_name: row.stage?.name ?? null,
    assigned_user_name: row.assignedUser?.name ?? null,
    ticket_value: toNumber(row.ticketValue),
    close_probability: row.closeProbability,
    expected_close_date: row.expectedCloseDate,
    last_contact_at: row.lastContactAt,
  };
}

/**
 * Exportação de leads em CSV/PDF (`TASK-S06-03` / spec §2.6).
 *
 * Aplicar os mesmos filtros da tela é responsabilidade do `buildExportWhere`;
 * aqui só se busca, achata e serializa.
 */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera o arquivo pedido.
   *
   * Teto de 5000 linhas (`EXPORT_ROW_LIMIT`), ordenado do mais recente para o
   * mais antigo: se o recorte for maior que isso, o relatório traz os 5000
   * leads mais recentes e o usuário deve refinar o filtro.
   */
  async exportLeads(user: AuthUser, query: ExportQueryDto): Promise<ExportFile> {
    const where = buildExportWhere(user, query);

    const rows = await this.prisma.tenantLead.findMany({
      where,
      select: EXPORT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    });

    const exportRows = rows.map(toExportRow);
    const generatedAt = new Date();
    const stamp = fileStamp(generatedAt);
    const format = query.format ?? DEFAULT_EXPORT_FORMAT;

    if (format === 'pdf') {
      return {
        buffer: buildLeadsPdf(exportRows, { generatedAt }),
        filename: `leads_export_${stamp}.pdf`,
        content_type: 'application/pdf',
      };
    }

    return {
      buffer: Buffer.from(buildLeadsCsv(exportRows), 'utf8'),
      filename: `leads_export_${stamp}.csv`,
      content_type: 'text/csv; charset=utf-8',
    };
  }
}
