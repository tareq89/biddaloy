import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { WORKBOOK_JOB_FINISHED, WorkbookJobFinishedPayload } from './export.constants';

/**
 * The event contract between this ticket's processor and [14.7.3] (#601)'s
 * notifier. Built on Node's own `events` module rather than
 * `@nestjs/event-emitter` — that package is not a dependency of this repo
 * (see the plan's correction C1) — but wrapped as an injectable Nest
 * provider so a consumer can pull it out of `ExportModule`'s exports like
 * any other service.
 */
@Injectable()
export class WorkbookJobEventsService extends EventEmitter {
  constructor() {
    super();
    // Several consumers (notifier, retention, future ones) may subscribe;
    // the default limit of 10 would log an EventEmitter warning long
    // before that's actually a leak.
    this.setMaxListeners(50);
  }

  emitFinished(payload: WorkbookJobFinishedPayload): void {
    this.emit(WORKBOOK_JOB_FINISHED, payload);
  }

  onFinished(handler: (payload: WorkbookJobFinishedPayload) => void): void {
    this.on(WORKBOOK_JOB_FINISHED, handler);
  }
}
