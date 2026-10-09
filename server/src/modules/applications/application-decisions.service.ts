import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import {
  APPLICATION_TYPES,
  AuditAction,
  ApplicationEventKind,
  ApplicationStatus,
  ApplicationType,
  Permission,
  roleHasPermission,
} from '@biddaloy/shared';
import type { ApplicationStep } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { AuditService } from '../audit/audit.service';
import { ApplicationsService, assertDateOrderAndPercent } from './applications.service';
import { ApplicationNotifyService } from './application-notify.service';
import { APPLICATION_HANDLERS } from './application-types';
import { feeWaiverTerms } from './handlers/fee-waiver.handler';
import {
  isOpenApplication,
  isOverrideRole,
  ReviewerScopeService,
  type ApplicationCaller,
} from './reviewer-scope';
import { Application } from './entities/application.entity';
import { ApplicationEvent } from './entities/application-event.entity';
import type { ApplicationDto } from './dto/application.dto';
import type {
  ApproveApplicationDto,
  BulkApproveDto,
  BulkApproveResultDto,
  CancelApplicationDto,
  ConsiderApplicationDto,
  RejectApplicationDto,
} from './dto/decide.dto';

/** What a committed decision hands back so notifications can go out after the commit (D18). */
type Decided = { app: Application; event: ApplicationEvent; advanced: boolean };

/**
 * [52.3.1] Approve / reject / consider / cancel / bulk-approve. Every decision is one
 * transaction: the application row is locked FIRST (before any handler or school lock) and
 * re-checked, so two racing deciders cannot both win. Handler errors propagate and roll the
 * whole decision back (D34); notifications run after commit and never fail the request.
 */
@Injectable()
export class ApplicationDecisionsService {
  private readonly logger = new Logger(ApplicationDecisionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly moduleRef: ModuleRef,
    private readonly auditService: AuditService,
    private readonly applications: ApplicationsService,
    private readonly notify: ApplicationNotifyService,
    private readonly reviewerScope: ReviewerScopeService,
  ) {}

  async approve(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    dto: ApproveApplicationDto,
    req: Request,
  ): Promise<ApplicationDto> {
    const decided = await this.dataSource.transaction(async (manager) => {
      const { app, before } = await this.lockOpen(manager, tenantId, user, id);
      const mode = await this.reviewerScope.canDecide(manager, user, app);
      if (!mode) throw this.notADecider();

      const def = APPLICATION_TYPES[app.type];
      const last = def.steps.length - 1;
      const isFinal = mode === 'OVERRIDE' || app.current_step >= last;
      const oldStep = app.current_step;

      if (dto.granted && !(app.type === ApplicationType.FEE_WAIVER && isFinal)) {
        throw new BadRequestException({
          message: 'granted is only allowed on the final approval of a FEE_WAIVER',
          details: { code: 'GRANTED_NOT_ALLOWED' },
        });
      }

      if (dto.granted) assertDateOrderAndPercent(app.type, dto.granted); // before any write

      if (!isFinal) {
        // Step approved: move on, skipping class-teacher steps nobody can act on (D37).
        const autoSkipped: number[] = [];
        let next = oldStep + 1;
        while (next < last && def.steps[next].kind === 'CLASS_TEACHER') {
          const teacher = app.subject_student_id
            ? await this.reviewerScope.classTeacherUserId(manager, tenantId, app.subject_student_id)
            : null;
          if (teacher) break;
          autoSkipped.push(next);
          next += 1;
        }
        await manager.update(
          Application,
          { id: app.id, tenant_id: tenantId },
          { current_step: next, status: ApplicationStatus.PENDING },
        );
        app.current_step = next;
        app.status = ApplicationStatus.PENDING;
        const event = await this.addEvent(manager, app, user.userId, {
          kind: ApplicationEventKind.STEP_APPROVED,
          step: oldStep,
          note: dto.note,
          data: { auto_skipped: autoSkipped },
        });
        await this.audit(manager, tenantId, user, req, before, app, event.kind);
        return { app, event, advanced: true } satisfies Decided;
      }

      // Final approval. An AUTO effect also needs its permission, for step and override alike.
      if (
        def.effect === 'AUTO' &&
        def.effectPermission &&
        !roleHasPermission(user.role, def.effectPermission)
      ) {
        throw new ForbiddenException({
          message: 'You lack the permission this approval applies',
          details: { code: 'EFFECT_PERMISSION_REQUIRED', permission: def.effectPermission },
        });
      }

      const data: Record<string, unknown> = {};
      if (mode === 'OVERRIDE') {
        data.override = true;
        data.skipped_steps = this.skippedSteps(def.steps, oldStep, user.role);
      }
      // D39: record the merged terms the discount rule is built from, not the partial input.
      app.granted = dto.granted ? feeWaiverTerms(app.payload, dto.granted) : null;
      if (app.granted) data.granted = app.granted;

      app.status = ApplicationStatus.APPROVED;
      app.decided_by_user_id = user.userId;
      app.decided_at = new Date();

      const event = await this.addEvent(manager, app, user.userId, {
        kind: ApplicationEventKind.APPROVED,
        step: oldStep,
        note: dto.note,
        data: Object.keys(data).length > 0 ? data : null,
      });

      // The effect runs in this transaction: a throw rolls the approval back (D34).
      const token = APPLICATION_HANDLERS[app.type];
      if (token) {
        const handler = this.moduleRef.get(token, { strict: false });
        app.effect_result = await handler.apply(manager, app, {
          tenantId,
          actorUserId: user.userId,
          granted: app.granted ?? undefined,
          req,
        });
      }

      await manager.update(
        Application,
        { id: app.id, tenant_id: tenantId },
        {
          status: app.status,
          decided_by_user_id: app.decided_by_user_id,
          decided_at: app.decided_at,
          granted: app.granted as never,
          effect_result: app.effect_result as never,
        },
      );
      await this.audit(manager, tenantId, user, req, before, app, event.kind);
      return { app, event, advanced: false } satisfies Decided;
    });
    return this.afterCommit(tenantId, user, id, decided);
  }

  async reject(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    dto: RejectApplicationDto,
    req: Request,
  ): Promise<ApplicationDto> {
    const decided = await this.dataSource.transaction(async (manager) => {
      const { app, before } = await this.lockOpen(manager, tenantId, user, id);
      if (!(await this.reviewerScope.canDecide(manager, user, app))) throw this.notADecider();

      app.status = ApplicationStatus.REJECTED;
      app.decided_by_user_id = user.userId;
      app.decided_at = new Date();
      await manager.update(
        Application,
        { id: app.id, tenant_id: tenantId },
        {
          status: app.status,
          decided_by_user_id: app.decided_by_user_id,
          decided_at: app.decided_at,
        },
      );
      const event = await this.addEvent(manager, app, user.userId, {
        kind: ApplicationEventKind.REJECTED,
        step: app.current_step,
        note: dto.reason,
      });
      await this.audit(manager, tenantId, user, req, before, app, event.kind);
      return { app, event, advanced: false } satisfies Decided;
    });
    return this.afterCommit(tenantId, user, id, decided);
  }

  async consider(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    dto: ConsiderApplicationDto,
    req: Request,
  ): Promise<ApplicationDto> {
    const decided = await this.dataSource.transaction(async (manager) => {
      const { app, before } = await this.lockOpen(manager, tenantId, user, id);
      if (!(await this.reviewerScope.canDecide(manager, user, app))) throw this.notADecider();
      if (app.status === ApplicationStatus.UNDER_CONSIDERATION) {
        throw new ConflictException({
          message: 'Already under consideration',
          details: { code: 'ALREADY_UNDER_CONSIDERATION' },
        });
      }

      app.status = ApplicationStatus.UNDER_CONSIDERATION;
      await manager.update(
        Application,
        { id: app.id, tenant_id: tenantId },
        { status: app.status },
      );
      const event = await this.addEvent(manager, app, user.userId, {
        kind: ApplicationEventKind.UNDER_CONSIDERATION,
        step: app.current_step,
        note: dto.note,
      });
      await this.audit(manager, tenantId, user, req, before, app, event.kind);
      return { app, event, advanced: false } satisfies Decided;
    });
    return this.afterCommit(tenantId, user, id, decided);
  }

  async cancel(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    dto: CancelApplicationDto,
    req: Request,
  ): Promise<ApplicationDto> {
    const decided = await this.dataSource.transaction(async (manager) => {
      const { app, before } = await this.lockApplication(manager, tenantId, user, id);
      const def = APPLICATION_TYPES[app.type];
      if (app.status !== ApplicationStatus.APPROVED || !def.cancellable) {
        throw new ConflictException({
          message: 'This application cannot be cancelled',
          details: { code: 'NOT_CANCELLABLE' },
        });
      }
      if (await this.reviewerScope.isOwn(manager, user, app)) {
        throw new ForbiddenException({
          message: 'You cannot cancel your own application',
          details: { code: 'APPLICANT_CANNOT_CANCEL' },
        });
      }
      // Same rule as `can.cancel` in 52.2.1.
      const allowed =
        app.type === ApplicationType.STAFF_LEAVE
          ? roleHasPermission(user.role, Permission.LEAVE_APPROVE)
          : isOverrideRole(user.role) ||
            (!!app.subject_student_id &&
              (await this.reviewerScope.classTeacherUserId(
                manager,
                tenantId,
                app.subject_student_id,
              )) === user.userId);
      if (!allowed) throw this.notADecider();

      // The handler reverses the effect; a throw rolls the cancel back.
      const token = APPLICATION_HANDLERS[app.type];
      if (token) {
        const handler = this.moduleRef.get(token, { strict: false });
        if (!handler.cancel) {
          throw new InternalServerErrorException(`No cancel handler for ${app.type}`);
        }
        await handler.cancel(manager, app, {
          tenantId,
          actorUserId: user.userId,
          req,
          reason: dto.reason,
        });
      }

      app.status = ApplicationStatus.CANCELLED;
      await manager.update(
        Application,
        { id: app.id, tenant_id: tenantId },
        { status: app.status },
      );
      const event = await this.addEvent(manager, app, user.userId, {
        kind: ApplicationEventKind.CANCELLED,
        step: app.current_step,
        note: dto.reason,
      });
      await this.audit(manager, tenantId, user, req, before, app, event.kind);
      return { app, event, advanced: false } satisfies Decided;
    });
    return this.afterCommit(tenantId, user, id, decided);
  }

  async bulkApprove(
    tenantId: string,
    user: ApplicationCaller,
    dto: BulkApproveDto,
    req: Request,
  ): Promise<BulkApproveResultDto[]> {
    const results: BulkApproveResultDto[] = [];
    // Sequential on purpose: each approval is its own locked transaction (D35).
    for (const id of dto.ids) {
      try {
        const manager = this.dataSource.manager;
        const app = await manager.findOne(Application, { where: { id, tenant_id: tenantId } });
        // A non-viewer gets NOT_FOUND, never "exists and is a FEE_WAIVER" (same as the 404 routes).
        if (!app || !(await this.reviewerScope.canView(manager, user, app))) {
          results.push({ id, ok: false, error_code: 'NOT_FOUND' });
        } else if (!APPLICATION_TYPES[app.type].bulkApprovable) {
          results.push({ id, ok: false, error_code: 'NOT_BULK_APPROVABLE' });
        } else {
          await this.approve(tenantId, user, id, { note: dto.note }, req);
          results.push({ id, ok: true });
        }
      } catch (err) {
        if (err instanceof HttpException) {
          const body = err.getResponse() as { details?: { code?: string } };
          const status = err.getStatus();
          results.push({
            id,
            ok: false,
            error_code: body?.details?.code ?? HttpStatus[status] ?? 'ERROR',
          });
        } else {
          this.logger.error(`bulk approve of ${id} failed`, err instanceof Error ? err.stack : err);
          results.push({ id, ok: false, error_code: 'INTERNAL' });
        }
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------

  /**
   * Read without a lock (404 for a missing or foreign id), then re-read FOR UPDATE and fail
   * if the row moved in between (clone of `LeaveService.decide`).
   */
  private async lockApplication(
    manager: EntityManager,
    tenantId: string,
    user: ApplicationCaller,
    id: string,
  ): Promise<{ app: Application; before: { status: ApplicationStatus; current_step: number } }> {
    const repo = manager.getRepository(Application);
    const seen = await repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!seen) throw new NotFoundException('Application not found');
    const app = await repo.findOne({
      where: { id, tenant_id: tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!app) throw new NotFoundException('Application not found');
    // Auth boundary: a same-tenant caller who cannot see it gets 404 before any state-revealing 409.
    if (!(await this.reviewerScope.canView(manager, user, app))) {
      throw new NotFoundException('Application not found');
    }
    if (app.status !== seen.status || app.current_step !== seen.current_step) {
      throw new ConflictException({
        message: 'Application changed while you were deciding',
        details: { code: 'APPLICATION_CHANGED' },
      });
    }
    return { app, before: { status: app.status, current_step: app.current_step } };
  }

  private async lockOpen(
    manager: EntityManager,
    tenantId: string,
    user: ApplicationCaller,
    id: string,
  ) {
    const locked = await this.lockApplication(manager, tenantId, user, id);
    if (!isOpenApplication(locked.app)) {
      throw new ConflictException({
        message: 'Application is no longer open',
        details: { code: 'APPLICATION_NOT_OPEN' },
      });
    }
    return locked;
  }

  private notADecider(): ForbiddenException {
    return new ForbiddenException({
      message: 'You cannot decide this application',
      details: { code: 'NOT_A_DECIDER' },
    });
  }

  /**
   * D7: steps from the current one to the last that the override caller does not satisfy by
   * rule. The current step is always one (otherwise the caller would be a STEP decider).
   * ponytail: later CLASS_TEACHER/ADDRESSEE steps count as skipped (an override role is not
   * checked against them); only ROLES/PERMISSION later steps are evaluated.
   */
  private skippedSteps(steps: ApplicationStep[], from: number, role: ApplicationCaller['role']) {
    const out: Array<{ step: number; kind: string }> = [];
    for (let i = from; i < steps.length; i += 1) {
      const s = steps[i];
      const satisfied =
        i > from &&
        ((s.kind === 'ROLES' && s.roles.includes(role)) ||
          (s.kind === 'PERMISSION' && roleHasPermission(role, s.permission)));
      if (!satisfied) out.push({ step: i, kind: s.kind });
    }
    return out;
  }

  /** Own insert: `ApplicationsService.addEvent` is private and stamps the new step. */
  private async addEvent(
    manager: EntityManager,
    app: Application,
    actorId: string,
    e: { kind: ApplicationEventKind; step: number; note?: string; data?: object | null },
  ): Promise<ApplicationEvent> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ApplicationEvent)
      .values({
        tenant_id: app.tenant_id,
        application_id: app.id,
        actor_user_id: actorId,
        kind: e.kind,
        step: e.step,
        note: e.note ?? null,
        data: (e.data ?? null) as never,
        created_at: () => 'clock_timestamp()',
      })
      .returning('*')
      .execute();
    return result.raw[0] as ApplicationEvent;
  }

  private audit(
    manager: EntityManager,
    tenantId: string,
    user: ApplicationCaller,
    req: Request,
    before: { status: ApplicationStatus; current_step: number },
    app: Application,
    eventKind: ApplicationEventKind,
  ) {
    const ctx = requestContext(req);
    return this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'Application',
        entity_id: app.id,
        tenant_id: tenantId,
        performed_by_user_id: user.userId,
        ip_address: ctx.ip,
        user_agent: ctx.userAgent,
        old_values: before,
        new_values: { status: app.status, current_step: app.current_step, event_kind: eventKind },
      },
      manager,
    );
  }

  /** Notify after commit; a failure is logged, never turned into a 500 (D18). */
  private async afterCommit(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    { app, event, advanced }: Decided,
  ): Promise<ApplicationDto> {
    try {
      if (advanced) await this.notify.onStepAdvanced(app);
      else await this.notify.onStatusChanged(app, event);
    } catch (err) {
      this.logger.error(
        `notify failed for application ${id}`,
        err instanceof Error ? err.stack : err,
      );
    }
    return this.applications.get(tenantId, user, id);
  }
}
