import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import {
  AttendanceDeviceKind,
  AttendanceEventDirection,
  AttendanceSource,
  AttendanceStatus,
  AttendanceSubjectType,
} from '@biddaloy/shared';
import { DeviceEventsService } from './device-events.service';
import { DeviceService } from './device.service';
import { AttendanceModule } from '../attendance.module';
import { AuthModule } from '../../auth/auth.module';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { AttendanceDevice } from '../entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../entities/attendance-device-event.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { AttendanceSession } from '../entities/attendance-session.entity';
import { DeviceEventDto } from '../dto/device.dto';
// [36.2.3] Created by the sibling #1098/#1096 lanes off the same
// epic/36/integration base — not merged onto this branch yet. These
// STAFF-path tests below cannot run until they land; see this ticket's
// report.
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { StaffAttendanceRecord } from '../../staff-attendance/entities/staff-attendance-record.entity';
import { User } from '../../users/entities/user.entity';

describe('DeviceEventsService (integration)', () => {
  let service: DeviceEventsService;
  let deviceService: DeviceService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';

  let sectionId: string;
  let otherSectionId: string;
  let otherSectionForOtherTenantId: string;
  let studentId: string;
  let otherTenantStudentId: string;

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  const TODAY = () => isoDate(new Date());

  // `region.timezone` is pinned to UTC — the default is Asia/Dhaka
  // (UTC+6), which would otherwise shift every occurred_at in this file
  // onto a different local date/time than the literal Z-suffixed string
  // suggests.
  async function setTenantSettings(
    tenantId: string,
    attendance: Record<string, unknown>,
  ): Promise<void> {
    await dataSource
      .getRepository(School)
      .update(
        { id: tenantId },
        { settings: { version: 1, region: { timezone: 'UTC' }, attendance } as any },
      );
  }

  async function createActiveDevice(overrides: Record<string, unknown> = {}) {
    const { device } = await deviceService.create({
      tenantId: TENANT_ID,
      userId: SEED_ADMIN_USER_ID,
      dto: { name: 'Test Device', kind: AttendanceDeviceKind.RFID, ...overrides },
      ip: null,
      userAgent: null,
    });
    // `DeviceService.create` returns the API-facing `DeviceResponseDto`
    // (no `token_hash`); the ingest service needs the full entity.
    return dataSource.getRepository(AttendanceDevice).findOneOrFail({ where: { id: device.id } });
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get<DeviceEventsService>(DeviceEventsService);
    deviceService = module.get<DeviceService>(DeviceService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Other Device School',
        slug: 'other-device-school',
      });
    }

    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    const year = await yearRepo.save({
      name: 'Device Events Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await classRepo.save({
      name: 'Device Events Test Class',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await sectionRepo.save({
      section_name: 'Dev Section',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    sectionId = section.id;

    const otherSection = await sectionRepo.save({
      section_name: 'Dev Section 2',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    otherSectionId = otherSection.id;

    const otherYear = await yearRepo.save({
      name: 'Other Tenant Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: OTHER_TENANT,
    });
    const otherClass = await classRepo.save({
      name: 'Other Tenant Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER_TENANT,
    });
    const otherTenantSection = await sectionRepo.save({
      section_name: 'Other Tenant Section',
      class_id: otherClass.id,
      tenant_id: OTHER_TENANT,
    });
    otherSectionForOtherTenantId = otherTenantSection.id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await setTenantSettings(TENANT_ID, {
      weeklyOffDays: [],
      lateAfter: '08:15',
      absentAfter: '10:00',
      correctionWindowDays: 2,
      allowFutureDates: false,
    });

    const studentRepo = dataSource.getRepository(Student);
    const student = await studentRepo.save({
      full_name: 'Device Test Student',
      registration_number: `DEV-REG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      roll_number: 1,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });

    // `students` is transactional (truncated before every test), so the
    // other-tenant fixture is re-created here too, not just in beforeAll.
    const otherTenantStudent = await studentRepo.save({
      full_name: 'Other Tenant Student',
      registration_number: `OTHER-REG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      roll_number: 1,
      class_section_id: otherSectionForOtherTenantId,
      tenant_id: OTHER_TENANT,
    });
    otherTenantStudentId = otherTenantStudent.id;
    studentId = student.id;
  });

  function inEvent(overrides: Partial<DeviceEventDto> = {}): DeviceEventDto {
    return {
      device_event_id: `evt-${Date.now()}-${Math.random()}`,
      occurred_at: `${TODAY()}T02:00:00Z`,
      direction: AttendanceEventDirection.IN,
      ...overrides,
    } as DeviceEventDto;
  }

  it('reports "duplicate" on the second post of the same device_event_id, writing one record', async () => {
    const device = await createActiveDevice();
    const event = inEvent({ student_id: studentId });

    const first = await service.ingest(device, [event]);
    const second = await service.ingest(device, [event]);

    expect(first.results[0].outcome).toBe('accepted');
    expect(second.results[0].outcome).toBe('duplicate');

    const records = await dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { student_id: studentId } });
    expect(records).toHaveLength(1);
  });

  it('classifies PRESENT at/under lateAfter and LATE just after it', async () => {
    const device = await createActiveDevice();

    const onTime = await service.ingest(device, [
      inEvent({ student_id: studentId, occurred_at: `${TODAY()}T08:15:00Z` }),
    ]);
    expect(onTime.results[0].status).toBe(AttendanceStatus.PRESENT);

    const other = await dataSource.getRepository(Student).save({
      full_name: 'Second Device Student',
      registration_number: `DEV-REG-B-${Date.now()}`,
      roll_number: 2,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    const late = await service.ingest(device, [
      inEvent({ student_id: other.id, occurred_at: `${TODAY()}T08:16:00Z` }),
    ]);
    expect(late.results[0].status).toBe(AttendanceStatus.LATE);
  });

  it('never overwrites a TEACHER-marked record, but fills a null check_in_at', async () => {
    const device = await createActiveDevice();

    const session = await dataSource.getRepository(AttendanceSession).save({
      tenant_id: TENANT_ID,
      section_id: sectionId,
      date: TODAY(),
      period_no: null,
      source: AttendanceSource.TEACHER,
    });
    const record = await dataSource.getRepository(AttendanceRecord).save({
      tenant_id: TENANT_ID,
      session_id: session.id,
      student_id: studentId,
      date: TODAY(),
      status: AttendanceStatus.PRESENT,
      source: AttendanceSource.TEACHER,
      check_in_at: null,
    });

    const result = await service.ingest(device, [
      inEvent({ student_id: studentId, occurred_at: `${TODAY()}T09:00:00Z` }),
    ]);

    expect(result.results[0].outcome).toBe('skipped_teacher_marked');

    const updated = await dataSource.getRepository(AttendanceRecord).findOneOrFail({
      where: { id: record.id },
    });
    expect(updated.status).toBe(AttendanceStatus.PRESENT); // untouched
    expect(updated.check_in_at).not.toBeNull(); // filled
  });

  it('rejects an OUT event with no prior IN as "no_check_in"', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [
      inEvent({
        student_id: studentId,
        direction: AttendanceEventDirection.OUT,
        occurred_at: `${TODAY()}T16:00:00Z`,
      }),
    ]);

    expect(result.results[0].outcome).toBe('rejected');
    expect(result.results[0].reason).toBe('no_check_in');
  });

  it('rejects an event more than 2 days from today as "out_of_window"', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [
      inEvent({ student_id: studentId, occurred_at: '2024-01-01T02:00:00Z' }),
    ]);

    expect(result.results[0].outcome).toBe('out_of_window');
  });

  it('reports unknown_student for a student_id belonging to a different tenant', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [inEvent({ student_id: otherTenantStudentId })]);

    expect(result.results[0].outcome).toBe('unknown_student');
  });

  it('rejects a section-bound device scanning a student from a different section', async () => {
    const device = await createActiveDevice({ section_id: otherSectionId });

    const result = await service.ingest(device, [inEvent({ student_id: studentId })]);

    expect(result.results[0].outcome).toBe('rejected');
    expect(result.results[0].reason).toBe('section_mismatch');
  });

  it('reports unknown_student when neither student_id nor external_ref is given', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [inEvent()]);

    expect(result.results[0].outcome).toBe('unknown_student');
  });

  it('reports unknown_student when both student_id and external_ref are given, rather than silently preferring one', async () => {
    const device = await createActiveDevice();

    const result = await service.ingest(device, [
      inEvent({ student_id: studentId, external_ref: 'REG-DOES-NOT-MATTER' }),
    ]);

    expect(result.results[0].outcome).toBe('unknown_student');
    // Confirms it never created a mark for `studentId` from the ambiguous event.
    const records = await dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { student_id: studentId } });
    expect(records).toHaveLength(0);
  });

  it('reports unknown_student for a soft-deleted student, and creates no record', async () => {
    const device = await createActiveDevice();
    const deletedStudent = await dataSource.getRepository(Student).save({
      full_name: 'Soft Deleted Student',
      registration_number: `DEV-REG-DELETED-${Date.now()}`,
      roll_number: 9,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    await dataSource.getRepository(Student).softDelete(deletedStudent.id);

    const result = await service.ingest(device, [inEvent({ student_id: deletedStudent.id })]);

    expect(result.results[0].outcome).toBe('unknown_student');
    const records = await dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { student_id: deletedStudent.id } });
    expect(records).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // [36.2.3] subject_type: STAFF. Needs #1098's StaffAttendanceSession/
  // StaffAttendanceRecord entities and #1096's StaffProfile entity —
  // none exist on this branch yet, so this block cannot compile/run
  // until #1098 merges. Written against the shapes documented in the
  // [36.1.1] migration and #1098's ticket body.
  // -------------------------------------------------------------------
  describe('subject_type: STAFF', () => {
    let staffProfileId: string;

    beforeEach(async () => {
      const user = await dataSource.getRepository(User).save({
        full_name: 'Device Test Staff',
        email: `device-staff-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`,
        password_hash: 'x',
      });
      const profile = await dataSource.getRepository(StaffProfile).save({
        user_id: user.id,
        tenant_id: TENANT_ID,
        employee_id: `EMP-DEV-${Date.now()}`,
      });
      staffProfileId = profile.id;
    });

    it('creates a StaffAttendanceRecord for a subject_type: STAFF event with a valid employee_id external_ref', async () => {
      const device = await createActiveDevice();

      const result = await service.ingest(device, [
        inEvent({
          subject_type: AttendanceSubjectType.STAFF,
          external_ref: (
            await dataSource.getRepository(StaffProfile).findOneOrFail({
              where: { id: staffProfileId },
            })
          ).employee_id,
        }),
      ]);

      expect(result.results[0].outcome).toBe('accepted');
      const records = await dataSource
        .getRepository(StaffAttendanceRecord)
        .find({ where: { staff_profile_id: staffProfileId } });
      expect(records).toHaveLength(1);
    });

    it('reports unknown_staff for an external_ref with no matching employee_id', async () => {
      const device = await createActiveDevice();

      const result = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: 'NO-SUCH-EMPLOYEE' }),
      ]);

      expect(result.results[0].outcome).toBe('unknown_staff');
    });

    it('never overwrites a manually-marked staff record, but fills a null check_in_at', async () => {
      const device = await createActiveDevice();
      const employeeId = (
        await dataSource
          .getRepository(StaffProfile)
          .findOneOrFail({ where: { id: staffProfileId } })
      ).employee_id;

      // Seed a manual (TEACHER-sourced, i.e. admin/self-marked) record first.
      const first = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: employeeId }),
      ]);
      expect(first.results[0].outcome).toBe('accepted');
      await dataSource
        .getRepository(StaffAttendanceRecord)
        .update(
          { staff_profile_id: staffProfileId },
          { source: AttendanceSource.TEACHER, check_in_at: null },
        );

      const second = await service.ingest(device, [
        inEvent({
          subject_type: AttendanceSubjectType.STAFF,
          external_ref: employeeId,
          occurred_at: `${TODAY()}T09:00:00Z`,
        }),
      ]);

      expect(second.results[0].outcome).toBe('skipped_teacher_marked');
      const updated = await dataSource
        .getRepository(StaffAttendanceRecord)
        .findOneOrFail({ where: { staff_profile_id: staffProfileId } });
      expect(updated.check_in_at).not.toBeNull(); // filled
    });

    it('keeps STUDENT-path behavior unchanged when subject_type is omitted', async () => {
      const device = await createActiveDevice();

      const result = await service.ingest(device, [inEvent({ student_id: studentId })]);

      expect(result.results[0].outcome).toBe('accepted');
    });

    it("reports unknown_staff for another tenant's employee_id (tenant isolation)", async () => {
      const device = await createActiveDevice(); // bound to TENANT_ID
      const otherUser = await dataSource.getRepository(User).save({
        full_name: 'Other Tenant Staff',
        email: `other-tenant-staff-${Date.now()}@example.com`,
        password_hash: 'x',
      });
      const sameEmployeeId = `EMP-CROSS-${Date.now()}`;
      await dataSource.getRepository(StaffProfile).save({
        user_id: otherUser.id,
        tenant_id: OTHER_TENANT,
        employee_id: sameEmployeeId,
      });

      const result = await service.ingest(device, [
        inEvent({ subject_type: AttendanceSubjectType.STAFF, external_ref: sameEmployeeId }),
      ]);

      expect(result.results[0].outcome).toBe('unknown_staff');
    });
  });
});
