import { Injectable } from '@nestjs/common';
import type { Application } from './entities/application.entity';
import type { ApplicationEvent } from './entities/application-event.entity';
import type { ApplicationTag } from './entities/application-tag.entity';

/** No-ops until 52.2.6 (D48): 52.2.1 and 52.3.x call these while 52.2.6 is built in parallel. */
@Injectable()
export class ApplicationNotifyService {
  // [52.2.6] fills this
  async onSubmitted(_app: Application): Promise<void> {}

  // [52.2.6] fills this
  async onStepAdvanced(_app: Application): Promise<void> {}

  // [52.2.6] fills this
  async onStatusChanged(_app: Application, _event: ApplicationEvent): Promise<void> {}

  // [52.2.6] fills this
  async onTagged(_app: Application, _tags: ApplicationTag[]): Promise<void> {}

  // [52.2.6] fills this
  async onComment(_app: Application, _event: ApplicationEvent): Promise<void> {}
}
