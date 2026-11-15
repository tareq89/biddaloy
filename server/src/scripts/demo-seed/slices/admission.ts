import {
  ADMISSION_TEMPLATES,
  AdmissionApplicantStatus,
  AdmissionDocumentType,
  AdmissionFeeState,
  AdmissionListKind,
  AdmissionPayMethod,
  AdmissionStageKind,
  AdmissionTemplateKey,
} from '@biddaloy/shared';
import { AdmissionIntake } from '../../../modules/admission/entities/admission-intake.entity';
import { AdmissionApplicant } from '../../../modules/admission/entities/admission-applicant.entity';
import { AdmissionEvaluation } from '../../../modules/admission/entities/admission-evaluation.entity';
import { AdmissionStage } from '../../../modules/admission/entities/admission-stage.entity';
import { AdmissionStageResult } from '../../../modules/admission/entities/admission-stage-result.entity';
import { AdmissionList } from '../../../modules/admission/entities/admission-list.entity';
import { AdmissionListMember } from '../../../modules/admission/entities/admission-list-member.entity';
import { AdmissionFeeProof } from '../../../modules/admission/entities/admission-fee-proof.entity';
import { ADMISSION_NOTES } from '../../seed-data/demo-bn/texts';
import { NAME_POOLS } from '../../seed-data/demo-bn/names';
import { DHAKA_AREAS } from '../../seed-data/demo-bn/places';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { orgIds } from './org';

/**
 * [Epic 71 W1 close] Admission: one open round per template (six), each with the template's
 * stages, applicants in the first four statuses (pending, shortlisted, admitted, rejected), stage results, a merit list and fee proofs.
 * The first round (APPLY_ONLY) is the old people-ops intake, moved here with its three tables.
 * Bulk-inserted (D38); applicants skip the public controller, so no captcha is involved.
 */

const DAY = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
const bnNum = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const APPLICANTS = 120; // for the APPLY_ONLY round, split over the branches
const ROUND_APPLICANTS = 6; // for each of the other five rounds, per branch
/** Class grade of the round per branch kind, and the age of a child applying to it. */
const INTAKE_GRADE = { PRIMARY: 1, HIGH: 6, COLLEGE: 11 } as const;
const APPLICANT_AGE = { PRIMARY: 6, HIGH: 11, COLLEGE: 16 } as const;
const STATUS_WEIGHTS = [
  [AdmissionApplicantStatus.PENDING, 45],
  [AdmissionApplicantStatus.SHORTLISTED, 25],
  [AdmissionApplicantStatus.ADMITTED, 15],
  [AdmissionApplicantStatus.REJECTED, 15],
] as const;
const DECISION = {
  [AdmissionApplicantStatus.SHORTLISTED]: 'SHORTLIST',
  [AdmissionApplicantStatus.ADMITTED]: 'ADMIT',
  [AdmissionApplicantStatus.REJECTED]: 'REJECT',
} as const;
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // as the public form generates
const TITLES: Record<AdmissionTemplateKey, string> = {
  APPLY_ONLY: 'আবেদন',
  WRITTEN: 'লিখিত পরীক্ষা',
  WRITTEN_VIVA: 'লিখিত ও মৌখিক পরীক্ষা',
  LOTTERY: 'লটারি',
  FIRST_COME: 'আগে এলে আগে',
  GPA_MERIT: 'জিপিএ মেধা',
};
const SCORED = new Set<AdmissionStageKind>([
  AdmissionStageKind.WRITTEN,
  AdmissionStageKind.VIVA,
  AdmissionStageKind.GPA,
]);

export const slice: DemoSlice = {
  name: 'admission',
  covers: [
    AdmissionIntake,
    AdmissionApplicant,
    AdmissionEvaluation,
    AdmissionStage,
    AdmissionStageResult,
    AdmissionList,
    AdmissionListMember,
    AdmissionFeeProof,
  ],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const uuid = () => ctx.rng.string.uuid();
    const repo = (e: Function) => ctx.ds.getRepository(e as never);
    const admin = org.adminUserId;
    const stamp = (date: string, hh: number) =>
      `${date}T${String(hh).padStart(2, '0')}:00:00+06:00`;
    const nextYear = String(Number(ctx.anchor.slice(0, 4)) + 1);
    const references = new Set<string>();

    const intakes: Record<string, unknown>[] = [];
    const applicants: Record<string, unknown>[] = [];
    const evaluations: Record<string, unknown>[] = [];
    const stages: Record<string, unknown>[] = [];
    const results: Record<string, unknown>[] = [];
    const lists: Record<string, unknown>[] = [];
    const members: Record<string, unknown>[] = [];
    const proofs: Record<string, unknown>[] = [];

    for (const t of org.tenants) {
      const cur = t.years[t.years.length - 1];
      const klass = cur.classes.find((c) => c.numericGrade === INTAKE_GRADE[t.kind]);
      if (!klass)
        throw new Error(
          `demo-seed admission: no grade ${INTAKE_GRADE[t.kind]} class for ${t.kind}`,
        );
      const age = APPLICANT_AGE[t.kind];
      const seenChild = new Set<string>();

      for (const key of Object.values(AdmissionTemplateKey)) {
        const template = ADMISSION_TEMPLATES[key];
        const legacy = key === AdmissionTemplateKey.APPLY_ONLY;
        const withFee = key === AdmissionTemplateKey.WRITTEN;
        const intakeId = uuid();
        intakes.push({
          id: intakeId,
          tenant_id: t.id,
          // Old-style rounds name their section; pipeline rounds let "admit" pick one.
          class_section_id: legacy ? klass.sections[0].id : null,
          class_id: klass.id,
          academic_year_id: cur.id,
          template_key: key,
          title: `ভর্তি ${bnNum(Number(nextYear))}: ${klass.name} (${TITLES[key]})`,
          seat_count: 40,
          open_date: addDays(ctx.anchor, -30),
          close_date: addDays(ctx.anchor, 30),
          required_document_types: [
            AdmissionDocumentType.PHOTO,
            AdmissionDocumentType.BIRTH_CERTIFICATE,
          ],
          form_fields: template.fields,
          fee_amount_paisa: withFee ? 50_000 : null,
          fee_pay_methods: withFee ? [AdmissionPayMethod.BKASH, AdmissionPayMethod.BANK] : [],
        });
        const stageRows = template.stages.map((s, i) => {
          const row = {
            id: uuid(),
            tenant_id: t.id,
            intake_id: intakeId,
            position: i + 1,
            kind: s.kind,
            title: null,
            config: SCORED.has(s.kind) ? { full_marks: 100, pass_mark: 40 } : {},
          };
          stages.push(row);
          return row;
        });

        const count = legacy
          ? Math.max(8, Math.round(ctx.count(APPLICANTS) / org.tenants.length))
          : ROUND_APPLICANTS;
        const roundApplicants: { id: string; passed: boolean }[] = [];
        const makeApplicant = (
          i: number,
          twinOf?: { phone: string; dob: string; surname: string },
        ) => {
          const group = ctx.weighted([
            ['MUSLIM', 92],
            ['HINDU', 8],
          ] as const);
          const pool = NAME_POOLS[group];
          const gender = ctx.pick(['MALE', 'FEMALE'] as const);
          const given = ctx.pick(gender === 'MALE' ? pool.boys : pool.girls);
          const surname = twinOf ? { en: twinOf.surname } : ctx.pick(pool.surnames);
          const phone = twinOf?.phone ?? ctx.nextPhone();
          const dob =
            twinOf?.dob ??
            addDays(ctx.anchor, -(age * 365 + ctx.rng.number.int({ min: 0, max: 364 })));
          const name = `${given.en} ${surname.en}`;
          if (seenChild.has(`${intakeId}|${phone}|${dob}|${name}`)) return null;
          seenChild.add(`${intakeId}|${phone}|${dob}|${name}`);
          let reference: string;
          do {
            reference = `ADM-${ctx.anchor.slice(0, 4)}-${ctx.rng.string.fromCharacters(REFERENCE_ALPHABET, 6)}`;
          } while (references.has(reference));
          references.add(reference);
          // The first four cover every status, so a tiny scale still shows them all.
          const status =
            i < STATUS_WEIGHTS.length ? STATUS_WEIGHTS[i][0] : ctx.weighted(STATUS_WEIGHTS);
          const id = uuid();
          const feeState = !withFee
            ? AdmissionFeeState.NONE
            : ctx.weighted([
                [AdmissionFeeState.CONFIRMED, 60],
                [AdmissionFeeState.AWAITING, 30],
                [AdmissionFeeState.SENT_BACK, 10],
              ] as const);
          applicants.push({
            id,
            tenant_id: t.id,
            intake_id: intakeId,
            reference_number: reference,
            applicant_name: name,
            date_of_birth: dob,
            gender,
            guardian_name: `${ctx.pick(pool.boys).en} ${surname.en}`,
            guardian_phone: phone,
            guardian_email: null,
            home_address: `${ctx.pick(DHAKA_AREAS).bn}, ঢাকা`,
            documents: [],
            status,
            fee_state: feeState,
          });
          if (status !== AdmissionApplicantStatus.PENDING) {
            evaluations.push({
              tenant_id: t.id,
              applicant_id: id,
              reviewer_user_id: admin,
              notes: ctx.pick(ADMISSION_NOTES),
              decision: DECISION[status],
            });
          }
          if (feeState !== AdmissionFeeState.NONE) {
            const done = feeState === AdmissionFeeState.CONFIRMED;
            proofs.push({
              tenant_id: t.id,
              applicant_id: id,
              // A made-up key: the demo has no uploaded file behind it.
              attachment_key: `demo/admission/${id}.jpg`,
              method: ctx.pick([AdmissionPayMethod.BKASH, AdmissionPayMethod.BANK] as const),
              reference: `TX${ctx.rng.string.fromCharacters(REFERENCE_ALPHABET, 8)}`,
              state: feeState,
              verified_by_user_id: done || feeState === AdmissionFeeState.SENT_BACK ? admin : null,
              reason: feeState === AdmissionFeeState.SENT_BACK ? 'রেফারেন্স নম্বর মেলেনি।' : null,
            });
          }
          let passed = true;
          for (const st of stageRows) {
            if (st.kind === AdmissionStageKind.NONE) continue;
            const scored = SCORED.has(st.kind as AdmissionStageKind);
            const score = scored ? ctx.rng.number.int({ min: 20, max: 98 }) : null;
            const ok = score === null ? true : score >= 40;
            passed &&= ok;
            results.push({
              tenant_id: t.id,
              stage_id: st.id,
              applicant_id: id,
              score,
              passed: ok,
              remarks: null,
            });
          }
          roundApplicants.push({ id, passed });
          return { phone, dob, surname: surname.en };
        };
        // Twins under one guardian phone (Epic 68 LIFE-10: one application per child).
        const first = makeApplicant(0);
        if (first) makeApplicant(1, first);
        for (let i = 2; i < count; i++) makeApplicant(i);

        // A published merit list of those who passed every stage (pipeline rounds only).
        const ranked = roundApplicants.filter((a) => a.passed);
        if (!legacy && ranked.length > 0) {
          const listId = uuid();
          lists.push({
            id: listId,
            tenant_id: t.id,
            intake_id: intakeId,
            kind: AdmissionListKind.MERIT,
            sequence: 1,
            order_by: template.stages[template.stages.length - 1].order,
            active: true,
            published_at: stamp(addDays(ctx.anchor, -2), 10),
            capacity: Math.min(ranked.length, 40),
            act_by_date: addDays(ctx.anchor, 3),
            activated_at: stamp(addDays(ctx.anchor, -2), 10),
            filter: {},
          });
          ranked.forEach((a, i) =>
            members.push({
              tenant_id: t.id,
              list_id: listId,
              applicant_id: a.id,
              position: i + 1,
            }),
          );
        }
      }
    }

    let rows = 0;
    rows += await insertChunked(repo(AdmissionIntake) as never, intakes as never);
    rows += await insertChunked(repo(AdmissionStage) as never, stages as never);
    rows += await insertChunked(repo(AdmissionApplicant) as never, applicants as never);
    rows += await insertChunked(repo(AdmissionEvaluation) as never, evaluations as never);
    rows += await insertChunked(repo(AdmissionStageResult) as never, results as never);
    rows += await insertChunked(repo(AdmissionList) as never, lists as never);
    rows += await insertChunked(repo(AdmissionListMember) as never, members as never);
    rows += await insertChunked(repo(AdmissionFeeProof) as never, proofs as never);
    return rows;
  },
};
