import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { APPLICATION_TYPES, ApplicationAddressee, ApplicationType } from '@biddaloy/shared';
import { resolveTemplateLocale } from '../account-access/account-access-templates';
import { toBengaliDigits } from '../communications/fee-notification-template.util';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { SchoolsService } from '../schools/schools.service';
import {
  ALL_FEES_LABEL,
  CHILD_LABEL,
  GUARDIAN_LABEL,
  FEE_TYPE_LABELS,
  LEAVE_TYPE_LABELS,
  LETTER_TEMPLATES,
  LETTER_TITLES,
  SERIAL_LABEL,
  STUDENT_LEAVE_REASON_LABELS,
  cleanText,
  fill,
  formatLetterDate,
  titleKeyForAddressee,
  titleKeyForStep,
} from './letter-templates';

export interface LetterInput {
  type: ApplicationType;
  payload: Record<string, unknown>;
  subject_student_id?: string | null;
  subject_staff_profile_id?: string | null;
  addressee?: ApplicationAddressee | null;
  addressee_user_id?: string | null;
  applicant_user_id: string | null;
  applicant_name?: string | null; // D46
  serial: string | null; // '2026/0045'; null for the letter preview
  date: string; // 'YYYY-MM-DD', the submit day
}

export interface LetterContext {
  locale: 'bn' | 'en';
  date: string;
  school_name: string;
  to_title: string;
  applicant_name: string;
  applicant_relation: string;
  serial: string | null;
  subject_name: string;
  class_name: string | null;
  section_name: string | null;
  roll: string | null;
  ref_names: Record<string, string>; // e.g. { to_section_id: 'Class 7 · B', exam_id: 'Half-yearly' }
  days: number | null; // working days, leave types only
}

type StudentRow = {
  user_id: string | null;
  full_name: string;
  full_name_bn: string | null;
  roll: string | null;
  section_name: string | null;
  class_name: string | null;
};

@Injectable()
export class ApplicationLetterService {
  constructor(
    private readonly schools: SchoolsService,
    private readonly calendar: SchoolCalendarService,
  ) {}

  /** Loads every name a letter needs. Each read filters `tenant_id` (users via `user_tenants`). */
  async buildContext(
    manager: EntityManager,
    tenantId: string,
    input: LetterInput,
  ): Promise<LetterContext> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    const locale = resolveTemplateLocale(settings.region?.locale);
    const bn = locale === 'bn';
    const str = (k: string): string | null =>
      typeof input.payload[k] === 'string' ? (input.payload[k] as string) : null;
    const one = async <T>(sql: string, params: unknown[]): Promise<T | undefined> =>
      ((await manager.query(sql, params)) as T[])[0];

    // deleted_at is deliberately not filtered: a letter about a since-removed student/user is historical.
    const userName = async (id: string | null | undefined): Promise<string | null> => {
      if (!id) return null;
      const r = await one<{ full_name: string }>(
        `SELECT u.full_name FROM users u
           JOIN user_tenants ut ON ut.user_id = u.id
          WHERE ut.tenant_id = $1 AND u.id = $2 AND ut.deleted_at IS NULL LIMIT 1`,
        [tenantId, id],
      );
      return r?.full_name ?? null;
    };

    const [school, applicantUser, student, staff, addresseeName] = await Promise.all([
      one<{ name: string; name_bn: string | null }>(
        `SELECT name, name_bn FROM schools WHERE id = $1`,
        [tenantId],
      ),
      userName(input.applicant_user_id),
      input.subject_student_id
        ? one<StudentRow>(
            `SELECT s.user_id, s.full_name, s.full_name_bn, s.roll_number::text AS roll,
                    cs.section_name, c.name AS class_name
               FROM students s
               LEFT JOIN class_sections cs ON cs.id = s.class_section_id AND cs.tenant_id = s.tenant_id
               LEFT JOIN classes c ON c.id = cs.class_id AND c.tenant_id = s.tenant_id
              WHERE s.tenant_id = $1 AND s.id = $2`,
            [tenantId, input.subject_student_id],
          )
        : undefined,
      input.subject_staff_profile_id
        ? one<{ full_name: string }>(
            `SELECT u.full_name FROM staff_profiles sp JOIN users u ON u.id = sp.user_id
              WHERE sp.tenant_id = $1 AND sp.id = $2`,
            [tenantId, input.subject_staff_profile_id],
          )
        : undefined,
      input.addressee === ApplicationAddressee.STAFF_USER
        ? userName(input.addressee_user_id)
        : null,
    ]);

    // ref_names: same keys/format as ApplicationDto.ref_names (52.2.1)
    const ref_names: Record<string, string> = {};
    for (const key of ['to_section_id', 'class_section_id'] as const) {
      const id = str(key);
      const r =
        id &&
        (await one<{ name: string }>(
          `SELECT c.name || ' · ' || cs.section_name AS name
             FROM class_sections cs JOIN classes c ON c.id = cs.class_id
            WHERE cs.tenant_id = $1 AND cs.id = $2`,
          [tenantId, id],
        ));
      if (r) ref_names[key] = r.name;
    }
    const examId = str('exam_id');
    const exam =
      examId &&
      (await one<{ name: string }>(`SELECT name FROM exams WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        examId,
      ]));
    if (exam) ref_names.exam_id = exam.name;
    const subjectId = str('subject_id');
    const subject =
      subjectId &&
      (await one<{ name: string }>(
        `SELECT ${bn ? 'coalesce(name_bn, name_en)' : 'name_en'} AS name
           FROM subjects WHERE tenant_id = $1 AND id = $2`,
        [tenantId, subjectId],
      ));
    if (subject) ref_names.subject_id = subject.name;

    const isLeave =
      input.type === ApplicationType.STAFF_LEAVE || input.type === ApplicationType.STUDENT_LEAVE;
    const from = str('start_date');
    const to = str('end_date');
    const days =
      isLeave && from && to
        ? (await this.calendar.getWorkingDays({ tenantId, from, to })).count
        : null;

    // D13: the final step names the addressee; GENERAL (ADDRESSEE step) uses the chosen one.
    const steps = APPLICATION_TYPES[input.type].steps;
    const titleKey =
      titleKeyForStep(steps[steps.length - 1]) ??
      (input.addressee ? titleKeyForAddressee(input.addressee) : null);
    const to_title = titleKey ? LETTER_TITLES[titleKey][locale] : (addresseeName ?? '');

    const isGuardian =
      !!student && (!input.applicant_user_id || student.user_id !== input.applicant_user_id);

    return {
      locale,
      date: input.date,
      school_name: (bn ? school?.name_bn : null) ?? school?.name ?? '',
      to_title,
      applicant_name: applicantUser ?? input.applicant_name ?? '',
      applicant_relation: isGuardian ? GUARDIAN_LABEL[locale] : '',
      serial: input.serial,
      subject_name: student
        ? ((bn ? student.full_name_bn : null) ?? student.full_name)
        : (staff?.full_name ?? ''),
      class_name: student?.class_name ?? null,
      section_name: student?.section_name ?? null,
      roll: student?.roll ?? null,
      ref_names,
      days,
    };
  }

  /**
   * Pure. Fills `LETTER_TEMPLATES[type][ctx.locale]` in one pass; every user value goes through
   * `cleanText` first (no `\r`/control chars/`<>`), and a value is never re-scanned for `{{...}}`.
   */
  render(type: ApplicationType, payload: Record<string, unknown>, ctx: LetterContext): string {
    const { locale } = ctx;
    const bn = locale === 'bn';
    // Bangla digits per value, never on the serial (D47), so the final fill stays one pass.
    const v = (x: unknown): string => {
      const s = cleanText(x);
      return bn ? toBengaliDigits(s) : s;
    };
    const d = (x: unknown): string => v(formatLetterDate(x));
    const p = (k: string): unknown => payload[k];
    const label = (map: Record<string, Record<'bn' | 'en', string>>, k: unknown): string =>
      typeof k === 'string' && map[k] ? map[k][locale] : v(k);

    const serialLine = ctx.serial ? `${SERIAL_LABEL[locale]}: ${cleanText(ctx.serial)}` : '';
    const sign = [v(ctx.applicant_name), v(ctx.applicant_relation), serialLine]
      .filter(Boolean)
      .join('\n');

    const feeTypes = Array.isArray(p('fee_types')) ? (p('fee_types') as unknown[]) : [];
    const from = p('start_date');
    const to = p('end_date');
    const period =
      from && to ? (bn ? ` (${d(from)} থেকে ${d(to)})` : ` (${d(from)} to ${d(to)})`) : '';
    const dest = v(p('destination'));

    const vars: Record<string, string> = {
      date: d(ctx.date),
      to: v(ctx.to_title),
      school: v(ctx.school_name),
      sign,
      relation_child: CHILD_LABEL[locale],
      student_name: v(ctx.subject_name),
      student_line: [
        v(ctx.subject_name),
        [v(ctx.class_name), v(ctx.section_name)].filter(Boolean).join(' '),
        ctx.roll ? `${bn ? 'রোল' : 'roll'} ${v(ctx.roll)}` : '',
      ]
        .filter(Boolean)
        .join(', '),
      from_section: [v(ctx.class_name), v(ctx.section_name)].filter(Boolean).join(' '),
      class_name: v(ctx.class_name),
      section_name: v(ctx.section_name),
      roll: v(ctx.roll),
      days: v(ctx.days),
      leave_type_label: label(LEAVE_TYPE_LABELS, p('leave_type')),
      reason_label: label(STUDENT_LEAVE_REASON_LABELS, p('reason_kind')),
      start_date: d(from),
      end_date: d(to),
      reason: v(p('reason')),
      details: v(p('details')),
      purpose: v(p('purpose')),
      value: v(p('value')),
      kind_suffix: p('kind') === 'PERCENT' ? '%' : bn ? ' টাকা' : ' BDT',
      fee_types: feeTypes.length
        ? feeTypes.map((t) => label(FEE_TYPE_LABELS, t)).join(', ')
        : ALL_FEES_LABEL[locale],
      period,
      leaving_date: d(p('leaving_date')),
      destination_clause: dest ? (bn ? `, গন্তব্য: ${dest}` : `, destination: ${dest}`) : '',
      occurred_on: d(p('occurred_on')),
      target_section: v(ctx.ref_names.to_section_id ?? ctx.ref_names.class_section_id),
      exam_name: v(ctx.ref_names.exam_id),
      subject_title: v(ctx.ref_names.subject_id),
      subject_line: v(p('subject_line')),
      body: v(p('body')),
    };
    return fill(LETTER_TEMPLATES[type][locale], vars).trim();
  }
}
