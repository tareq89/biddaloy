import { Injectable, NotImplementedException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';

/** [52.3.2] fills this. */
@Injectable()
export class StudentLeaveHandler {
  async apply(
    _manager: EntityManager,
    _app: Application,
    _ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    throw new NotImplementedException('[52.3.2]');
  }

  async cancel(
    _manager: EntityManager,
    _app: Application,
    _ctx: ApplicationEffectContext,
  ): Promise<void> {
    throw new NotImplementedException('[52.3.2]');
  }
}
