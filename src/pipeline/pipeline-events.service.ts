import { Injectable } from '@nestjs/common';
import { type Observable, Subject, filter } from 'rxjs';

/**
 * Evento de movimentação de um card no funil.
 *
 * Payload mínimo combinado com o frontend: o card que se moveu, para onde e
 * quem moveu — o suficiente para o Kanban atualizar a coluna de origem e a de
 * destino sem refazer a consulta inteira.
 */
export interface PipelineLeadMovedEvent {
  tenantId: string;
  tenantLeadId: string;
  stageId: string;
  movedBy: string;
}

/**
 * Barramento de eventos do funil, baseado em `rxjs`.
 *
 * Ainda não existe gateway WebSocket (instalar `@nestjs/websockets` agora
 * acoplaria o módulo a um transporte antes da hora): o serviço apenas expõe o
 * `Observable` por tenant. Quando o gateway chegar, ele assina
 * `stream(tenantId)` e publica em `tenant:<tenantId>` — nenhum service do
 * funil precisa mudar.
 */
@Injectable()
export class PipelineEventsService {
  private readonly events = new Subject<PipelineLeadMovedEvent>();

  /** Publica um evento para todos os assinantes do tenant. */
  emit(event: PipelineLeadMovedEvent): void {
    this.events.next(event);
  }

  /** Fluxo isolado por tenant — outro tenant nunca enxerga o evento. */
  stream(tenantId: string): Observable<PipelineLeadMovedEvent> {
    return this.events
      .asObservable()
      .pipe(filter((event) => event.tenantId === tenantId));
  }
}
