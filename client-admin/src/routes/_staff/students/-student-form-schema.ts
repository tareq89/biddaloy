/**
 * `z.infer` here is deliberately checked against the generated
 * `CreateStudentInput`/`UpdateStudentInput` types (`components['schemas']`
 * in `@biddaloy/ui/hooks`, generated from `server/openapi.json`) via
 * `buildCreatePayload`/`buildUpdatePayload`'s own return-type annotations
 * below — per this ticket's own AC ("Zod schemas derive from the generated
 * API types"). A field renamed or removed server-side breaks these
 * functions at compile time rather than silently drifting, the same
 * "generated types are the source of truth" guarantee `check:api-types`
 * enforces for the rest of the app.
 *
 * No `email`/`phone` fields here even though `CreateStudentDto`/
 * `UpdateStudentDto` both declare them: `Student` (`server/src/modules/
 * students/entities/student.entity.ts`) has no matching columns, and
 * `StudentService.create`/`update` never read `dto.email`/`dto.phone` —
 * contact info lives on `Guardian` instead (`students.ts`'s own hook
 * comment already documents this for `phone`). Building inputs for fields
 * the server silently drops would be a real data-loss bug, not a
 * simplification.
 *
 * All remaining fields stay plain strings end to end (same "parse once on
 * submit" reasoning `EmailSection.tsx`/`zod-helpers.ts` already use) —
 * `roll_number` as a numeric string, `date_of_birth`/`classId` handled by
 * their own widgets' native value types (`Date | undefined`, `string`).
 */
import type { CreateStudentInput, Student, UpdateStudentInput } from '@biddaloy/ui/hooks';
import { z } from 'zod';

export const PREFERRED_COMMUNICATION_VALUES = [
  'SMS',
  'WHATSAPP',
  'EMAIL',
  'PHONE_CALL',
  'MESSENGER',
] as const;

export interface StudentFormMessages {
  fullNameRequired: string;
  classSectionRequired: string;
  rollNumberInvalid: string;
}

/** Every field name this schema can produce a `ZodIssue` for — the
 * allowlist `parseValidationFieldErrors` needs to map a server-side
 * `ValidationPipe` message back onto the right input. Kept next to the
 * schema itself so the two can't drift apart. */
export const STUDENT_FORM_SERVER_FIELDS = [
  'full_name',
  'class_section_id',
  'roll_number',
  'date_of_birth',
  'gender',
  'home_address',
  'preferred_communication',
] as const;

export function buildStudentFormSchema(messages: StudentFormMessages) {
  return z.object({
    full_name: z.string().trim().min(1, messages.fullNameRequired),
    classId: z.string(),
    class_section_id: z.string().min(1, messages.classSectionRequired),
    // `[1-9]\d*` — not `\d+` — since `"0"` isn't a positive whole number,
    // the rule both locale messages already state.
    roll_number: z
      .string()
      .trim()
      .refine((value) => value === '' || /^[1-9]\d*$/.test(value), {
        message: messages.rollNumberInvalid,
      }),
    date_of_birth: z.date().optional(),
    gender: z.string().trim(),
    home_address: z.string().trim(),
    preferred_communication: z.enum(PREFERRED_COMMUNICATION_VALUES),
    guardian_ids: z.array(z.string()),
  });
}

export type StudentFormSchema = ReturnType<typeof buildStudentFormSchema>;
export type StudentFormValues = z.infer<StudentFormSchema>;

export function defaultStudentFormValues(): StudentFormValues {
  return {
    full_name: '',
    classId: '',
    class_section_id: '',
    roll_number: '',
    date_of_birth: undefined,
    gender: '',
    home_address: '',
    preferred_communication: 'SMS',
    guardian_ids: [],
  };
}

/** Edit mode's prefill — the inverse of `buildUpdatePayload`, run once to
 * seed `useForm`'s `defaultValues`. `date_of_birth` round-trips through a
 * `Date` (the widget's own value type), not the ISO string the API
 * returns it as. */
export function studentToFormValues(student: Student): StudentFormValues {
  return {
    full_name: student.full_name,
    classId: student.class_section.class_id,
    class_section_id: student.class_section_id,
    roll_number: String(student.roll_number),
    date_of_birth: student.date_of_birth ? new Date(student.date_of_birth) : undefined,
    gender: student.gender ?? '',
    home_address: student.home_address ?? '',
    preferred_communication: student.preferred_communication,
    guardian_ids: student.guardians.map((guardian) => guardian.id),
  };
}

function toOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `date.toISOString().slice(0, 10)` converts to UTC first — `DatePicker`
 * hands back a local-midnight `Date`, so in any timezone ahead of UTC
 * (Bangladesh, this app's only region, is UTC+6) that conversion rolls
 * the date back a day: local midnight Jan 15 is 18:00 UTC Jan 14. Reading
 * the local year/month/day components instead serializes the calendar
 * date the user actually picked. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shared by both create and update — `UpdateStudentInput` is a subset of
 * `CreateStudentInput` (every field optional, no extras), so building the
 * full payload and letting the caller narrow it via the return-type
 * annotation is simpler than two separate builders that would drift out
 * of sync field-by-field. */
function toStudentPayload(values: StudentFormValues): CreateStudentInput {
  const rollNumber = values.roll_number.trim() === '' ? undefined : Number(values.roll_number);
  const gender = toOptional(values.gender);
  const homeAddress = toOptional(values.home_address);
  return {
    full_name: values.full_name.trim(),
    class_section_id: values.class_section_id,
    // `exactOptionalPropertyTypes` — an optional field must be *omitted*,
    // not set to `undefined`, so each one is conditionally spread rather
    // than assigned directly (same pattern `EmailSection.tsx`'s
    // `buildConfig` already uses for its own optional `password`).
    ...(rollNumber !== undefined ? { roll_number: rollNumber } : {}),
    ...(values.date_of_birth ? { date_of_birth: toLocalDateString(values.date_of_birth) } : {}),
    ...(gender !== undefined ? { gender } : {}),
    ...(homeAddress !== undefined ? { home_address: homeAddress } : {}),
    preferred_communication: values.preferred_communication,
    guardian_ids: values.guardian_ids,
  };
}

export function buildCreatePayload(values: StudentFormValues): CreateStudentInput {
  return toStudentPayload(values);
}

export function buildUpdatePayload(values: StudentFormValues): UpdateStudentInput {
  return toStudentPayload(values);
}
