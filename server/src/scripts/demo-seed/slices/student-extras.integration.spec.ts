import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../../../modules/presets/preset-registry.service';
import { AuthTokenService } from '../../../modules/account-access/auth-token.service';
import { SchoolInviteService } from '../../../modules/account-access/school-invite.service';
import { StaffProfilesService } from '../../../modules/staff-profiles/staff-profiles.service';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { createContext } from '../context';
import { slice as org } from './org';
import { slice as students } from './students';
import { slice as extras } from './student-extras';

const ANCHOR = '2026-10-10';

/** An in-memory bucket: records what was put so the spec can ask whether a key exists. */
class MemoryStorage {
  objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.objects.set(key, body);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}

describe('student-extras slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let app: TestingModule;
  const storage = new MemoryStorage();
  // The suite resets data before each `it`, so everything is read once, right after the seed.
  const facts: Record<string, any> = {};
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  beforeAll(async () => {
    app = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      AuthTokenService,
      SchoolInviteService,
      StaffProfilesService,
      PromotionsService,
      EnrollmentService,
      StudentLifecycleService,
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: StorageService, useValue: storage },
    ]);
    ds = app.get<DataSource>(getDataSourceToken());
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    const ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await students.run(ctx);
    facts.rows = await extras.run(ctx);

    facts.noPhoto = await q(`SELECT id FROM students WHERE photo_key IS NULL`);
    facts.photos = await q(
      `SELECT st.photo_key, st.tenant_id, st.gender FROM students st WHERE st.photo_key IS NOT NULL`,
    );
    facts.choices = await q(
      `SELECT ssc.is_fourth, cs.group_name AS subject_group, cs.is_optional, sec.group_name AS section_group,
              st.enrollment_status
         FROM student_subject_choices ssc
         JOIN class_subjects cs ON cs.id = ssc.class_subject_id
         JOIN students st ON st.id = ssc.student_id
         JOIN enrollments e ON e.student_id = ssc.student_id AND e.academic_year_id = ssc.academic_year_id
         JOIN class_sections sec ON sec.id = e.section_id`,
    );
    facts.collegeStudents = await q(
      `SELECT count(*)::int AS n FROM students st JOIN schools s ON s.id = st.tenant_id
        WHERE s.slug = 'bmsc-college' AND st.enrollment_status = 'ACTIVE'`,
    );
    facts.collegeWithoutChoices = await q(
      `SELECT st.id FROM students st JOIN schools s ON s.id = st.tenant_id
        WHERE s.slug = 'bmsc-college' AND st.enrollment_status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM student_subject_choices c WHERE c.student_id = st.id)`,
    );
    facts.notes = await q(`SELECT n.body, n.author_user_id, n.rating FROM student_notes n`);
    facts.activeCount = await q(
      `SELECT count(*)::int AS n FROM students WHERE enrollment_status = 'ACTIVE'`,
    );
    facts.graduates = await q(
      `SELECT st.id, c.numeric_grade, p.exam_type, p.gpa, p.passing_year
         FROM students st
         JOIN LATERAL (SELECT e.class_id FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
                        WHERE e.student_id = st.id ORDER BY y.start_date DESC LIMIT 1) last ON true
         JOIN classes c ON c.id = last.class_id
         LEFT JOIN student_public_exams p ON p.student_id = st.id
        WHERE st.enrollment_status = 'GRADUATED'`,
    );
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('every student has a photo whose object exists in the branch folder', async () => {
    expect(facts.noPhoto).toEqual([]);
    expect(facts.photos.length).toBeGreaterThan(0);
    for (const p of facts.photos) {
      expect(p.photo_key.startsWith(`tenants/${p.tenant_id}/student-photo/`)).toBe(true);
      expect(await storage.exists(p.photo_key)).toBe(true);
    }
    // 24 avatars are uploaded once per branch and reused, never one object per student.
    expect([...storage.objects.keys()].filter((k) => k.includes('/student-photo/'))).toHaveLength(
      3 * 24,
    );
  });

  it('College students choose the subjects of their own section group', () => {
    expect(facts.collegeStudents[0].n).toBeGreaterThan(0);
    expect(facts.collegeWithoutChoices).toEqual([]);
    expect(facts.choices.length).toBeGreaterThan(0);
    for (const c of facts.choices) {
      // A normal pick belongs to the section's group; the only other pick is the optional fourth subject.
      if (c.is_fourth) expect(c.is_optional).toBe(true);
      else expect(c.subject_group).toBe(c.section_group);
    }
  });

  it('graduates of class 10 and 12 have an SSC or HSC row with an NCTB-scale GPA', () => {
    expect(facts.graduates.length).toBeGreaterThan(0);
    for (const g of facts.graduates) {
      expect(g.exam_type).toBe(Number(g.numeric_grade) === 10 ? 'SSC' : 'HSC');
      expect(Number(g.gpa)).toBeGreaterThanOrEqual(2);
      expect(Number(g.gpa)).toBeLessThanOrEqual(5);
      // The student left before the demo's "today".
      expect(g.passing_year).toBeLessThanOrEqual(Number(ANCHOR.slice(0, 4)));
    }
  });

  it('adds teacher notes for about a tenth of current students, in Bangla', () => {
    const share = facts.notes.length / facts.activeCount[0].n;
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.2);
    for (const n of facts.notes) {
      expect(n.body).toMatch(/[ঀ-৿]/);
      expect(n.author_user_id).toBeTruthy();
    }
    expect(typeof facts.rows).toBe('number');
  });
});
