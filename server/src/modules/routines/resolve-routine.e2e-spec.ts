import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_USER_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { seedPeriodRoutine } from '../attendance/attendance-periods.fixture';
import { RoutineSlot } from './entities/routine-slot.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';

/**
 * [66.0.02] A holiday scoped to Class 1 empties Class 1's routine and
 * period list for that day, and leaves Class 2's alone.
 */
const API = '/api/v1';
const DAY = '2026-03-04'; // a Wednesday

describe('Routine resolver honours class-scoped holidays (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = res.body.access_token;
  }, 60000);

  afterAll(async () => {
    await ds.query(`UPDATE schools SET settings = $1 WHERE id = $2`, [
      JSON.stringify({ version: 1, attendance: { weeklyOffDays: [] } }),
      SEED_TENANT_ID,
    ]);
    await app.close();
  });

  async function seed() {
    await ds.query(`UPDATE schools SET settings = $1 WHERE id = $2`, [
      JSON.stringify({
        version: 1,
        attendance: { weeklyOffDays: [], periodAttendance: { enabled: true } },
      }),
      SEED_TENANT_ID,
    ]);
    const { slots } = await seedPeriodRoutine(ds, {
      tenantId: SEED_TENANT_ID,
      academicYearId: SEED_ACADEMIC_YEAR_ID,
      sectionId: SEED_SECTION_1_ID,
      date: DAY,
      periods: 1,
      createdBy: SEED_ADMIN_USER_ID,
    });
    // Same routine / period / subject, second class's section.
    const first = slots[0].routineSlot;
    const { id: _id, ...copy } = first;
    await ds.getRepository(RoutineSlot).save({ ...copy, section_id: SEED_SECTION_2_ID });

    const event = await ds.getRepository(CalendarEvent).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      start_date: DAY,
      end_date: DAY,
      name: 'Class 1 study tour',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    await ds.getRepository(CalendarEventClass).save({
      event_id: event.id,
      class_id: SEED_CLASS_1_ID,
      tenant_id: SEED_TENANT_ID,
    });
  }

  const asAdmin = (req: supertest.Test) =>
    req
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN);

  const resolve = (sectionId: string) =>
    asAdmin(
      supertest(app.getHttpServer())
        .get(`${API}/routines/resolve`)
        .query({ section_id: sectionId, from: DAY, to: DAY }),
    );

  const periods = (sectionId: string) =>
    asAdmin(
      supertest(app.getHttpServer())
        .get(`${API}/attendance/sections/${sectionId}/periods`)
        .query({ date: DAY }),
    );

  it('GET /routines/resolve: class-1 section is empty, class-2 section keeps its period', async () => {
    await seed();
    expect((await resolve(SEED_SECTION_1_ID).expect(200)).body).toEqual([]);
    expect((await resolve(SEED_SECTION_2_ID).expect(200)).body).toHaveLength(1);
  });

  it('GET /attendance/sections/:id/periods: no periods offered on the class-only holiday', async () => {
    await seed();
    expect((await periods(SEED_SECTION_1_ID).expect(200)).body).toEqual([]);
    expect((await periods(SEED_SECTION_2_ID).expect(200)).body).toHaveLength(1);
  });

  it('missing X-Tenant-ID is rejected with 401', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/routines/resolve`)
      .query({ section_id: SEED_SECTION_1_ID, from: DAY, to: DAY })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });
});
