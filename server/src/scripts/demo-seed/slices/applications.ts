import type { DemoSlice } from '../context';
import { Application } from '../../../modules/applications/entities/application.entity';
import { ApplicationEvent } from '../../../modules/applications/entities/application-event.entity';
import { ApplicationTag } from '../../../modules/applications/entities/application-tag.entity';
import { ApplicationAttachment } from '../../../modules/applications/entities/application-attachment.entity';

export const slice: DemoSlice = {
  name: 'applications',
  covers: [Application, ApplicationEvent, ApplicationTag, ApplicationAttachment],
  owedBy: '58.3.08',
  run: async () => {},
};
