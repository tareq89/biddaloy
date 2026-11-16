import { ADMIN_REQUIRED_DOCS, PhotoConsent } from '@biddaloy/shared';
import { LegalAcceptance } from '../../../modules/legal/entities/legal-acceptance.entity';
import { LegalService } from '../../../modules/legal/legal.service';
import { StudentService } from '../../../modules/students/students.service';
import type { DemoSeedContext, DemoSlice } from '../context';
import { orgIds } from './org';
import { studentIds } from './students';

/**
 * [59.2.99] Consent data for the demo school (Epic 59, D25, D29, D33): the demo admin has accepted
 * the current legal documents in every branch, about 95% of students have photo consent GIVEN,
 * a few REFUSED (no photo) and the rest UNKNOWN, and applicants are a mix of GIVEN and REFUSED.
 */

const REFUSED_RATE = 0.01;
const UNKNOWN_RATE = 0.04;
const APPLICANT_REFUSED_RATE = 0.15;
/** The admin accepted a month before the anchor; students' consent was recorded 1 to 60 days before. */
const ADMIN_ACCEPTED_DAYS_AGO = 30;
const CONSENT_MAX_DAYS_AGO = 60;

export const slice: DemoSlice = {
  name: 'legal',
  covers: [LegalAcceptance],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const admin = org.adminUserId;
    const legal = ctx.app.get(LegalService, { strict: false });
    const studentService = ctx.app.get(StudentService, { strict: false });
    let rows = 0;

    // ---- 1. admin: current versions of the required documents, in every branch ---------------
    for (const t of org.tenants) {
      await legal.accept(admin, t.id, ADMIN_REQUIRED_DOCS, null);
      rows += ADMIN_REQUIRED_DOCS.length;
    }
    await ctx.ds.query(
      `UPDATE legal_acceptances SET accepted_at = ($1::date - $2::int)::timestamptz + interval '10 hours'
        WHERE user_id = $3`,
      [ctx.anchor, ADMIN_ACCEPTED_DAYS_AGO, admin],
    );

    // ---- 2. students: pick each one's consent with ctx.rng -----------------------------------
    const given: string[] = [];
    const refused: { id: string; tenantId: string }[] = [];
    const unknown: string[] = [];
    for (const s of studentIds(ctx).students) {
      const roll = ctx.rng.number.float({ min: 0, max: 1 });
      if (roll < REFUSED_RATE) refused.push({ id: s.id, tenantId: s.tenantId });
      else if (roll < REFUSED_RATE + UNKNOWN_RATE) unknown.push(s.id);
      else given.push(s.id);
    }
    // A tiny scale still shows one REFUSED student.
    if (refused.length === 0 && given.length > 0) {
      const id = given.pop()!;
      refused.push({ id, tenantId: studentIds(ctx).students.find((s) => s.id === id)!.tenantId });
    }
    for (let i = 0; i < given.length; i += 2000) {
      const ids = given.slice(i, i + 2000);
      const daysAgo = ids.map(() => ctx.rng.number.int({ min: 1, max: CONSENT_MAX_DAYS_AGO }));
      await ctx.ds.query(
        `UPDATE students st SET photo_consent = 'GIVEN',
                photo_consent_recorded_at = ($3::date - u.d)::timestamptz + interval '10 hours',
                photo_consent_recorded_by = $4
           FROM unnest($1::uuid[], $2::int[]) AS u(id, d) WHERE st.id = u.id`,
        [ids, daysAgo, ctx.anchor, admin],
      );
    }
    rows += given.length;
    // REFUSED goes through the real service: it clears the photo key and writes the audit row.
    for (const r of refused) {
      await studentService.update(r.id, { photo_consent: PhotoConsent.REFUSED }, r.tenantId, admin);
      await ctx.ds.query(
        `UPDATE students SET photo_consent_recorded_at = ($2::date - $3::int)::timestamptz + interval '10 hours'
          WHERE id = $1`,
        [r.id, ctx.anchor, ctx.rng.number.int({ min: 1, max: CONSENT_MAX_DAYS_AGO })],
      );
    }
    rows += refused.length + unknown.length; // UNKNOWN is the column default: nothing to write

    // ---- 3. applicants: a mix of GIVEN and REFUSED (their documents hold no photo in the demo) -
    const applicants: { id: string }[] = await ctx.ds.query(
      `SELECT id FROM admission_applicants ORDER BY id`,
    );
    const applicantRefused = applicants.filter(
      (_, i) => i === 0 || ctx.rng.number.float({ min: 0, max: 1 }) < APPLICANT_REFUSED_RATE,
    );
    const refusedIds = new Set(applicantRefused.map((a) => a.id));
    await ctx.ds.query(
      `UPDATE admission_applicants
          SET photo_consent = CASE WHEN id = ANY($1::uuid[]) THEN 'REFUSED' ELSE 'GIVEN' END::photo_consent_enum`,
      [[...refusedIds]],
    );
    rows += applicants.length;
    return rows;
  },
};
