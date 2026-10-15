import { randomUUID } from 'crypto';
import type { Request } from 'express';
import {
  ApplicationAddressee,
  ApplicationEventKind,
  ApplicationSource,
  ApplicationStatus,
  ApplicationType,
  APPLICATION_TYPES,
  FeeType,
  LeaveStatus,
  StudentLeaveReason,
  UserRole,
} from '@biddaloy/shared';
import { Application } from '../../../modules/applications/entities/application.entity';
import { ApplicationEvent } from '../../../modules/applications/entities/application-event.entity';
import { ApplicationTag } from '../../../modules/applications/entities/application-tag.entity';
import { ApplicationAttachment } from '../../../modules/applications/entities/application-attachment.entity';
import { ApplicationsService } from '../../../modules/applications/applications.service';
import { ApplicationDecisionsService } from '../../../modules/applications/application-decisions.service';
import { ApplicationAttachmentsService } from '../../../modules/applications/application-attachments.service';
import type { DemoSeedContext, DemoSlice } from '../context';
import { todayAt } from '../dates';
import { orgIds, type OrgTenant } from './org';
import { staffByCardKey, teachersByTenant } from './staff';
import { studentIds, type DemoStudent } from './students';
import { unnestInsert } from './attendance';

/** History rows per type and branch at scale 1 (more in High, where the demo cards live). */
const HISTORY_PER_TYPE = 12;
const HISTORY_WINDOW_DAYS = 600;
const BN: Record<string, string> = {
  STAFF_LEAVE: 'ছুটির আবেদন',
  STUDENT_LEAVE: 'শিক্ষার্থীর ছুটির আবেদন',
  FEE_WAIVER: 'বেতন মওকুফের আবেদন',
  TESTIMONIAL: 'প্রশংসাপত্রের আবেদন',
  TRANSFER_CERTIFICATE: 'ছাড়পত্রের আবেদন',
  READMISSION: 'পুনঃভর্তির আবেদন',
  SECTION_CHANGE: 'শাখা পরিবর্তনের আবেদন',
  SCRIPT_RECHECK: 'উত্তরপত্র পুনর্মূল্যায়নের আবেদন',
  ID_CARD_REPRINT: 'পরিচয়পত্র পুনঃমুদ্রণের আবেদন',
  GENERAL: 'সাধারণ আবেদন',
};
const REASON = 'পারিবারিক প্রয়োজনে আবেদনটি করা হলো।';

const addDays = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const stream = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** The decision services read the request only for the audit trail's ip and user agent. */
const fakeRequest = {
  headers: {},
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
} as unknown as Request;
/** A tiny valid PDF: the upload checks the file signature. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

interface Draft {
  app: Record<string, unknown>;
  events: {
    actor: string;
    kind: ApplicationEventKind;
    step: number | null;
    at: Date;
    note?: string;
  }[];
}

export const slice: DemoSlice = {
  name: 'applications',
  covers: [Application, ApplicationEvent, ApplicationTag, ApplicationAttachment],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const st = studentIds(ctx);
    const rnd = stream(ctx.rng.number.int({ min: 1, max: 2 ** 31 - 1 }));
    const q = <T>(sql: string, args: unknown[] = []): Promise<T[]> => ctx.ds.query(sql, args);
    const adminId = org.adminUserId;
    const high = org.tenants.find((t) => t.kind === 'HIGH')!;
    const cards = staffByCardKey(ctx);
    let rows = 0;

    // --- history, in bulk (D38): every type, decided --------------------------------------------
    const drafts: Draft[] = [];
    const at = (date: string, hour: number) => todayAt(date, hour, Math.floor(rnd() * 60));
    const decide = (
      kind:
        | ApplicationEventKind.APPROVED
        | ApplicationEventKind.REJECTED
        | ApplicationEventKind.WITHDRAWN,
      type: ApplicationType,
      submitted: string,
      applicant: string | null,
    ) => {
      const decidedOn = addDays(submitted, 1 + Math.floor(rnd() * 3));
      const steps = APPLICATION_TYPES[type].steps.length;
      const events: Draft['events'] = [];
      // An approved multi-step application passed every earlier step first.
      if (kind === ApplicationEventKind.APPROVED) {
        for (let s = 0; s < steps - 1; s++) {
          events.push({
            actor: adminId,
            kind: ApplicationEventKind.STEP_APPROVED,
            step: s,
            at: at(decidedOn, 10),
          });
        }
      }
      const final = kind === ApplicationEventKind.WITHDRAWN ? (applicant ?? adminId) : adminId;
      events.push({
        actor: final,
        kind,
        step: kind === ApplicationEventKind.REJECTED ? 0 : steps - 1,
        at: at(decidedOn, 11),
        note:
          kind === ApplicationEventKind.REJECTED ? 'প্রয়োজনীয় তথ্য পাওয়া যায়নি।' : undefined,
      });
      const status = {
        [ApplicationEventKind.APPROVED]: ApplicationStatus.APPROVED,
        [ApplicationEventKind.REJECTED]: ApplicationStatus.REJECTED,
        [ApplicationEventKind.WITHDRAWN]: ApplicationStatus.WITHDRAWN,
      }[kind];
      return { events, status, decidedOn, decidedAt: events[events.length - 1].at, final };
    };
    const yearOf = (t: OrgTenant, date: string) =>
      t.years.find((y) => y.start <= date && date <= y.end)?.id ?? null;

    // Leave written by the attendance slice gets its application; the application id goes back on the row.
    const leaves = await q<{
      id: string;
      tenant_id: string;
      staff_profile_id: string;
      user_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      status: LeaveStatus;
      reason: string | null;
      decided_at: Date | null;
      employee_id: string;
    }>(
      `SELECT l.id, l.tenant_id, l.staff_profile_id, sp.user_id, l.leave_type,
              l.start_date::text AS start_date, l.end_date::text AS end_date, l.status, l.reason,
              l.decided_at, sp.employee_id
         FROM leave_records l JOIN staff_profiles sp ON sp.id = l.staff_profile_id
        WHERE l.tenant_id = ANY($1) AND l.application_id IS NULL AND l.status IN ('APPROVED', 'REJECTED')
        ORDER BY l.start_date, sp.employee_id`,
      [org.tenants.map((t) => t.id)],
    );
    const leaveLink: { leave: string; app: string }[] = [];
    const tenantById = new Map(org.tenants.map((t) => [t.id, t]));
    // Branches in org order, never uuid order: two runs must draw the same dice.
    const order = new Map(org.tenants.map((t, i) => [t.id, i]));
    leaves.sort((a, b) => order.get(a.tenant_id)! - order.get(b.tenant_id)!);
    for (const l of leaves) {
      const t = tenantById.get(l.tenant_id)!;
      // Asked for 3 days ahead, but never after the anchor: leave approved for next week was asked
      // for in the past, so no history row is submitted or decided "in the future".
      const asked = addDays(l.start_date, -3);
      const latest = addDays(ctx.anchor, -4);
      const submitted = asked < latest ? asked : latest;
      const d = decide(
        l.status === LeaveStatus.APPROVED
          ? ApplicationEventKind.APPROVED
          : ApplicationEventKind.REJECTED,
        ApplicationType.STAFF_LEAVE,
        submitted,
        l.user_id,
      );
      const id = randomUUID();
      leaveLink.push({ leave: l.id, app: id });
      drafts.push({
        app: {
          id,
          tenant_id: l.tenant_id,
          type: ApplicationType.STAFF_LEAVE,
          status: d.status,
          source: ApplicationSource.APP,
          academic_year_id: yearOf(t, submitted),
          applicant_user_id: l.user_id,
          subject_staff_profile_id: l.staff_profile_id,
          payload: {
            leave_type: l.leave_type,
            start_date: l.start_date,
            end_date: l.end_date,
            reason: l.reason ?? REASON,
          },
          start_date: l.start_date,
          end_date: l.end_date,
          current_step: 0,
          letter_text: `${BN.STAFF_LEAVE}: ${l.reason ?? REASON}`,
          letter_locale: 'bn',
          decided_by_user_id: adminId,
          decided_at: d.decidedAt,
          submittedOn: submitted,
        },
        events: [
          {
            actor: l.user_id,
            kind: ApplicationEventKind.SUBMITTED,
            step: null,
            at: at(submitted, 9),
          },
          ...d.events,
        ],
      });
    }

    // The other types: a spread over the last ~2 years, students and staff of each branch.
    const kids = new Map<string, DemoStudent[]>();
    for (const s of st.students)
      (kids.get(s.tenantId) ?? kids.set(s.tenantId, []).get(s.tenantId)!).push(s);
    const guardianUser = new Map(st.guardians.map((g) => [g.id, g.userId]));
    // The branch's newest published exam: a recheck is asked for soon after results come out.
    const exams = await q<{ id: string; tenant_id: string; subject_id: string }>(
      `SELECT DISTINCT ON (e.tenant_id) e.id, e.tenant_id, ec.subject_id
         FROM exams e JOIN exam_components ec ON ec.exam_id = e.id AND ec.deleted_at IS NULL
        WHERE e.tenant_id = ANY($1) AND e.deleted_at IS NULL AND e.status = 'PUBLISHED'
        ORDER BY e.tenant_id, e.published_at DESC, e.id, ec.subject_id`,
      [org.tenants.map((t) => t.id)],
    );
    const examOf = new Map(exams.map((e) => [e.tenant_id, e]));
    // Bulk history has no side effects (no TC issued, no section moved, no discount rule), so a type
    // whose approval changes the student is only ever rejected or withdrawn here. Today's requests
    // further down go through the real service.
    const HAS_EFFECT: ApplicationType[] = [
      ApplicationType.TRANSFER_CERTIFICATE,
      ApplicationType.SECTION_CHANGE,
      ApplicationType.READMISSION,
      ApplicationType.FEE_WAIVER,
    ];
    for (const t of org.tenants) {
      const mine = kids.get(t.id) ?? [];
      if (!mine.length) continue;
      // Students enrolled in a year, so a request is filed by someone who was at the school then.
      const enrolled = new Map(
        t.years.map((y) => [y.id, mine.filter((s) => s.stays.some((x) => x.yearId === y.id))]),
      );
      const per = Math.max(
        2,
        ctx.count(t.id === high.id ? HISTORY_PER_TYPE * 2 : HISTORY_PER_TYPE),
      );
      const types = Object.values(ApplicationType).filter(
        (x) =>
          x !== ApplicationType.STAFF_LEAVE &&
          (x !== ApplicationType.SCRIPT_RECHECK || examOf.has(t.id)),
      );
      for (const type of types) {
        const def = APPLICATION_TYPES[type];
        for (let i = 0; i < per; i++) {
          const submitted = addDays(ctx.anchor, -(5 + Math.floor(rnd() * HISTORY_WINDOW_DAYS)));
          const year = t.years.find((y) => y.start <= submitted && submitted <= y.end);
          const pool = (year && enrolled.get(year.id)) || [];
          if (!pool.length) continue;
          const student = pool[Math.floor(rnd() * pool.length)];
          const guardianId = student.guardianIds.find((g) => guardianUser.get(g));
          const applicant = guardianId ? (guardianUser.get(guardianId) ?? null) : null;
          const r = rnd();
          const kind = HAS_EFFECT.includes(type)
            ? r < 0.7
              ? ApplicationEventKind.REJECTED
              : ApplicationEventKind.WITHDRAWN
            : r < 0.6
              ? ApplicationEventKind.APPROVED
              : r < 0.85
                ? ApplicationEventKind.REJECTED
                : ApplicationEventKind.WITHDRAWN;
          const d = decide(kind, type, submitted, applicant);
          const stay = student.stays.find((x) => x.yearId === year!.id)!;
          // Sections of that same year: sections belong to one academic year.
          const sections = year!.classes.flatMap((c) => c.sections);
          const section = sections[Math.floor(rnd() * sections.length)];
          const range = { start_date: addDays(submitted, 1), end_date: addDays(submitted, 2) };
          const payload: Record<string, unknown> = {
            [ApplicationType.STUDENT_LEAVE]: {
              reason_kind: StudentLeaveReason.SICK,
              ...range,
              details: REASON,
            },
            [ApplicationType.FEE_WAIVER]: {
              kind: 'PERCENT',
              value: 25,
              fee_types: [FeeType.MONTHLY_TUITION],
              reason: REASON,
            },
            [ApplicationType.TESTIMONIAL]: { purpose: 'উচ্চশিক্ষার জন্য' },
            [ApplicationType.TRANSFER_CERTIFICATE]: {
              leaving_date: range.end_date,
              destination: 'অন্য বিদ্যালয়',
              reason: REASON,
            },
            [ApplicationType.READMISSION]: {
              class_section_id: section.id,
              occurred_on: range.start_date,
              reason: REASON,
            },
            [ApplicationType.SECTION_CHANGE]: { to_section_id: section.id, reason: REASON },
            [ApplicationType.SCRIPT_RECHECK]: {
              exam_id: examOf.get(t.id)?.id,
              subject_id: examOf.get(t.id)?.subject_id,
              reason: REASON,
            },
            [ApplicationType.ID_CARD_REPRINT]: { reason: 'কার্ডটি হারিয়ে গেছে।' },
            [ApplicationType.GENERAL]: { subject_line: 'বিদ্যালয়ে একটি অনুরোধ', body: REASON },
          }[type as Exclude<ApplicationType, ApplicationType.STAFF_LEAVE>];
          drafts.push({
            app: {
              id: randomUUID(),
              tenant_id: t.id,
              type,
              status: d.status,
              // No login for this family: the office entered the paper form for them.
              source: applicant ? ApplicationSource.APP : ApplicationSource.PAPER,
              academic_year_id: stay.yearId,
              applicant_user_id: applicant,
              applicant_name: applicant ? null : 'অভিভাবক',
              entered_by_user_id: applicant ? null : adminId,
              subject_student_id: student.id,
              payload,
              start_date: type === ApplicationType.STUDENT_LEAVE ? range.start_date : null,
              end_date: type === ApplicationType.STUDENT_LEAVE ? range.end_date : null,
              addressee: type === ApplicationType.GENERAL ? ApplicationAddressee.HEADMASTER : null,
              current_step: def.steps.length - 1,
              letter_text: `${BN[type]}: ${REASON}`,
              letter_locale: 'bn',
              decided_by_user_id: d.final,
              decided_at: d.decidedAt,
              submittedOn: submitted,
            },
            events: [
              {
                actor: applicant ?? adminId,
                kind: ApplicationEventKind.SUBMITTED,
                step: null,
                at: at(submitted, 9),
              },
              ...d.events,
            ],
          });
        }
      }
    }

    // Serials follow the submit date within a branch and year; created_at is the submit time.
    drafts.sort((a, b) =>
      (a.app.tenant_id as string) === (b.app.tenant_id as string)
        ? (a.app.submittedOn as string) < (b.app.submittedOn as string)
          ? -1
          : 1
        : (a.app.tenant_id as string) < (b.app.tenant_id as string)
          ? -1
          : 1,
    );
    const serial = new Map<string, number>();
    const appRows: Record<string, unknown>[] = [];
    const eventRows: Record<string, unknown>[] = [];
    for (const d of drafts) {
      const submitted = d.app.submittedOn as string;
      const year = Number(submitted.slice(0, 4));
      const key = `${d.app.tenant_id}|${year}`;
      const no = (serial.get(key) ?? 0) + 1;
      serial.set(key, no);
      const { submittedOn: _drop, ...app } = d.app;
      appRows.push({
        ...app,
        serial_year: year,
        serial_no: no,
        created_at: d.events[0].at,
        updated_at: d.events[d.events.length - 1].at,
      });
      for (const e of d.events) {
        eventRows.push({
          tenant_id: d.app.tenant_id,
          application_id: d.app.id,
          actor_user_id: e.actor,
          kind: e.kind,
          step: e.step,
          note: e.note ?? null,
          created_at: e.at,
        });
      }
    }
    // payload / granted / effect_result are jsonb: the helper stringifies them.
    const appCols = [
      'id',
      'tenant_id',
      'type',
      'status',
      'source',
      'serial_year',
      'serial_no',
      'academic_year_id',
      'applicant_user_id',
      'applicant_name',
      'entered_by_user_id',
      'subject_student_id',
      'subject_staff_profile_id',
      'payload',
      'start_date',
      'end_date',
      'addressee',
      'current_step',
      'letter_text',
      'letter_locale',
      'decided_by_user_id',
      'decided_at',
      'created_at',
      'updated_at',
    ];
    rows += await unnestInsert(ctx.ds, 'applications', appCols, appRows);
    rows += await unnestInsert(
      ctx.ds,
      'application_events',
      ['tenant_id', 'application_id', 'actor_user_id', 'kind', 'step', 'note', 'created_at'],
      eventRows,
    );
    // leave_records.application_id, from here: slices/attendance.ts stays as it is.
    for (let i = 0; i < leaveLink.length; i += 5000) {
      const part = leaveLink.slice(i, i + 5000);
      await q(
        `UPDATE leave_records l SET application_id = v.app
           FROM unnest($1::uuid[], $2::uuid[]) AS v(leave, app) WHERE l.id = v.leave`,
        [part.map((p) => p.leave), part.map((p) => p.app)],
      );
    }

    // --- today (D4): the real service, so the state machine is honest --------------------------
    const apps = ctx.app.get(ApplicationsService);
    const decisions = ctx.app.get(ApplicationDecisionsService);
    const attachments = ctx.app.get(ApplicationAttachmentsService);
    const submit = (
      tenantId: string,
      userId: string,
      role: UserRole,
      dto: Record<string, unknown>,
    ) => apps.submit(tenantId, { userId, role }, dto as never, {} as never);
    const soon = (n: number) => addDays(ctx.anchor, n);
    const office = cards.get('office-staff')!; // High's office desk (the login card)

    // The principal's inbox: four leave requests from High teachers, one tagging the office.
    const covered = (ctx.ids.get('routineToday') as { coveredUserId?: string } | undefined)
      ?.coveredUserId;
    const teachers = (teachersByTenant(ctx).get(high.id) ?? []).filter((t) => t.userId !== covered);
    const teacher8a = cards.get('class-teacher-8a')!;
    const askers = [
      teacher8a.userId,
      ...teachers.map((t) => t.userId).filter((u) => u !== teacher8a.userId),
    ].slice(0, 4);
    let first = true;
    for (const [i, userId] of askers.entries()) {
      const created = await submit(high.id, userId, UserRole.TEACHER, {
        type: ApplicationType.STAFF_LEAVE,
        payload: {
          leave_type: i % 2 ? 'SICK' : 'CASUAL',
          start_date: soon(3 + i * 2),
          end_date: soon(4 + i * 2),
          reason: 'জরুরি পারিবারিক কাজ',
        },
        ...(first ? { tags: [{ user_id: office.userId }] } : {}),
      });
      first = false;
      rows += 3;
      if (i === 0) {
        // A signed leave note on the class teacher's own request. The bytes go to the real S3 store
        // (the app does not boot without the S3_* env, so here the store itself is down or refusing).
        await attachments
          .upload(high.id, { userId, role: UserRole.TEACHER }, created.id, [
            {
              originalname: 'chhuti-note.pdf',
              mimetype: 'application/pdf',
              size: PDF.length,
              buffer: PDF,
            } as never,
          ])
          .catch((e: Error) => {
            throw new Error(
              `uploading the demo leave note to S3 failed: ${e.message}. seed:demo needs the S3 store ` +
                'named by S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY to be up ' +
                '(docs/architecture/22-demo-seed.md); drop the database and re-run.',
              { cause: e },
            );
          });
        rows += 1;
      }
    }

    // The guardian card (children in two branches): one request in each, one of them decided.
    const parent = st.cards.guardianUserId;
    const primary = org.tenants.find((t) => t.kind === 'PRIMARY')!;
    const letters = [
      { tenant: high.id, student: st.cards.studentId, to: ApplicationAddressee.HEADMASTER },
      { tenant: primary.id, student: st.cards.primaryChildId, to: ApplicationAddressee.OFFICE },
    ];
    // Primary's own office desk decides Primary's letter: the card user above belongs to High only.
    const [primaryOffice] = await q<{ user_id: string }>(
      `SELECT user_id FROM user_tenants
        WHERE tenant_id = $1 AND role = 'OFFICE_STAFF' AND deleted_at IS NULL ORDER BY user_id LIMIT 1`,
      [primary.id],
    );
    if (!primaryOffice) throw new Error('demo-seed applications: Primary has no OFFICE_STAFF user');
    const made: { id: string; tenant: string; to: ApplicationAddressee }[] = [];
    for (const l of letters) {
      const a = await submit(l.tenant, parent, UserRole.PARENT, {
        type: ApplicationType.GENERAL,
        subject_student_id: l.student,
        addressee: l.to,
        payload: { subject_line: 'বিদ্যালয়ে একটি অনুরোধ', body: REASON },
      });
      made.push({ id: a.id, tenant: l.tenant, to: l.to });
      rows += 3;
    }
    // The headmaster approves the first; the office rejects the second (it stays visible as history).
    await decisions.approve(
      high.id,
      { userId: adminId, role: UserRole.ADMIN },
      made[0].id,
      { note: 'অনুমোদিত' } as never,
      fakeRequest,
    );
    await decisions.reject(
      primary.id,
      { userId: primaryOffice.user_id, role: UserRole.OFFICE_STAFF },
      made[1].id,
      { reason: 'বিস্তারিত জানানো হয়নি, অনুগ্রহ করে আবার আবেদন করুন।' } as never,
      fakeRequest,
    );
    rows += 2;
    return rows;
  },
};
