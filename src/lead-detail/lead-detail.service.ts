import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types.js';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  LeadTimelineNoteType,
  TenantLeadStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTimelineNoteDto } from './dto/create-timeline-note.dto.js';
import type { UnlinkLeadDto } from './dto/unlink-lead.dto.js';
import { LEAD_DETAIL_ERROR_CODES, TIMELINE_NOTE_DEFAULT_TITLES, UUID_PATTERN } from './lead-detail.constants.js';
import {
  leadDetailInclude,
  toLeadDetailResponse,
  toTimelineNoteResponse,
  type LeadDetailResponse,
  type LeadDetailRow,
  type TimelineNoteResponse,
} from './lead-detail.mapper.js';

/** Texto padrão da nota quando o vendedor devolve o lead sem justificar. */
const DEFAULT_UNLINK_REASON =
  'Vendedor se desvinculou do lead. Devolvido ao Pool para redistribuição.';

/**
 * Ficha completa do lead — gaveta lateral `Drawer 01` (`TASK-S05-01` a
 * `TASK-S05-03`).
 *
 * `:id` é sempre o `TenantLead` (a oportunidade dentro da corporação), nunca o
 * `Lead` global: o mesmo cliente pode estar em duas carteiras e cada uma tem
 * seu próprio histórico. Toda consulta parte do `tenantId` da sessão — é isso
 * que faz lead de outro tenant responder 404 em vez de vazar dado.
 */
@Injectable()
export class LeadDetailService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /leads/:id` — as 3 abas da gaveta num objeto. */
  async getDetail(tenantLeadId: string, user: AuthUser): Promise<LeadDetailResponse> {
    const row = await this.findDetail(tenantLeadId, user.tenantId);
    this.assertCanRead(user, row.assignedUserId);

    return toLeadDetailResponse(row);
  }

  /**
   * `POST /leads/:id/timeline-notes` — registra a interação.
   *
   * A nota e o `lastContactAt` andam juntos na mesma transação: é esse campo
   * que apaga o alerta de "parado há mais de 48h" no Kanban — nota gravada sem
   * ele deixaria o card em alerta mesmo depois do contato.
   *
   * `version` sobe junto: a nota muda o estado do card, então qualquer escrita
   * otimista que estava em voo (com a versão anterior) precisa ser recusada.
   */
  async createTimelineNote(
    tenantLeadId: string,
    user: AuthUser,
    dto: CreateTimelineNoteDto,
  ): Promise<TimelineNoteResponse> {
    const row = await this.findDetail(tenantLeadId, user.tenantId);
    this.assertCanRead(user, row.assignedUserId);

    const title = dto.title?.trim() ?? '';
    const content = dto.content?.trim() ?? '';

    // Nota sem título e sem conteúdo seria uma linha vazia na timeline: o
    // título padrão não salva um registro que não diz nada.
    if (!title && !content) {
      throw new BusinessException(
        400,
        'VALIDATION_ERROR',
        'Informe ao menos `title` ou `content` para registrar a interação.',
      );
    }

    const now = new Date();
    // `contacted_at` permite registrar uma conversa que aconteceu antes do
    // clique; sem ele, o contato é o próprio momento do registro.
    const contactedAt = dto.contacted_at ? new Date(dto.contacted_at) : now;

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leadTimelineNote.create({
        data: {
          tenantLeadId,
          userId: user.userId,
          type: dto.type,
          title: title || TIMELINE_NOTE_DEFAULT_TITLES[dto.type],
          content: content.length > 0 ? content : null,
        },
        include: { user: { select: { id: true, name: true } } },
      });

      await tx.tenantLead.update({
        where: { id: tenantLeadId, tenantId: user.tenantId },
        data: { lastContactAt: contactedAt, version: { increment: 1 } },
      });

      return created;
    });

    return toTimelineNoteResponse(note);
  }

  /**
   * `POST /leads/:id/unlink` — desvincula e devolve ao Pool.
   *
   * Só faz sentido devolver oportunidade **em negociação** (`CLAIMED`) ou
   * perdida (`LOST`). Lead `AVAILABLE`/`RETURNED_TO_POOL` já está no Pool:
   * "devolver" de novo é erro de estado (409), não operação idempotente.
   *
   * O card volta para a **primeira etapa** do funil junto com a devolução: um
   * lead perdido devolvido ao Pool mantendo a etapa `7_perdido` seria captado
   * dentro da coluna de perda e sumiria do breakdown de perdas.
   *
   * `claimedAt` é preservado de propósito: a devolução não apaga o registro de
   * que o lead foi captado (é a base histórica da cota diária).
   */
  async unlink(
    tenantLeadId: string,
    user: AuthUser,
    dto: UnlinkLeadDto,
  ): Promise<LeadDetailResponse> {
    const row = await this.findDetail(tenantLeadId, user.tenantId);
    this.assertCanUnlink(user, row.assignedUserId);

    if (
      row.status !== TenantLeadStatus.CLAIMED &&
      row.status !== TenantLeadStatus.LOST
    ) {
      throw new BusinessException(
        409,
        'CONFLICT',
        'Este lead não está em negociação nem perdido: ele já está no Pool e não pode ser devolvido de novo.',
      );
    }

    const reason = dto.reason?.trim();

    await this.prisma.$transaction(async (tx) => {
      const firstStage = await tx.stage.findFirst({
        where: { tenantId: user.tenantId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });

      if (!firstStage) {
        throw new BusinessException(
          422,
          'STAGE_NOT_CONFIGURED',
          'A corporação ainda não possui etapas configuradas no funil.',
        );
      }

      await tx.tenantLead.update({
        where: { id: tenantLeadId, tenantId: user.tenantId },
        data: {
          status: TenantLeadStatus.RETURNED_TO_POOL,
          assignedUserId: null,
          stageId: firstStage.id,
          lossReasonCode: null,
          lossReasonNotes: null,
          version: { increment: 1 },
        },
      });

      await tx.leadTimelineNote.create({
        data: {
          tenantLeadId,
          userId: user.userId,
          type: LeadTimelineNoteType.STATUS_CHANGE,
          title: 'Lead devolvido ao pool',
          content: reason && reason.length > 0 ? reason : DEFAULT_UNLINK_REASON,
        },
      });
    });

    // Sem checagem de acesso aqui: quem acabou de devolver o lead já não é mais
    // o responsável, e a resposta precisa sair para ele de qualquer forma.
    const updated = await this.findDetail(tenantLeadId, user.tenantId);

    return toLeadDetailResponse(updated);
  }

  /**
   * Carrega a gaveta inteira no escopo do tenant.
   *
   * Id malformado vira 404 (e não 500 do Postgres) porque a coluna é `uuid`;
   * id de outro tenant cai no mesmo 404 de propósito.
   */
  private async findDetail(
    tenantLeadId: string,
    tenantId: string,
  ): Promise<LeadDetailRow> {
    if (!UUID_PATTERN.test(tenantLeadId)) {
      throw this.leadNotFound();
    }

    const row = await this.loadDetail(tenantLeadId, tenantId);

    if (!row) {
      throw this.leadNotFound();
    }

    return row;
  }

  /** Consulta única da gaveta — a resposta depende de todas as relações. */
  private loadDetail(tenantLeadId: string, tenantId: string) {
    return this.prisma.tenantLead.findFirst({
      where: { id: tenantLeadId, tenantId },
      // O include é montado com o tenant: contatos e datas especiais são dado
      // pessoal de quem os cadastrou, não da identidade global do `Lead`.
      include: leadDetailInclude(tenantId),
    });
  }

  private leadNotFound(): BusinessException {
    return new BusinessException(
      404,
      LEAD_DETAIL_ERROR_CODES.leadNotFound,
      'Lead não encontrado nesta corporação.',
    );
  }

  /** Vendedor só abre a ficha da própria carteira; Admin e Captador, do tenant. */
  private assertCanRead(user: AuthUser, assignedUserId: string | null): void {
    if (user.operationalRole === 'VENDEDOR' && assignedUserId !== user.userId) {
      throw new BusinessException(
        403,
        LEAD_DETAIL_ERROR_CODES.forbidden,
        'Você só pode acessar as oportunidades atribuídas a você.',
      );
    }
  }

  /** Desvincular é do dono do lead ou de um Administrador. */
  private assertCanUnlink(user: AuthUser, assignedUserId: string | null): void {
    if (user.operationalRole === 'ADMIN' || assignedUserId === user.userId) {
      return;
    }

    throw new BusinessException(
      403,
      LEAD_DETAIL_ERROR_CODES.forbidden,
      'Só o responsável pelo lead ou um Administrador pode devolvê-lo ao Pool.',
    );
  }
}
