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
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { User } from '../users/entities/user.entity';
import { randomUUID } from 'crypto';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../schools/dto/tenant-settings.dto';
import { DEFAULT_ATTENDANCE_SETTINGS } from '../schools/settings/tenant-settings-defaults';

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

  describe('roles on /routines/resolve (pinned, unchanged behaviour)', () => {
    // The seeded admin user also acts as each role through X-Role.
    const OTHER_TENANT = '00000000-0000-4000-8000-0000000066e2';
    const actAs = async (role: UserRole, tenantId = SEED_TENANT_ID) => {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, tenantId, role],
      );
      // Log in again so the token carries the membership just added.
      const login = await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return supertest(app.getHttpServer())
        .get(`${API}/routines/resolve`)
        .query({ section_id: SEED_SECTION_2_ID, from: DAY, to: DAY })
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-Role', role);
    };

    for (const role of [
      UserRole.ADMIN,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      it(`${role} gets 200`, async () => {
        await actAs(role).then((res) => expect(res.status).toBe(200));
      });
    }

    it('COMMITTEE gets 403', async () => {
      await actAs(UserRole.COMMITTEE).then((res) => expect(res.status).toBe(403));
    });

    it('tenant-2 admin asking for a tenant-1 section sees nothing of tenant 1', async () => {
      await seed();
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'E2E Other', 'e2e-other-66', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT],
      );
      const res = await actAs(UserRole.ADMIN, OTHER_TENANT);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /routines/substitutions availability [TEN-07]', () => {
    const newTeacher = async (tenantId: string) => {
      const user = await ds
        .getRepository(User)
        .save({ full_name: 'Cover', email: `cover-${randomUUID()}@t.local` });
      return ds
        .getRepository(Teacher)
        .save({ tenant_id: tenantId, user_id: user.id, employee_id: `C-${randomUUID()}` });
    };
    const post = (body: object) =>
      asAdmin(supertest(app.getHttpServer()).post(`${API}/routines/substitutions`)).send(body);

    it('a busy substitute -> 409 details.code TEACHER_BUSY', async () => {
      await seed();
      const own = await newTeacher(SEED_TENANT_ID);
      const busy = await newTeacher(SEED_TENANT_ID);
      const slots = await ds
        .getRepository(RoutineSlot)
        .find({ where: { tenant_id: SEED_TENANT_ID } });
      // Section 1's slot is the one we cover; the same period in section 2 is where `busy` teaches.
      const target = slots.find((x) => x.section_id === SEED_SECTION_1_ID)!;
      const other = slots.find((x) => x.section_id === SEED_SECTION_2_ID)!;
      const link = ds.getRepository(RoutineSlotTeacher);
      await link.save({
        tenant_id: SEED_TENANT_ID,
        routine_slot_id: target.id,
        teacher_id: own.id,
      });
      await link.save({
        tenant_id: SEED_TENANT_ID,
        routine_slot_id: other.id,
        teacher_id: busy.id,
      });
      const res = await post({
        routine_slot_id: target.id,
        date: DAY,
        substitute_teacher_id: busy.id,
      }).expect(409);
      expect(res.body.details?.code ?? res.body.message?.details?.code).toBe('TEACHER_BUSY');
    });

    it('a teacher id from another tenant -> 404 (unchanged)', async () => {
      await seed();
      const slot = (
        await ds.getRepository(RoutineSlot).find({ where: { tenant_id: SEED_TENANT_ID } })
      )[0];
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'E2E Other', 'e2e-other-66b', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        ['00000000-0000-4000-8000-0000000066e3'],
      );
      const foreign = await newTeacher('00000000-0000-4000-8000-0000000066e3');
      await post({
        routine_slot_id: slot.id,
        date: DAY,
        substitute_teacher_id: foreign.id,
      }).expect(404);
    });
  });

  describe('special timings (SENSE-09)', () => {
    const special = {
      name: 'Ramadan',
      from: DAY,
      to: DAY,
      shiftId: null,
      lateAfter: '08:45',
      absentAfter: '09:30',
      periods: [{ sequence: 1, startsAt: '08:30', endsAt: '09:05' }],
    };
    const saveSettings = (specialTimings: unknown[]) =>
      supertest(app.getHttpServer())
        .patch(`${API}/schools/${SEED_TENANT_ID}/settings`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          version: TENANT_SETTINGS_SCHEMA_VERSION,
          attendance: {
            ...DEFAULT_ATTENDANCE_SETTINGS,
            weeklyOffDays: [],
            periodAttendance: { enabled: true },
            specialTimings,
          },
        });

    it('a saved special timing changes the resolved times for dates inside it only', async () => {
      await seed();
      await saveSettings([special]).expect(200);
      const inside = (await resolve(SEED_SECTION_2_ID).expect(200)).body;
      expect(inside[0]).toMatchObject({ starts_at: '08:30:00', ends_at: '09:05:00' });

      await saveSettings([{ ...special, from: '2026-03-10', to: '2026-03-11' }]).expect(200);
      const outside = (await resolve(SEED_SECTION_2_ID).expect(200)).body;
      expect(outside[0]).toMatchObject({ starts_at: '08:00:00', ends_at: '08:45:00' });
    });

    it('overlapping all-shift entries are rejected with 400', async () => {
      await saveSettings([special, { ...special, name: 'Again' }]).expect(400);
    });

    it('a PARENT reading /routines/resolve sees the same special times', async () => {
      await seed();
      await saveSettings([special]).expect(200);
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, UserRole.PARENT],
      );
      const login = await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const res = await supertest(app.getHttpServer())
        .get(`${API}/routines/resolve`)
        .query({ section_id: SEED_SECTION_2_ID, from: DAY, to: DAY })
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(200);
      expect(res.body[0]).toMatchObject({ starts_at: '08:30:00', ends_at: '09:05:00' });
    });
  });
});
