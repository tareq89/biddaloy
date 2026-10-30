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
import { ResultsService } from '../../../modules/exams/results.service';
import { MarkGridService } from '../../../modules/exams/mark-grid.service';
import { AttendanceComponentService } from '../../../modules/exams/attendance-component.service';
import { MarksAuthorizationService } from '../../../modules/exams/marks-authorization.util';
import { SeatPlansService } from '../../../modules/seat-plans/seat-plans.service';
import { TeacherBusyService } from '../../../modules/routines/teacher-busy.service';
import { ResolveRoutineService } from '../../../modules/routines/resolve-routine.service';
import { createContext } from '../context';
import { slice as org } from './org';
import { slice as students } from './students';
import { slice as extras } from './student-extras';
import { slice as exams } from './exams';
import { slice as commsPrint } from './comms-print';
import { PrintTemplatesService } from '../../../modules/print/templates/print-templates.service';
import { PrintJobsService } from '../../../modules/print/jobs/print-jobs.service';
import { SchoolSettingsReader } from '../../../modules/schools/settings/school-settings-reader.service';

import { problemWith } from '../../../modules/schools/settings/messaging-settings.validator';
import { buildMessagingProvidersResponse } from '../../../modules/schools/settings/messaging-descriptors';
import type { CommunicationMedium } from '@biddaloy/shared';

const ANCHOR = '2026-10-10';

describe('comms-print slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let app: TestingModule;
  // Everything is read once, right after the seed (the suite resets data before each `it`).
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
      ResultsService,
      MarkGridService,
      SeatPlansService,
      TeacherBusyService,
      PrintTemplatesService,
      PrintJobsService,
      { provide: SchoolSettingsReader, useValue: { documentsSettings: async () => ({}) } },
      { provide: AttendanceComponentService, useValue: {} },
      { provide: MarksAuthorizationService, useValue: {} },
      { provide: ResolveRoutineService, useValue: { resolveTenantDay: async () => [] } },
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: StorageService, useValue: { put: vi.fn(), exists: vi.fn(), get: vi.fn() } },
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
    await extras.run(ctx);
    await exams.run(ctx);
    facts.rows = await commsPrint.run(ctx);

    facts.credit = await q(
      `SELECT b.available, b.reserved,
              COALESCE((SELECT sum(CASE WHEN l.kind = 'GRANT' THEN l.units ELSE -l.units END)
                          FROM sms_credit_ledger l WHERE l.tenant_id = b.tenant_id), 0)::int AS ledger
         FROM sms_credit_balance b`,
    );
    facts.tenants = await q(`SELECT count(*)::int AS n FROM schools WHERE slug LIKE 'bmsc-%'`);
    // Running balance per tenant, in time order: never below zero.
    facts.negative = await q(
      `SELECT count(*)::int AS n FROM (
         SELECT sum(CASE WHEN kind = 'GRANT' THEN units ELSE -units END)
                  OVER (PARTITION BY tenant_id ORDER BY created_at, kind DESC, id) AS running
           FROM sms_credit_ledger) x WHERE running < 0`,
    );
    // Printed documents derive from the anchor, not the run day.
    facts.printDates = await q(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE i.serial_year IS NOT NULL
                AND i.serial_year > extract(year FROM $1::date))::int AS future_serial,
              count(*) FILTER (WHERE (i.data_snapshot->>'issuedAt')::timestamptz > $1::date + 1)::int AS future_issued,
              count(*) FILTER (WHERE i.created_at::date > $1::date)::int AS future_created,
              count(*) FILTER (WHERE i.serial_year IS NOT NULL
                AND i.serial_year <> extract(year FROM (i.data_snapshot->>'issuedAt')::timestamptz
                      AT TIME ZONE 'Asia/Dhaka'))::int AS serial_mismatch
         FROM print_job_items i`,
      [ANCHOR],
    );
    facts.logs = await q(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
              count(*) FILTER (WHERE status <> 'FAILED'
                  AND provider_message_id NOT LIKE 'mailpit-sink-%')::int AS other_provider,
              count(*) FILTER (WHERE metadata->>'provider' IS DISTINCT FROM 'mailpit-sink')::int AS no_tag
         FROM communication_logs`,
    );
    facts.batches = await q(
      `SELECT b.total_recipients,
              (SELECT count(*)::int FROM communication_logs l WHERE l.reminder_batch_id = b.id) AS logs
         FROM reminder_batches b`,
    );
    facts.idMissing = await q(
      `SELECT count(*)::int AS n FROM students s
        WHERE s.enrollment_status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM print_job_items i
           WHERE i.subject_id = s.id AND i.document_kind = 'STUDENT_ID_CARD')`,
    );
    facts.admitMissing = await q(
      `SELECT count(DISTINCT a.student_id)::int AS n FROM seat_allocations a
        WHERE NOT EXISTS (
          SELECT 1 FROM print_job_items i
           WHERE i.subject_id = a.student_id AND i.document_kind = 'EXAM_ADMIT_CARD')`,
    );
    facts.seated = await q(`SELECT count(DISTINCT student_id)::int AS n FROM seat_allocations`);
    facts.tc = await q(
      `SELECT (SELECT count(*)::int FROM print_job_items WHERE document_kind = 'TRANSFER_CERTIFICATE') AS tcs,
              (SELECT count(*)::int FROM student_lifecycle_events
                WHERE event_type = 'TRANSFERRED_OUT' AND destination LIKE '%মাধ্যমিক শাখা') AS transfers`,
    );
    facts.commsSettings = await q(
      `SELECT settings->'communications' AS c FROM schools WHERE slug LIKE 'bmsc-%'`,
    );
    facts.counts = await q(
      `SELECT (SELECT count(*)::int FROM calendar_feed_tokens) AS tokens,
              (SELECT count(*)::int FROM printer_profiles) AS printers,
              (SELECT count(*)::int FROM print_job_items WHERE document_kind IN ('TESTIMONIAL','CHARACTER_CERTIFICATE')) AS certificates`,
    );
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('keeps the SMS credit balance equal to the ledger and above zero', () => {
    expect(facts.credit.length).toBe(facts.tenants[0].n);
    expect(facts.negative[0].n).toBe(0);
    for (const c of facts.credit) {
      expect(c.available).toBe(c.ledger);
      expect(c.available).toBe(10_000);
      expect(c.reserved).toBe(0);
    }
  });

  it('tags every message as mailpit-sink so nothing implies a real provider', () => {
    expect(facts.logs[0].n).toBeGreaterThan(0);
    expect(facts.logs[0].other_provider).toBe(0);
    expect(facts.logs[0].no_tag).toBe(0);
    expect(facts.logs[0].failed).toBeGreaterThan(0);
  });

  it('links each reminder batch to exactly its logs', () => {
    expect(facts.batches.length).toBeGreaterThan(0);
    for (const b of facts.batches) expect(b.logs).toBe(b.total_recipients);
  });

  it('issues an ID card to every current student', () => {
    expect(facts.idMissing[0].n).toBe(0);
  });

  it('issues an admit card to every student with a next-exam seat', () => {
    expect(facts.seated[0].n).toBeGreaterThan(0);
    expect(facts.admitMissing[0].n).toBe(0);
  });

  it('issues one transfer certificate per Primary to High transfer', () => {
    expect(facts.tc[0].transfers).toBeGreaterThan(0);
    expect(facts.tc[0].tcs).toBe(facts.tc[0].transfers);
  });

  // Epic 97 D6: every demo school is "Set up" on all four media, with OneCodeSoft as its SMS company.
  it('stores messaging settings in the per-provider shape: valid, set up, secrets encrypted', () => {
    expect(facts.commsSettings.length).toBe(facts.tenants[0].n);
    for (const { c } of facts.commsSettings) {
      expect(c.sms.provider).toBe('onecodesoft');
      expect(c.sms.metering).toBe('PLATFORM');
      for (const medium of ['SMS', 'WHATSAPP', 'EMAIL', 'MESSENGER'] as const) {
        // The same validator the settings form uses accepts the seeded block.
        expect(problemWith(c[medium.toLowerCase()], medium as CommunicationMedium)).toBeNull();
      }
      const res = buildMessagingProvidersResponse({ version: 1, communications: c } as never);
      expect(res.SMS?.selected).toBe('onecodesoft');
      for (const medium of ['SMS', 'WHATSAPP', 'EMAIL', 'MESSENGER'] as const) {
        expect(res[medium]?.configured).toBe(true);
      }
      // A secret is an encrypted envelope, never the plain value.
      expect(c.sms.onecodesoft.apiKey).toMatch(/^gcmv1:/);
    }
  });

  it('adds calendar tokens, printer profiles and certificates', () => {
    expect(facts.counts[0].tokens).toBeGreaterThanOrEqual(3);
    expect(facts.counts[0].printers).toBe(facts.tenants[0].n * 2);
    expect(facts.counts[0].certificates).toBeGreaterThan(0);
  });

  it('derives print dates and serial years from the anchor, not the run day', () => {
    const d = facts.printDates[0];
    expect(d.n).toBeGreaterThan(0);
    expect(d.future_serial).toBe(0);
    expect(d.future_issued).toBe(0);
    expect(d.future_created).toBe(0);
    expect(d.serial_mismatch).toBe(0);
  });
});
