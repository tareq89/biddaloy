import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { CommunicationMedium, DAILY_LIMIT_REACHED } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';
import { TenantSettingsCache } from '../schools/settings/tenant-settings-cache.service';
import { SendLimitService } from './limits/send-limit.service';
import { CommunicationProviderRegistryService } from './providers/communication-provider.registry';

const SCHOOL_B = randomUUID();
const API = '/api/v1';
const SMS = CommunicationMedium.SMS;

/**
 * [Epic 60 #3996] A school over its daily SMS limit stops sending; another school is unaffected.
 * The limit is set through the owners' cockpit route, the counter is the real Redis one. The
 * first three sends are counted straight on the counter so no message leaves the machine.
 */
describe('Daily send limit E2E (#3996)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let owner: string;
  let admin: string;
  let limits: SendLimitService;
  let guardianId: string;
  const http = () => supertest(app.getHttpServer());
  const cache = () => app.get(TenantSettingsCache, { strict: false });
  const platformSms = { sms: { source: 'SCHOOLMANAGERP', metering: 'PLATFORM' } };

  const send = (tenant?: string) => {
    const req = http()
      .post(`${API}/communications/send`)
      .set('Authorization', `Bearer ${admin}`)
      .set('Idempotency-Key', randomUUID());
    return (tenant ? req.set('X-Tenant-ID', tenant) : req).send({
      medium: 'SMS',
      guardian_id: guardianId,
      message_body: 'Hello',
    });
  };

  // The suite truncates tenant data before every test, so fixtures are made inside the test.
  async function makeGuardian() {
    const [student] = await ds.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, 'Limit Student', 'REG-LIMIT-E2E-1', 9001, $1, $2, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [SEED_SECTION_1_ID, SEED_TENANT_ID],
    );
    const [guardian] = await ds.query(
      `INSERT INTO guardians (id, full_name, relationship, phone, preferred_communication, is_primary_contact, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Limit Guardian', 'FATHER', '01712345678', 'SMS', true, $1, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID],
    );
    guardianId = guardian.id;
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      student.id,
      guardianId,
    ]);
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.GREENWEB_API_KEY = 'e2e-platform-key';
    process.env.SMS_PROVIDER = 'greenweb';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    limits = app.get(SendLimitService, { strict: false });
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, 'Limit B', $2, NOW(), NOW())`,
      [SCHOOL_B, `limit-b-${SCHOOL_B.slice(0, 8)}`],
    );
    for (const id of [SEED_TENANT_ID, SCHOOL_B]) {
      await ds.query(
        `UPDATE schools SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('communications', $2::jsonb) WHERE id = $1`,
        [id, JSON.stringify(platformSms)],
      );
      cache().invalidate(id);
    }
    owner = await mintCockpitToken(app, ds);
    admin = (
      await http()
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60000);

  afterAll(async () => {
    delete process.env.GREENWEB_API_KEY;
    delete process.env.SMS_PROVIDER;
    await ds.query(
      `UPDATE schools SET settings = settings - 'communications' WHERE id IN ($1, $2)`,
      [SEED_TENANT_ID, SCHOOL_B],
    );
    cache().invalidate(SEED_TENANT_ID);
    await removeCockpitOwners(ds);
    await app.close();
  });

  it('an owner sets the limit to 3; three sends count, the fourth is refused with the numbers', async () => {
    await http()
      .put(`${API}/platform/schools/${SEED_TENANT_ID}/daily-limits`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ sms: 3 })
      .expect(200);
    await makeGuardian();
    for (let i = 0; i < 3; i++) expect(await limits.tryCount(SEED_TENANT_ID, SMS)).toBe('OK');

    const res = await send(SEED_TENANT_ID).expect(409);
    expect(res.body.details).toEqual({
      code: DAILY_LIMIT_REACHED,
      requested: 1,
      remaining: 0,
      limit: 3,
    });
  });

  it('the registry refuses a send past the limit as REJECTED, with no provider call', async () => {
    const provider = app.get(CommunicationProviderRegistryService).resolve(SMS)!;
    const result = await provider.send(
      { to: '01712345678', body: 'Hello' } as never,
      SEED_TENANT_ID,
    );
    expect(result).toMatchObject({
      success: false,
      outcome: 'REJECTED',
      error: 'Daily limit reached.',
    });
  });

  it("school B is unaffected by school A's used-up limit", async () => {
    const b = await limits.remaining(SCHOOL_B, SMS);
    expect(b.remaining).toBeGreaterThan(0);
    expect(await limits.tryCount(SCHOOL_B, SMS)).toBe('OK');
  });

  it('a missing or invalid X-Tenant-ID is refused, nothing echoed', async () => {
    await makeGuardian();
    await send().expect(401);
    const bad = await send('not-a-uuid-zzz').expect(401);
    expect(JSON.stringify(bad.body)).not.toContain('not-a-uuid-zzz');
  });
});
