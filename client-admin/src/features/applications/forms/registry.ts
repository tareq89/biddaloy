/**
 * [52.4.2] One entry per application type (D3: a plain record, no class
 * hierarchy). `schema` validates what the user typed and returns the exact
 * payload `POST /applications` takes (dates `YYYY-MM-DD`, empty optionals
 * dropped); `defaults` seeds the form; `Fields` render it via `useFormContext`.
 */
import {
  DiscountKind,
  FeeType,
  LeaveType,
  StudentLeaveReason,
  type ApplicationType,
} from '@biddaloy/shared';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';
import type * as React from 'react';
import { z } from 'zod';

import { IdCardReprintFields, ScriptRecheckFields, TestimonialFields } from './document-forms';
import { FeeWaiverFields } from './fee-waiver-form';
import { GeneralFields } from './general-form';
import { StaffLeaveFields, StudentLeaveFields } from './leave-forms';
import {
  ReadmissionFields,
  SectionChangeFields,
  TransferCertificateFields,
} from './student-record-forms';

export type ApplicationSubject =
  | { kind: 'STUDENT'; studentId: string; classId: string; sectionId: string }
  | { kind: 'STAFF'; staffProfileId: string };

// ---- Payloads (hand-written from `server/.../dto/payloads/*.dto.ts`) ----

export interface StaffLeavePayload {
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
}
export interface StudentLeavePayload {
  reason_kind: StudentLeaveReason;
  start_date: string;
  end_date: string;
  details: string;
}
export interface FeeWaiverPayload {
  kind: DiscountKind;
  value: number;
  fee_types?: FeeType[];
  start_date?: string;
  end_date?: string;
  reason: string;
}
export interface TestimonialPayload {
  purpose: string;
}
export interface TransferCertificatePayload {
  leaving_date: string;
  destination?: string;
  reason: string;
}
export interface ReadmissionPayload {
  class_section_id: string;
  occurred_on: string;
  reason: string;
}
export interface SectionChangePayload {
  to_section_id: string;
  reason: string;
}
export interface ScriptRecheckPayload {
  exam_id: string;
  subject_id: string;
  reason: string;
}
export interface IdCardReprintPayload {
  reason: string;
}
export interface GeneralPayload {
  subject_line: string;
  body: string;
}

export type ApplicationPayload =
  | StaffLeavePayload
  | StudentLeavePayload
  | FeeWaiverPayload
  | TestimonialPayload
  | TransferCertificatePayload
  | ReadmissionPayload
  | SectionChangePayload
  | ScriptRecheckPayload
  | IdCardReprintPayload
  | GeneralPayload;

export interface FormDef {
  schema: (
    t: TFunction,
    regionConfig: RegionConfig,
  ) => z.ZodType<Record<string, unknown>, Record<string, unknown>>;
  defaults: (
    subject: ApplicationSubject,
    prior?: Record<string, unknown>,
  ) => Record<string, unknown>;
  Fields: React.ComponentType<{ subject: ApplicationSubject }>;
}

// ---- Schema building blocks ----

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Required date, always `YYYY-MM-DD` (never a full ISO datetime). */
const date = (t: TFunction) =>
  z.string().regex(ISO_DATE, t('errors.dateRequired', { ns: 'applicationForms' }));
const optionalDate = (t: TFunction) =>
  z.union([
    z.literal(''),
    z.string().regex(ISO_DATE, t('errors.dateRequired', { ns: 'applicationForms' })),
  ]);

const text = (t: TFunction, max: number, requiredKey = 'required') =>
  z
    .string()
    .trim()
    .min(1, t(`errors.${requiredKey}`, { ns: 'applicationForms' }))
    .min(3, t('errors.tooShort', { ns: 'applicationForms' }))
    .max(max, t('errors.tooLong', { ns: 'applicationForms', max }));

const reason = (t: TFunction) => text(t, 1000, 'reasonRequired');

const pick = (t: TFunction) => z.string().min(1, t('errors.pick', { ns: 'applicationForms' }));

/** Drop what the user left empty, so optional keys are absent from the payload. */
function stripEmpty<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && v.length === 0),
    ),
  ) as T;
}

/** `end >= start`; ISO date strings compare correctly as text. */
const endAfterStart = (d: { start_date?: string; end_date?: string }): boolean =>
  !d.start_date || !d.end_date || d.end_date >= d.start_date;
const endMessage = (t: TFunction) => ({
  path: ['end_date'],
  message: t('errors.endBeforeStart', { ns: 'applicationForms' }),
});

export const APPLICATION_FORMS: Record<ApplicationType, FormDef> = {
  STAFF_LEAVE: {
    schema: (t) =>
      z
        .object({
          leave_type: pick(t),
          start_date: date(t),
          end_date: date(t),
          reason: reason(t),
        })
        .refine(endAfterStart, endMessage(t)),
    defaults: () => ({ leave_type: LeaveType.CASUAL, start_date: '', end_date: '', reason: '' }),
    Fields: StaffLeaveFields,
  },
  STUDENT_LEAVE: {
    schema: (t) =>
      z
        .object({
          reason_kind: pick(t),
          start_date: date(t),
          end_date: date(t),
          details: text(t, 1000, 'required'),
        })
        .refine(endAfterStart, endMessage(t)),
    defaults: () => ({ reason_kind: '', start_date: '', end_date: '', details: '' }),
    Fields: StudentLeaveFields,
  },
  FEE_WAIVER: {
    schema: (t) =>
      z
        .object({
          kind: z.enum([DiscountKind.PERCENT, DiscountKind.FLAT]),
          value: z
            .string()
            .trim()
            .min(1, t('errors.required', { ns: 'applicationForms' }))
            .regex(/^\d+(\.\d{1,2})?$/, t('errors.number', { ns: 'applicationForms' })),
          fee_types: z.array(z.string()).max(20),
          start_date: optionalDate(t),
          end_date: optionalDate(t),
          reason: reason(t),
        })
        .refine(endAfterStart, endMessage(t))
        .superRefine((d, ctx) => {
          const n = Number(d.value);
          if (d.kind === DiscountKind.PERCENT && (n < 1 || n > 100)) {
            ctx.addIssue({
              code: 'custom',
              path: ['value'],
              message: t('errors.percentRange', { ns: 'applicationForms' }),
            });
          } else if (d.kind === DiscountKind.FLAT && n <= 0) {
            ctx.addIssue({
              code: 'custom',
              path: ['value'],
              message: t('errors.flatPositive', { ns: 'applicationForms' }),
            });
          }
        })
        .transform((d) => stripEmpty({ ...d, value: Number(d.value) })),
    defaults: () => ({
      kind: DiscountKind.PERCENT,
      value: '',
      fee_types: [],
      start_date: '',
      end_date: '',
      reason: '',
    }),
    Fields: FeeWaiverFields,
  },
  TESTIMONIAL: {
    schema: (t) => z.object({ purpose: text(t, 300) }),
    defaults: () => ({ purpose: '' }),
    Fields: TestimonialFields,
  },
  TRANSFER_CERTIFICATE: {
    schema: (t) =>
      z
        .object({
          leaving_date: date(t),
          destination: z
            .string()
            .trim()
            .max(200, t('errors.tooLong', { ns: 'applicationForms', max: 200 })),
          reason: reason(t),
        })
        .transform(stripEmpty),
    defaults: () => ({ leaving_date: '', destination: '', reason: '' }),
    Fields: TransferCertificateFields,
  },
  READMISSION: {
    schema: (t, regionConfig) =>
      z
        .object({
          class_section_id: pick(t),
          occurred_on: date(t),
          reason: reason(t),
        })
        .refine((d) => d.occurred_on <= tenantTodayIso(regionConfig), {
          path: ['occurred_on'],
          message: t('errors.futureDate', { ns: 'applicationForms' }),
        }),
    // Back-navigation passes the prior values: the class follows the picked
    // section (the subject's own section is the only mapping known here),
    // else keeps the prior class, else the subject's class.
    defaults: (s, prior) => ({
      class_id:
        s.kind !== 'STUDENT'
          ? ''
          : prior?.class_section_id === s.sectionId
            ? s.classId
            : (prior?.class_id ?? s.classId),
      class_section_id: '',
      occurred_on: '',
      reason: '',
    }),
    Fields: ReadmissionFields,
  },
  SECTION_CHANGE: {
    schema: (t) => z.object({ to_section_id: pick(t), reason: reason(t) }),
    defaults: () => ({ to_section_id: '', reason: '' }),
    Fields: SectionChangeFields,
  },
  SCRIPT_RECHECK: {
    schema: (t) => z.object({ exam_id: pick(t), subject_id: pick(t), reason: reason(t) }),
    defaults: () => ({ exam_id: '', subject_id: '', reason: '' }),
    Fields: ScriptRecheckFields,
  },
  ID_CARD_REPRINT: {
    schema: (t) => z.object({ reason: reason(t) }),
    defaults: () => ({ reason: '' }),
    Fields: IdCardReprintFields,
  },
  GENERAL: {
    schema: (t) => z.object({ subject_line: text(t, 200), body: text(t, 5000) }),
    defaults: () => ({ subject_line: '', body: '' }),
    Fields: GeneralFields,
  },
};
