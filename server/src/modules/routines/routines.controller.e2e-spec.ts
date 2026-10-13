import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * Regression for a routing bug: `RoutineSlotsController`'s `@Get(':id')`
 * is a catch-all under `routines/`. When it was registered before
 * `ResolveRoutineController`/`SubstitutionsController` in
 * `routines.module.ts`, Nest matched `/routines/resolve` and
 * `/routines/substitutions` against `:id` first, so the real handlers
 * never ran — the guard chain rejected both with 401 instead of the
 * expected 200. These two routes never got an HTTP-level e2e test
 * before, only mocked-response unit/integration tests, so nothing
 * caught it.
 */
const API = '/api/v1';

describe('Routines routing (routes/:id must not shadow literal routes)', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = res.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // --- TIME-08: published-routine slot guard ---
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86400000));

  /** A DRAFT routine with its references; tests publish it with `publish()` once slots exist. */
  async function seedPublished() {
    const ds = app.get(DataSource);
    const q = (sql: string, params: unknown[]) => ds.query(sql, params);
    const sfx = Math.random().toString(36).slice(2, 8);
    // Reuse the seeded year when it spans the test window (the resolver
    // picks the year covering `from`; two overlapping years are ambiguous).
    const [seedYear] = await q(
      `SELECT id FROM academic_years WHERE tenant_id = $1 AND deleted_at IS NULL
         AND start_date <= $2 AND end_date >= $3 LIMIT 1`,
      [SEED_TENANT_ID, daysFromNow(-60), daysFromNow(8)],
    );
    const [year] = seedYear
      ? [seedYear]
      : await q(
          `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current)
           VALUES ($1, $2, $3, $4, false) RETURNING id`,
          [SEED_TENANT_ID, `guard-${sfx}`, daysFromNow(-90), daysFromNow(90)],
        );
    await q(`DELETE FROM routines WHERE tenant_id = $1 AND academic_year_id = $2`, [
      SEED_TENANT_ID,
      year.id,
    ]);
    const [shift] = await q(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, $2, '08:00', '14:00', 0) RETURNING id`,
      [SEED_TENANT_ID, `guard-${sfx}`],
    );
    const [period] = await q(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 0, $3, '08:00', '08:40') RETURNING id`,
      [SEED_TENANT_ID, shift.id, PeriodSlotKind.CLASS],
    );
    const [subject] = await q(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, $2, $3) RETURNING id`,
      [SEED_TENANT_ID, `Guard ${sfx}`, `G-${sfx}`],
    );
    const [routine] = await q(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [SEED_TENANT_ID, year.id, `guard-${sfx}`, RoutineState.DRAFT],
    );
    const user = await ds
      .getRepository(User)
      .save({ full_name: `Guard ${sfx}`, email: `guard-${sfx}@test.local` });
    const teacher = await ds
      .getRepository(Teacher)
      .save({ tenant_id: SEED_TENANT_ID, user_id: user.id, employee_id: `G-${sfx}` });
    return {
      routineId: routine.id,
      periodId: period.id,
      subjectId: subject.id,
      teacherId: teacher.id,
    };
  }

  function slotBody(
    p: { periodId: string; subjectId: string; teacherId: string },
    validFrom: string,
  ) {
    return {
      section_id: SEED_SECTION_1_ID,
      period_slot_id: p.periodId,
      weekday: new Date(`${validFrom}T00:00:00Z`).getUTCDay(),
      subject_id: p.subjectId,
      room_id: null,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: validFrom,
      valid_to: null,
      teacher_ids: [p.teacherId],
    };
  }

  /** Slots are written while DRAFT (a published routine refuses back-dated new slots), then published. */
  const publish = (routineId: string) =>
    app
      .get(DataSource)
      .query(`UPDATE routines SET state = $1, published_at = now() WHERE id = $2`, [
        RoutineState.PUBLISHED,
        routineId,
      ]);

  const auth = (r: supertest.Test) =>
    r.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', SEED_TENANT_ID);

  it('DELETE a published slot keeps it on past dates, not from today on', async () => {
    const p = await seedPublished();
    // A Tuesday three-plus weeks back and the next Tuesday ahead: the slot
    // is weekly, so only the end-dating decides which of the two resolves.
    const dow = new Date().getUTCDay();
    const past = daysFromNow(-22 - ((dow - 2 + 7) % 7));
    const next = daysFromNow((2 - dow + 7) % 7 || 7);
    const created = await auth(
      supertest(app.getHttpServer()).post(`${API}/routines/${p.routineId}/slots`),
    )
      .send(slotBody(p, past))
      .expect(201);
    const slotId = created.body.slot.id;
    await publish(p.routineId);

    await auth(supertest(app.getHttpServer()).delete(`${API}/routines/slots/${slotId}`)).expect(
      200,
    );

    const resolve = (d: string) =>
      auth(supertest(app.getHttpServer()).get(`${API}/routines/resolve`)).query({
        section_id: SEED_SECTION_1_ID,
        from: d,
        to: d,
      });
    expect((await resolve(past)).body).toHaveLength(1);
    expect((await resolve(next)).body).toHaveLength(0);
  });

  it('PATCH with a past valid_from on a published routine -> 422', async () => {
    const p = await seedPublished();
    const created = await auth(
      supertest(app.getHttpServer()).post(`${API}/routines/${p.routineId}/slots`),
    )
      .send(slotBody(p, daysFromNow(-60)))
      .expect(201);
    await publish(p.routineId);
    const res = await auth(
      supertest(app.getHttpServer()).patch(`${API}/routines/slots/${created.body.slot.id}`),
    ).send(slotBody(p, daysFromNow(-7)));
    expect(res.status).toBe(422);
    expect(res.body.details?.code ?? res.body.message?.details?.code).toBe(
      'ROUTINE_SLOT_BACKDATED',
    );
  });

  it('POST a slot with a past valid_from on a published routine -> 422', async () => {
    const p = await seedPublished();
    await publish(p.routineId);
    const res = await auth(
      supertest(app.getHttpServer()).post(`${API}/routines/${p.routineId}/slots`),
    ).send(slotBody(p, daysFromNow(-7)));
    expect(res.status).toBe(422);
    expect(res.body.details?.code ?? res.body.message?.details?.code).toBe(
      'ROUTINE_SLOT_BACKDATED',
    );
  });

  it('GET /routines/resolve is not swallowed by /routines/:id', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/routines/resolve`)
      .query({ section_id: SEED_SECTION_1_ID, from: '2026-01-01', to: '2026-01-07' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /routines/substitutions is not swallowed by /routines/:id', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/routines/substitutions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
