import { Injectable, NotImplementedException } from '@nestjs/common';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import type { UserRole } from '@biddaloy/shared';
import type { Application } from './entities/application.entity';

export type ApplicationCaller = { userId: string; role: UserRole };

/** [52.2.1] fills this (D37, D7, D49). */
@Injectable()
export class ReviewerScopeService {
  async classTeacherUserId(
    _manager: EntityManager,
    _tenantId: string,
    _studentId: string,
  ): Promise<string | null> {
    throw new NotImplementedException('[52.2.1]');
  }

  async firstStepIndex(
    _manager: EntityManager,
    _app: Application,
  ): Promise<{ index: number; skipped: number[] }> {
    throw new NotImplementedException('[52.2.1]');
  }

  async canDecide(
    _manager: EntityManager,
    _user: ApplicationCaller,
    _app: Application,
  ): Promise<false | 'STEP' | 'OVERRIDE'> {
    throw new NotImplementedException('[52.2.1]');
  }

  async canView(
    _manager: EntityManager,
    _user: ApplicationCaller,
    _app: Application,
  ): Promise<boolean> {
    throw new NotImplementedException('[52.2.1]');
  }

  /** Query alias is `a`. */
  async applyInbox(
    _qb: SelectQueryBuilder<Application>,
    _tenantId: string,
    _user: ApplicationCaller,
  ): Promise<SelectQueryBuilder<Application>> {
    throw new NotImplementedException('[52.2.1]');
  }

  async currentDeciderUserIds(_manager: EntityManager, _app: Application): Promise<string[]> {
    throw new NotImplementedException('[52.2.1]');
  }
}
