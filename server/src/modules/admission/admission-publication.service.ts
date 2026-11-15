import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AdmissionApplicantStatus, AuditAction, countSmsSegments } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { SiteCacheService } from '../website/public/site-cache.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import {
  AdmissionNotificationService,
  resultBody,
  type AdmissionResultOutcome,
} from './admission-notification.service';
import type {
  CallListRowDto,
  AdmissionPublishDto,
  PublishEstimateResponseDto,
  PublishResponseDto,
  PublishWhat,
  SetCalledResponseDto,
} from './dto/admission-publication.dto';

export interface PublishActor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

interface Recipient {
  id: string;
  tenant_id: string;
  applicant_name: string;
  guardian_name: string;
  guardian_phone: string;
  status: AdmissionApplicantStatus;
  outcome: AdmissionResultOutcome;
}

const BATCH = 25;
const CALL = '[CALL]';
const CALL_CLEARED = '[CALL-CLEARED]';
const APPLICANT_COLS = `a.id, a.tenant_id, a.applicant_name, a.guardian_name, a.guardian_phone, a.status`;

/**
 * [#4184, D6/D26/D27] Publish a stage result or a list: set the flag the public API reads, SMS the
 * right guardians, keep a call list. One recipient query backs both the estimate and the send.
 * Never SMS FEE_PENDING; REJECTED and not-passed only when asked (D26).
 */
@Injectable()
export class AdmissionPublicationService {
  private readonly logger = new Logger(AdmissionPublicationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: AdmissionNotificationService,
    private readonly credits: SmsCreditService,
    private readonly audit: AuditService,
    // forwardRef: WebsiteModule imports AdmissionModule too.
    @Inject(forwardRef(() => SiteCacheService)) private readonly siteCache: SiteCacheService,
  ) {}

  private async intake(manager: EntityManager, id: string, tenantId: string, lock = false) {
    const intake = await manager.getRepository(AdmissionIntake).findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!intake) throw new NotFoundException('Admission intake not found');
    return intake;
  }

  /** The row that carries the published flag, and whether it is already published. */
  private async target(
    manager: EntityManager,
    intakeId: string,
    what: PublishWhat,
    refId: string,
    tenantId: string,
  ): Promise<{ published: boolean }> {
    const [row] = (await manager.query(
      what === 'STAGE'
        ? `SELECT (config ? 'published_at') AS published FROM admission_stages
            WHERE id = $1 AND intake_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`
        : `SELECT (published_at IS NOT NULL) AS published FROM admission_lists
            WHERE id = $1 AND intake_id = $2 AND tenant_id = $3 AND deleted_at IS NULL
              AND kind = $4`,
      what === 'STAGE' ? [refId, intakeId, tenantId] : [refId, intakeId, tenantId, what],
    )) as { published: boolean }[];
    if (!row) throw new NotFoundException('Nothing to publish found');
    return row;
  }

  private async recipients(
    manager: EntityManager,
    what: PublishWhat,
    refId: string,
    tenantId: string,
    includeNotSelected: boolean,
  ): Promise<Recipient[]> {
    const common = `a.tenant_id = $1 AND a.deleted_at IS NULL AND a.status <> '${AdmissionApplicantStatus.FEE_PENDING}'
          AND ($3 OR a.status <> '${AdmissionApplicantStatus.REJECTED}')`;
    if (what === 'STAGE') {
      const rows = (await manager.query(
        `SELECT ${APPLICANT_COLS}, r.passed FROM admission_stage_results r
           JOIN admission_applicants a ON a.id = r.applicant_id
          WHERE r.tenant_id = $1 AND r.stage_id = $2 AND r.deleted_at IS NULL
            AND r.passed IS NOT NULL AND (r.passed OR $3) AND ${common}
          ORDER BY a.id`,
        [tenantId, refId, includeNotSelected],
      )) as (Omit<Recipient, 'outcome'> & { passed: boolean })[];
      return rows.map((r) => ({
        ...r,
        outcome:
          r.status === AdmissionApplicantStatus.REJECTED
            ? 'REJECTED'
            : r.passed
              ? 'PASSED'
              : 'NOT_PASSED',
      }));
    }
    const rows = (await manager.query(
      `SELECT ${APPLICANT_COLS} FROM admission_list_members m
         JOIN admission_applicants a ON a.id = m.applicant_id
        WHERE m.tenant_id = $1 AND m.list_id = $2 AND m.deleted_at IS NULL AND ${common}
        ORDER BY m.position`,
      [tenantId, refId, includeNotSelected],
    )) as Omit<Recipient, 'outcome'>[];
    const listed = what === 'MERIT' ? 'SELECTED' : 'WAITING';
    return rows.map((r) => ({
      ...r,
      outcome: r.status === AdmissionApplicantStatus.REJECTED ? 'REJECTED' : listed,
    }));
  }

  async estimate(
    intakeId: string,
    what: PublishWhat,
    refId: string,
    includeNotSelected: boolean,
    tenantId: string,
  ): Promise<PublishEstimateResponseDto> {
    const manager = this.dataSource.manager;
    const intake = await this.intake(manager, intakeId, tenantId);
    const { published } = await this.target(manager, intakeId, what, refId, tenantId);
    // A repeat publish sends nothing, so the estimate is 0 too.
    const rows = published
      ? []
      : await this.recipients(manager, what, refId, tenantId, includeNotSelected);
    const locale = await this.notifications.localeFor(tenantId);
    const segments = rows.reduce(
      (sum, r) =>
        sum +
        countSmsSegments(resultBody(locale, r.outcome, r.applicant_name, intake.title)).segments,
      0,
    );
    const metered = await this.credits.isMetered(tenantId);
    const available = metered ? (await this.credits.getBalance(tenantId)).available : null;
    return { recipients: rows.length, segments, metered, available, already_published: published };
  }

  async publish(
    intakeId: string,
    dto: AdmissionPublishDto,
    tenantId: string,
    actor: PublishActor,
  ): Promise<PublishResponseDto> {
    const include = dto.include_not_selected ?? false;
    const { intake, firstTime, publishedAt, rows } = await this.dataSource.transaction(
      async (manager) => {
        // Intake lock: the same one stage updates take, so a config save cannot drop published_at.
        const intake = await this.intake(manager, intakeId, tenantId, true);
        await this.target(manager, intakeId, dto.what, dto.ref_id, tenantId);
        // The flag flips once; the row it matched is the proof this call is the first.
        const [flipRows] = (await manager.query(
          dto.what === 'STAGE'
            ? `UPDATE admission_stages
                  SET config = config || jsonb_build_object('published_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                WHERE id = $1 AND tenant_id = $2 AND NOT (config ? 'published_at')
                RETURNING config->>'published_at' AS at`
            : `UPDATE admission_lists SET published_at = now()
                WHERE id = $1 AND tenant_id = $2 AND published_at IS NULL
                RETURNING to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`,
          [dto.ref_id, tenantId],
        )) as [{ at: string }[], number];
        // pg returns [rows, affectedCount] for UPDATE ... RETURNING.
        const flip = flipRows[0];
        let publishedAt = flip?.at;
        if (!publishedAt) {
          const [cur] = (await manager.query(
            dto.what === 'STAGE'
              ? `SELECT config->>'published_at' AS at FROM admission_stages WHERE id = $1 AND tenant_id = $2`
              : `SELECT to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM admission_lists WHERE id = $1 AND tenant_id = $2`,
            [dto.ref_id, tenantId],
          )) as { at: string }[];
          publishedAt = cur.at;
        }
        const rows =
          flip && dto.send_sms
            ? await this.recipients(manager, dto.what, dto.ref_id, tenantId, include)
            : [];
        if (flip) {
          // No names or phones in the audit row.
          await this.audit.record(
            {
              action: AuditAction.UPDATE,
              entity_type: 'AdmissionApplicant',
              entity_id: null,
              tenant_id: tenantId,
              performed_by_user_id: actor.userId,
              ip_address: actor.ip,
              user_agent: actor.userAgent,
              old_values: null,
              new_values: {
                op: 'publish',
                what: dto.what,
                ref_id: dto.ref_id,
                send_sms: dto.send_sms,
                recipients: rows.length,
              },
            },
            manager,
          );
        }
        return { intake, firstTime: Boolean(flip), publishedAt, rows };
      },
    );

    // After commit: the 60 s result/list feeds refresh; a failed SMS never undoes the publish.
    if (firstTime) await this.siteCache.invalidate(tenantId);
    if (firstTime) await this.sendBatches(intake.title, rows);
    return { published_at: publishedAt, already_published: !firstTime, sms_attempted: rows.length };
  }

  private async sendBatches(title: string, rows: Recipient[]): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH) {
      await Promise.all(
        rows.slice(i, i + BATCH).map((r) =>
          this.notifications.notifyResult(r, title, r.outcome).catch((error: unknown) => {
            this.logger.warn(`Result SMS failed for applicant ${r.id}: ${String(error)}`);
          }),
        ),
      );
    }
  }

  async callList(intakeId: string, listId: string, tenantId: string): Promise<CallListRowDto[]> {
    const manager = this.dataSource.manager;
    const [list] = (await manager.query(
      `SELECT 1 FROM admission_lists WHERE id = $1 AND intake_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
      [listId, intakeId, tenantId],
    )) as unknown[];
    if (!list) throw new NotFoundException('Admission list not found');
    const rows = (await manager.query(
      `SELECT a.id AS applicant_id, a.applicant_name AS name, a.guardian_phone AS phone,
              a.roll_number AS roll, c.notes
         FROM admission_list_members m
         JOIN admission_applicants a ON a.id = m.applicant_id AND a.tenant_id = m.tenant_id
         LEFT JOIN LATERAL (
           SELECT e.notes FROM admission_evaluations e
            WHERE e.tenant_id = $1 AND e.applicant_id = a.id AND e.notes LIKE '[CALL%'
            ORDER BY e.created_at DESC, e.id DESC LIMIT 1) c ON true
        WHERE m.tenant_id = $1 AND m.list_id = $2 AND m.deleted_at IS NULL AND a.deleted_at IS NULL
          AND a.status <> '${AdmissionApplicantStatus.FEE_PENDING}'
        ORDER BY m.position`,
      [tenantId, listId],
    )) as (Omit<CallListRowDto, 'called' | 'note'> & { notes: string | null })[];
    return rows.map(({ notes, ...r }) => {
      const called = notes?.startsWith(`${CALL}`) ?? false;
      return { ...r, called, note: called ? notes!.slice(CALL.length).trim() || null : null };
    });
  }

  /** Append-only: the newest `[CALL]` / `[CALL-CLEARED]` evaluation row wins. */
  async setCalled(
    applicantId: string,
    dto: { called: boolean; note?: string },
    tenantId: string,
    actor: PublishActor,
  ): Promise<SetCalledResponseDto> {
    const [found] = (await this.dataSource.query(
      `SELECT 1 FROM admission_applicants WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [applicantId, tenantId],
    )) as unknown[];
    if (!found) throw new NotFoundException('Admission applicant not found');
    const note = dto.called ? (dto.note?.trim() ?? '') : '';
    await this.dataSource.getRepository(AdmissionEvaluation).insert({
      tenant_id: tenantId,
      applicant_id: applicantId,
      reviewer_user_id: actor.userId,
      notes: dto.called ? `${CALL} ${note}`.trimEnd() : CALL_CLEARED,
      decision: null,
    });
    return { applicant_id: applicantId, called: dto.called, note: note || null };
  }
}
