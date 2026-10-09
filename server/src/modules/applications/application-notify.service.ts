import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  ApplicationEventKind,
  ApplicationType,
  CommunicationMedium,
  countSmsSegments,
  isGuardianRole,
  UserStatus,
} from '@biddaloy/shared';
import type { Application } from './entities/application.entity';
import type { ApplicationEvent } from './entities/application-event.entity';
import { ApplicationTag } from './entities/application-tag.entity';
import { formatApplicationSerial } from './application-serial';
import { ReviewerScopeService } from './reviewer-scope';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { Student } from '../students/entities/student.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { PushService } from '../push/push.service';
import { CommunicationsService } from '../communications/communications.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { resolveReminderAudience } from '../communications/reminder-recipients.util';
import { SchoolsService } from '../schools/schools.service';
import { resolveTenantSettings } from '../schools/settings/tenant-settings-resolver';
import {
  resolveTemplateLocale,
  type TemplateLocale,
} from '../account-access/account-access-templates';

type PushKind = 'pending' | 'status' | 'tagged' | 'comment';

const TITLES: Record<PushKind, Record<TemplateLocale, string>> = {
  pending: { bn: 'নতুন আবেদন', en: 'New application' },
  status: { bn: 'আবেদনের অবস্থা বদলেছে', en: 'Application update' },
  tagged: { bn: 'আপনাকে একটি আবেদনে ট্যাগ করা হয়েছে', en: 'You were tagged on an application' },
  comment: { bn: 'আবেদনে নতুন মন্তব্য', en: 'New comment on an application' },
};

const TYPE_LABELS: Record<ApplicationType, Record<TemplateLocale, string>> = {
  STAFF_LEAVE: { bn: 'কর্মীর ছুটির আবেদন', en: 'Staff leave' },
  STUDENT_LEAVE: { bn: 'ছুটির আবেদন', en: 'Student leave' },
  FEE_WAIVER: { bn: 'ফি মওকুফের আবেদন', en: 'Fee waiver' },
  TESTIMONIAL: { bn: 'প্রশংসাপত্রের আবেদন', en: 'Testimonial' },
  TRANSFER_CERTIFICATE: { bn: 'ছাড়পত্রের আবেদন', en: 'Transfer certificate' },
  READMISSION: { bn: 'পুনঃভর্তির আবেদন', en: 'Readmission' },
  SECTION_CHANGE: { bn: 'শাখা বদলের আবেদন', en: 'Section change' },
  SCRIPT_RECHECK: { bn: 'উত্তরপত্র পুনর্মূল্যায়নের আবেদন', en: 'Script recheck' },
  ID_CARD_REPRINT: { bn: 'আইডি কার্ড পুনর্মুদ্রণের আবেদন', en: 'ID card reprint' },
  GENERAL: { bn: 'সাধারণ আবেদন', en: 'General application' },
};

const DECISION_SMS = {
  APPROVED: {
    bn: (school: string, serial: string, student: string) =>
      `${school}: ${student}-এর আবেদন ${serial} অনুমোদিত হয়েছে।`,
    en: (school: string, serial: string, student: string) =>
      `${school}: Application ${serial} for ${student} was approved.`,
  },
  REJECTED: {
    bn: (school: string, serial: string, student: string) =>
      `${school}: ${student}-এর আবেদন ${serial} বাতিল হয়েছে।`,
    en: (school: string, serial: string, student: string) =>
      `${school}: Application ${serial} for ${student} was rejected.`,
  },
} as const;

/**
 * Push (and, on a final decision, an opt-in guardian SMS) for application events (D18).
 * Callers invoke these after commit, but nothing here may throw into them either way: every
 * public method swallows and logs. "In-app" is the nav badge / inbox, not a table (A13).
 */
@Injectable()
export class ApplicationNotifyService {
  private readonly logger = new Logger(ApplicationNotifyService.name);

  constructor(
    private readonly push: PushService,
    private readonly communications: CommunicationsService,
    private readonly smsCredit: SmsCreditService,
    private readonly schools: SchoolsService,
    private readonly reviewerScope: ReviewerScopeService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onSubmitted(app: Application): Promise<void> {
    await this.guard('onSubmitted', async () => {
      const manager = this.dataSource.manager;
      const ids = await this.reviewerScope.currentDeciderUserIds(manager, app);
      const submitter = app.entered_by_user_id ?? app.applicant_user_id;
      await this.send(app, 'pending', await this.members(app, { ids }), submitter);
    });
  }

  async onStepAdvanced(app: Application): Promise<void> {
    await this.guard('onStepAdvanced', async () => {
      const ids = await this.reviewerScope.currentDeciderUserIds(this.dataSource.manager, app);
      await this.send(app, 'pending', await this.members(app, { ids }), null);
    });
  }

  async onStatusChanged(app: Application, event: ApplicationEvent): Promise<void> {
    await this.guard('onStatusChanged', async () => {
      const manager = this.dataSource.manager;
      const student = app.subject_student_id
        ? await manager.findOne(Student, {
            where: { id: app.subject_student_id, tenant_id: app.tenant_id },
            relations: { guardians: true },
          })
        : null;

      const ids = new Set<string>();
      if (app.applicant_user_id) ids.add(app.applicant_user_id);
      if (student?.user_id) ids.add(student.user_id);
      for (const g of student?.guardians ?? []) if (g.user_id) ids.add(g.user_id);
      if (app.subject_staff_profile_id) {
        const profile = await manager.findOne(StaffProfile, {
          where: { id: app.subject_staff_profile_id, tenant_id: app.tenant_id },
        });
        if (profile?.user_id) ids.add(profile.user_id);
      }

      const members = await this.members(app, { ids: [...ids] });
      await this.send(app, 'status', members, event.actor_user_id);

      if (student && this.isFinal(event.kind)) {
        try {
          await this.sendDecisionSms(app, event, student);
        } catch (error) {
          this.logger.error(
            `onStatusChanged: SMS failed for application ${app.id}: ${String(error)}`,
          );
        }
      }
    });
  }

  async onTagged(app: Application, tags: ApplicationTag[]): Promise<void> {
    await this.guard('onTagged', async () => {
      const members = await this.taggedMembers(app, tags);
      await this.send(app, 'tagged', members, tags[0]?.created_by_user_id ?? null);
    });
  }

  async onComment(app: Application, event: ApplicationEvent): Promise<void> {
    await this.guard('onComment', async () => {
      const tags = await this.dataSource.manager.find(ApplicationTag, {
        where: { application_id: app.id, tenant_id: app.tenant_id },
      });
      const members = await this.taggedMembers(app, tags);
      await this.send(app, 'comment', members, event.actor_user_id);
    });
  }

  // ---------------------------------------------------------------

  private isFinal(kind: ApplicationEventKind): boolean {
    return kind === ApplicationEventKind.APPROVED || kind === ApplicationEventKind.REJECTED;
  }

  private async guard(where: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`${where}: notification failed: ${String(error)}`);
    }
  }

  /** Active members of this tenant, matched by user id and/or role. userId → role in tenant. */
  private async members(
    app: Application,
    by: { ids?: string[]; roles?: string[] },
  ): Promise<Map<string, string>> {
    const where: Record<string, unknown>[] = [];
    if (by.ids?.length) where.push({ tenant_id: app.tenant_id, user_id: In(by.ids) });
    if (by.roles?.length) where.push({ tenant_id: app.tenant_id, role: In(by.roles) });
    const out = new Map<string, string>();
    if (where.length === 0) return out;
    const rows = await this.dataSource.manager.find(UserTenant, {
      where,
      relations: { user: true },
    });
    for (const row of rows) {
      if (row.user?.status === UserStatus.ACTIVE) out.set(row.user_id, row.role);
    }
    return out;
  }

  private taggedMembers(app: Application, tags: ApplicationTag[]) {
    return this.members(app, {
      ids: tags.flatMap((t) => (t.user_id ? [t.user_id] : [])),
      roles: tags.flatMap((t) => (t.role ? [t.role] : [])),
    });
  }

  private async send(
    app: Application,
    kind: PushKind,
    members: Map<string, string>,
    actorUserId: string | null | undefined,
  ): Promise<void> {
    const recipients = [...members].filter(([userId]) => userId !== actorUserId);
    if (recipients.length === 0) return;

    const school = await this.schools.findById(app.tenant_id);
    const locale = resolveTemplateLocale(resolveTenantSettings(school.settings).region?.locale);
    const name = await this.displayName(app, locale);
    const serial = formatApplicationSerial(app.serial_year, app.serial_no);
    const body = [TYPE_LABELS[app.type][locale], serial, name].filter(Boolean).join(' · ');

    const results = await Promise.allSettled(
      recipients.map(([userId, role]) =>
        this.push.sendToUser(userId, app.tenant_id, {
          type: `applications.${kind}`,
          title: TITLES[kind][locale],
          body,
          url: `${isGuardianRole(role) ? '/portal' : ''}/applications/${app.id}`,
        }),
      ),
    );
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) {
      this.logger.warn(`${kind}: ${failures}/${results.length} push sends failed`);
    }
  }

  /** Same order as list/detail: subject student, then the applicant's account, then the paper name. */
  private async displayName(app: Application, locale: TemplateLocale): Promise<string> {
    const manager = this.dataSource.manager;
    if (app.subject_student_id) {
      const student = await manager.findOne(Student, {
        where: { id: app.subject_student_id, tenant_id: app.tenant_id },
      });
      const name =
        locale === 'bn' ? (student?.full_name_bn ?? student?.full_name) : student?.full_name;
      if (name) return name;
    }
    if (app.applicant_user_id) {
      const row = await manager.findOne(UserTenant, {
        where: { tenant_id: app.tenant_id, user_id: app.applicant_user_id },
        relations: { user: true },
      });
      if (row?.user?.full_name) return row.user.full_name;
    }
    return app.applicant_name ?? '';
  }

  /** D18: student subject, APPROVED/REJECTED, school opted in, provider set, credit available. */
  private async sendDecisionSms(
    app: Application,
    event: ApplicationEvent,
    student: Student,
  ): Promise<void> {
    const school = await this.schools.findById(app.tenant_id);
    const settings = resolveTenantSettings(school.settings);
    if (settings.applications?.smsOnDecision !== true || !settings.communications?.sms?.provider) {
      return;
    }
    const guardians = resolveReminderAudience(student.guardians ?? []).guardians.filter(
      (g) => g.phone,
    );
    if (guardians.length === 0) return;

    const locale = resolveTemplateLocale(settings.region?.locale);
    const serial = formatApplicationSerial(app.serial_year, app.serial_no);
    const studentName =
      locale === 'bn' ? (student.full_name_bn ?? student.full_name) : student.full_name;
    const message = DECISION_SMS[event.kind as 'APPROVED' | 'REJECTED'][locale](
      (locale === 'bn' ? school.name_bn : null) ?? school.name,
      serial,
      studentName,
    );
    const segments = countSmsSegments(message).segments;

    let reservation: { batchId: string; segments: number } | undefined;
    if (await this.smsCredit.isMetered(app.tenant_id)) {
      // Key convention (#1317): reserve under `batch:${batchId}`, pass the bare batchId.
      const batchId = `application:${app.id}:${event.id}`;
      const reserved = await this.smsCredit.reserve(
        app.tenant_id,
        segments * guardians.length,
        `batch:${batchId}`,
        { type: 'batch', id: event.id },
      );
      if (!reserved.ok) {
        this.logger.warn(`decision SMS skipped for application ${app.id}: insufficient credit`);
        return;
      }
      reservation = { batchId, segments };
    }

    for (const guardian of guardians) {
      await this.communications
        .enqueue(
          {
            medium: CommunicationMedium.SMS,
            recipient_address: guardian.phone as string,
            recipient_name: guardian.full_name,
            message_body: message,
            guardian_id: guardian.id,
            student_id: student.id,
          },
          app.tenant_id,
          event.actor_user_id,
          reservation,
        )
        .catch((e) =>
          this.logger.warn(`decision SMS failed for guardian ${guardian.id}: ${String(e)}`),
        );
    }
  }
}
