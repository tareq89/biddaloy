import {
  activateInvite,
  applyPreset,
  createClassSection,
  currentAcademicYear,
  platformApiSession,
  post,
  provisionSchool,
  resendSchoolAdminInvitation,
  setSiteCustomDomain,
} from '../api';
import type { ApiSession } from '../api';
import { shells } from '../config';
import { expect, test } from '../fixtures/test';

/**
 * [71.3 #4193] Public admission on a school's website, on both kinds of host: the school's own
 * `<school>.<root>` host and a custom domain. A guardian applies to a fee round with a fee proof,
 * then looks the application up by reference number and phone.
 *
 * Read through the API (`/public/site/by-host/<host>/admission/*`), like `website-results.spec.ts`,
 * because the e2e stack does not run the site container; the pages are covered by `site/` tests.
 * Own school, so publishing a site here never touches the shared school's website. The custom
 * domain is written to the row (Cloudflare for SaaS is not in the e2e stack).
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const ROOT = 'sites.e2e.test';
// Magic bytes of a JPEG: the server checks the signature, not the mimetype the client sends.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

test('guardian applies with a fee proof on a school host and a custom domain, then looks up the status', async ({
  playwright,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const setup = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const superAdmin = await platformApiSession(setup);
    const provisioned = await provisionSchool(
      setup,
      superAdmin,
      `E2E Admission Site ${suffix}`,
      `e2e-admission-site-${suffix}`,
      'Admission Admin',
      `admission-site-${suffix}@e2e.example.com`,
    );
    const token = await resendSchoolAdminInvitation(
      setup,
      superAdmin,
      provisioned.schoolId,
      provisioned.adminUserId,
    );
    const activated = await activateInvite(setup, token, 'A-strong-admission-pw-1');
    const session: ApiSession = { token: activated.token, tenantId: activated.tenantId };
    const headers = { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId };

    await applyPreset(setup, session, {
      presetId: 'bd/nctb',
      startYear: new Date().getFullYear(),
      stages: ['PRIMARY'],
      versions: ['bangla'],
    });
    const year = await currentAcademicYear(setup, session);
    const chain = await createClassSection(setup, session, year);

    // A fee round, open today.
    const round = await post<{ id: string }>(setup, session, '/admission-intakes', {
      title: `E2E Site Round ${suffix}`,
      class_section_id: chain.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: [],
      fee_amount_paisa: 50000,
      fee_pay_methods: ['BKASH'],
    });

    // Website on.
    const read = async () => {
      const r = await setup.get('/api/v1/website', { headers });
      expect(r.ok(), `GET /website: ${r.status()}`).toBe(true);
      return (await r.json()) as { subdomain: string; version: number; draft_revision: number };
    };
    let site = await read();
    const published = await setup.post('/api/v1/website/publish', {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { version: site.version, draft_revision: site.draft_revision },
    });
    expect(published.ok(), `publish: ${published.status()}`).toBe(true);
    const on = await setup.post('/api/v1/website/enabled', { headers, data: { enabled: true } });
    expect(on.ok(), `enable: ${on.status()}`).toBe(true);
    site = await read();

    await setSiteCustomDomain(provisioned.schoolId, `admissions-${suffix}.e2e-custom.test`);

    const hosts = {
      'school host': `${site.subdomain}.${ROOT}`,
      'custom domain': `admissions-${suffix}.e2e-custom.test`,
    };
    for (const [label, host] of Object.entries(hosts)) {
      await test.step(`${label}: apply with a fee proof, then look up the status`, async () => {
        const base = `/api/v1/public/site/by-host/${host}/admission`;
        const phone = `01${3 + (Date.now() % 7)}${Date.now().toString().slice(-8)}`;

        const rounds = await setup.get(`${base}/rounds`);
        expect(rounds.ok(), `rounds: ${rounds.status()}`).toBe(true);
        expect(JSON.stringify(await rounds.json())).toContain(round.id);

        const applied = await setup.post(`${base}/applicants`, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          multipart: {
            intake_id: round.id,
            applicant_name: `E2E Applicant ${label} ${suffix}`,
            date_of_birth: '2018-05-01',
            gender: 'MALE',
            guardian_name: 'E2E Guardian',
            guardian_phone: phone,
            extra_fields: JSON.stringify({ father_name: 'E2E Father', mother_name: 'E2E Mother' }),
            captcha_token: 'no-captcha',
            photo_consent: 'GIVEN',
            fee_method: 'BKASH',
            fee_reference: `TX-${suffix}`,
            fee_proof: { name: 'proof.jpg', mimeType: 'image/jpeg', buffer: JPEG },
          },
        });
        expect(applied.status(), await applied.text()).toBe(201);
        const body = (await applied.json()) as { reference_number: string; status: string };
        expect(body.reference_number).toMatch(/^ADM-/);
        expect(body.status).toBe('FEE_PENDING');

        const status = await setup.post(`${base}/status`, {
          data: { reference_number: body.reference_number, guardian_phone: phone },
        });
        expect(status.ok(), `status: ${status.status()}`).toBe(true);
        expect(JSON.stringify(await status.json())).toContain('FEE_PENDING');
      });
    }
  } finally {
    await setup.dispose();
  }
});
