import type { QueryRunner } from 'typeorm';

// [8.10.7.6.02] The rest of what the #1917 table lists, so the widgets that read these tables
// have something to read: teacher assignments, exams + published results, homework, syllabus,
// staff + staff attendance, communication logs (2% FAILED), admission applicants, seat plans,
// leave, routines, and last year's same-month bills. Same rules as the main seed: one
// transaction (the caller's), bulk INSERT ... SELECT, dates from `today`, "random" values from a
// hash of ids, fake data only.

type Q = <R = Record<string, any>>(sql: string, params?: unknown[]) => Promise<R[]>;

export interface ExtrasContext {
  q: Q;
  tenantId: string;
  yearId: string;
  /** Working days already used for the student register, newest first. */
  days: string[];
  today: string;
  students: number;
  /** Id of the `load-teacher` login user: gets real assignments so the teacher widgets have data. */
  teacherUserId: string;
}

/** Extra tables with a tenant_id, counted in the seed summary. */
export const EXTRA_COUNT_TABLES = [
  'teacher_class_sections',
  'exams',
  'marks',
  'results',
  'homework_submissions',
  'syllabus_topics',
  'staff_attendance_records',
  'communication_logs',
  'admission_applicants',
  'seat_allocations',
  'leave_records',
  'routine_slots',
];

/**
 * Last year's bills for the same month as `today` (committee-finance / collection-by-month compare
 * "same point last year"). Must run BEFORE the payment_allocations insert, which links every
 * `loadtest:<bill id>` payment.
 */
export async function seedLastYearBills(c: ExtrasContext): Promise<void> {
  const { q, tenantId, today } = c;
  const [{ id: lastYearId }] = await q<{ id: string }>(
    `SELECT id FROM academic_years
      WHERE tenant_id = $1 AND start_date = (date_trunc('year', $2::date) - interval '1 year')::date`,
    [tenantId, today],
  );
  await q(
    `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
                               total_amount, paid_amount, discount_amount, one_off_discount_amount, status, due_date, created_at, updated_at)
     SELECT s.id, $2, fs.id, m.p, 'MONTH', fs.amount,
            CASE st WHEN 'PAID' THEN fs.amount WHEN 'PARTIALLY_PAID' THEN fs.amount / 2 ELSE 0 END,
            CASE st WHEN 'WAIVED' THEN fs.amount ELSE 0 END, CASE st WHEN 'WAIVED' THEN fs.amount ELSE 0 END,
            st::student_fees_status_enum, m.p + 10, NOW(), NOW()
       FROM students s
       JOIN class_sections cs ON cs.id = s.class_section_id
       JOIN fee_structures fs ON fs.class_id = cs.class_id AND fs.tenant_id = s.tenant_id
       CROSS JOIN (SELECT (date_trunc('month', $3::date) - interval '1 year')::date AS p) m
       CROSS JOIN LATERAL (SELECT abs(hashtext(s.id::text || m.p::text)) % 100 AS h) x
       CROSS JOIN LATERAL (SELECT CASE WHEN h < 2 THEN 'WAIVED'
                                       WHEN h < 82 THEN 'PAID' WHEN h < 92 THEN 'PARTIALLY_PAID'
                                       ELSE 'PENDING' END AS st) y
      WHERE s.tenant_id = $1`,
    [tenantId, lastYearId, today],
  );
  await q(
    `INSERT INTO payments (tenant_id, student_id, total_amount, payment_method, payment_status, payment_date, idempotency_key, remarks, created_at, updated_at)
     SELECT $1, sf.student_id, sf.paid_amount,
            (ARRAY['CASH','BKASH','BANK_TRANSFER'])[1 + abs(hashtext(sf.id::text)) % 3]::payments_payment_method_enum,
            'SUCCESS',
            (sf.period_start + abs(hashtext(sf.id::text)) % 9)::timestamptz + interval '6 hours',
            'loadtest:' || sf.id, 'Load test', NOW(), NOW()
       FROM student_fees sf JOIN students s ON s.id = sf.student_id
      WHERE s.tenant_id = $1 AND sf.paid_amount > 0 AND sf.academic_year_id = $2`,
    [tenantId, lastYearId],
  );
}

export async function seedExtras(c: ExtrasContext): Promise<void> {
  const { q, tenantId, yearId, today, days } = c;

  // --- subjects, classes' subjects
  await q(
    `INSERT INTO subjects (tenant_id, name_en, code)
     SELECT $1, 'Load Subject ' || n, 'LS' || n FROM generate_series(1, 8) n`,
    [tenantId],
  );
  await q(
    `INSERT INTO class_subjects (tenant_id, class_id, subject_id, academic_year_id)
     SELECT $1, c.id, s.id, $2 FROM classes c, subjects s WHERE c.tenant_id = $1 AND s.tenant_id = $1`,
    [tenantId, yearId],
  );

  // --- staff: 30 teachers + 10 office staff + the load-teacher login, one profile each
  const staff = await q<{ id: string }>(
    `INSERT INTO users (email, status, full_name, email_verified_at, created_at, updated_at)
     SELECT 'load-staff-' || n || '@biddaloy.test', 'ACTIVE', 'Load Staff ' || n, NOW(), NOW(), NOW()
       FROM generate_series(1, 40) n
     RETURNING id`,
  );
  await q(
    `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
     SELECT u.id, $1, (CASE WHEN split_part(split_part(u.email, '-', 3), '@', 1)::int <= 30
                            THEN 'TEACHER' ELSE 'OFFICE_STAFF' END)::user_tenants_role_enum, NOW(), NOW()
       FROM users u WHERE u.id = ANY($2::uuid[])`,
    [tenantId, staff.map((s) => s.id)],
  );
  await q(
    `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, joining_date)
     SELECT u.id, $1,
            CASE WHEN u.id = $3 THEN 'LE-000' ELSE 'LE-' || lpad(split_part(split_part(u.email, '-', 3), '@', 1), 3, '0') END,
            ($4::date - 400 - (abs(hashtext(u.id::text)) % 1000))::date
       FROM users u WHERE u.id = ANY($2::uuid[]) OR u.id = $3`,
    [tenantId, staff.map((s) => s.id), c.teacherUserId, today],
  );
  await q(
    `INSERT INTO teachers (user_id, employee_id, tenant_id, staff_profile_id)
     SELECT sp.user_id, sp.employee_id, $1, sp.id
       FROM staff_profiles sp JOIN user_tenants ut ON ut.user_id = sp.user_id AND ut.tenant_id = $1
      WHERE sp.tenant_id = $1 AND ut.role = 'TEACHER'`,
    [tenantId],
  );
  // teachers[0] is the load-teacher login ('LE-000').
  const teacherIds = (
    await q<{ id: string }>(`SELECT id FROM teachers WHERE tenant_id = $1 ORDER BY employee_id`, [
      tenantId,
    ])
  ).map((t) => t.id);
  const sectionIds = (
    await q<{ id: string }>(
      `SELECT id FROM class_sections WHERE tenant_id = $1 ORDER BY class_id, section_name`,
      [tenantId],
    )
  ).map((r) => r.id);
  const subjectIds = (
    await q<{ id: string }>(`SELECT id FROM subjects WHERE tenant_id = $1 ORDER BY code`, [
      tenantId,
    ])
  ).map((r) => r.id);
  const nT = teacherIds.length;

  // --- teacher assignments: a class teacher for the first sections, two subject teachers per
  // section; the login teacher takes sections 1-10 so teacher cards are never empty.
  await q(
    `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
     SELECT ($1::uuid[])[n], ($2::uuid[])[n], $3, 'CLASS_TEACHER'::teacher_assignment_type
       FROM generate_series(1, LEAST($4::int, cardinality($2::uuid[]))) n`,
    [teacherIds, sectionIds, tenantId, nT],
  );
  await q(
    `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type, subject_id)
     SELECT ($1::uuid[])[CASE WHEN j <= 10 THEN 1 ELSE 2 + (j % ($4::int - 1)) END],
            ($2::uuid[])[j], $3, 'SUBJECT_TEACHER'::teacher_assignment_type,
            ($5::uuid[])[1 + (j + k) % 8]
       FROM generate_series(1, cardinality($2::uuid[])) j, generate_series(0, 1) k`,
    [teacherIds, sectionIds, tenantId, nT, subjectIds],
  );

  // --- exams: per class one PUBLISHED term exam (20 days ago) and one DRAFT monthly test
  await q(
    `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status, published_at, mark_entry_deadline)
     SELECT $1, $2, c.id, CASE k WHEN 1 THEN 'Half-yearly' ELSE 'Monthly test' END,
            (CASE k WHEN 1 THEN 'TERM' ELSE 'MONTHLY' END)::exams_kind_enum,
            (CASE k WHEN 1 THEN 'PUBLISHED' ELSE 'DRAFT' END)::exams_status_enum,
            CASE k WHEN 1 THEN NOW() - interval '20 days' END,
            CASE k WHEN 2 THEN $3::date + 5 END
       FROM classes c, generate_series(1, 2) k WHERE c.tenant_id = $1`,
    [tenantId, yearId, today],
  );
  await q(
    `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, full_marks, sequence)
     SELECT $1, e.id, s.id, comp.name, comp.kind::exam_components_kind_enum, comp.fm, comp.seq
       FROM exams e CROSS JOIN subjects s
       CROSS JOIN LATERAL (
         SELECT 'Written' AS name, 'WRITTEN' AS kind, 100 AS fm, 1 AS seq WHERE e.status = 'PUBLISHED'
         UNION ALL SELECT 'Written', 'WRITTEN', 80, 1 WHERE e.status = 'DRAFT'
         UNION ALL SELECT 'MCQ', 'MCQ', 20, 2 WHERE e.status = 'DRAFT') comp
      WHERE e.tenant_id = $1 AND s.tenant_id = $1`,
    [tenantId],
  );
  await q(
    `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
     SELECT $1, e.id, s.id,
            CASE WHEN e.status = 'PUBLISHED' THEN $2::date - 25 + s.rn ELSE $2::date + 2 + s.rn END,
            '10:00', '12:00'
       FROM exams e
       CROSS JOIN (SELECT id, row_number() OVER (ORDER BY code)::int AS rn FROM subjects WHERE tenant_id = $1) s
      WHERE e.tenant_id = $1`,
    [tenantId, today],
  );
  // Published exams: every section's grid submitted, every student has a mark per subject.
  await q(
    `INSERT INTO mark_grids (tenant_id, exam_id, section_id, subject_id, state, submitted_at)
     SELECT $1, e.id, cs.id, s.id, 'SUBMITTED', NOW() - interval '21 days'
       FROM exams e
       JOIN class_sections cs ON cs.class_id = e.class_id AND cs.tenant_id = $1
       CROSS JOIN subjects s
      WHERE e.tenant_id = $1 AND e.status = 'PUBLISHED' AND s.tenant_id = $1`,
    [tenantId],
  );
  await q(
    `INSERT INTO marks (tenant_id, exam_id, student_id, subject_id, component_id, value, status)
     SELECT $1, ec.exam_id, st.id, ec.subject_id, ec.id,
            30 + abs(hashtext(st.id::text || ec.id::text)) % 70, 'PRESENT'::marks_status_enum
       FROM exam_components ec
       JOIN exams e ON e.id = ec.exam_id AND e.status = 'PUBLISHED'
       JOIN class_sections cs ON cs.class_id = e.class_id AND cs.tenant_id = $1
       JOIN students st ON st.class_section_id = cs.id AND st.tenant_id = $1
      WHERE ec.tenant_id = $1`,
    [tenantId],
  );
  // Draft monthly tests: marks entered for 2 subjects, ~40% of the students (entry in progress).
  await q(
    `INSERT INTO marks (tenant_id, exam_id, student_id, subject_id, component_id, value, status)
     SELECT $1, ec.exam_id, st.id, ec.subject_id, ec.id,
            CASE ec.name WHEN 'MCQ' THEN 5 + abs(hashtext(st.id::text || ec.id::text)) % 15
                         ELSE 20 + abs(hashtext(st.id::text || ec.id::text)) % 60 END,
            'PRESENT'::marks_status_enum
       FROM exam_components ec
       JOIN exams e ON e.id = ec.exam_id AND e.status = 'DRAFT'
       JOIN subjects sj ON sj.id = ec.subject_id AND sj.code IN ('LS1', 'LS2')
       JOIN class_sections cs ON cs.class_id = e.class_id AND cs.tenant_id = $1
       JOIN students st ON st.class_section_id = cs.id AND st.tenant_id = $1
      WHERE ec.tenant_id = $1 AND abs(hashtext(st.id::text)) % 100 < 40`,
    [tenantId],
  );
  // Published results (~6% fail) and their per-subject lines.
  const [{ id: scaleId }] = await q<{ id: string }>(
    `INSERT INTO grading_scales (tenant_id, academic_year_id, name, revision)
     VALUES ($1, $2, 'Load scale', 1) RETURNING id`,
    [tenantId, yearId],
  );
  await q(
    `INSERT INTO results (tenant_id, exam_id, student_id, total_marks, gpa, grade, is_fail, grading_scale_id,
                          grading_scale_revision, rule_version, computed_at, published_at, section_id)
     SELECT $1, r.exam_id, r.student_id, r.total,
            CASE WHEN r.h < 6 THEN 0 ELSE round((r.total / 8 / 20)::numeric, 2) END,
            CASE WHEN r.h < 6 THEN 'F' WHEN r.total / 8 >= 80 THEN 'A+' WHEN r.total / 8 >= 60 THEN 'A' ELSE 'B' END,
            r.h < 6, $2, 1, 'load-v1', NOW() - interval '21 days', NOW() - interval '20 days', r.section_id
       FROM (SELECT m.exam_id, m.student_id, st.class_section_id AS section_id, SUM(m.value) AS total,
                    abs(hashtext(m.student_id::text)) % 100 AS h
               FROM marks m JOIN exams e ON e.id = m.exam_id AND e.status = 'PUBLISHED'
               JOIN students st ON st.id = m.student_id
              WHERE m.tenant_id = $1 GROUP BY m.exam_id, m.student_id, st.class_section_id) r`,
    [tenantId, scaleId],
  );
  await q(
    `INSERT INTO result_subjects (tenant_id, result_id, subject_id, obtained, grade, gpa)
     SELECT $1, r.id, m.subject_id, m.value,
            CASE WHEN m.value >= 80 THEN 'A+' WHEN m.value >= 60 THEN 'A' ELSE 'B' END,
            round((m.value / 20)::numeric, 2)
       FROM results r JOIN marks m ON m.exam_id = r.exam_id AND m.student_id = r.student_id
      WHERE r.tenant_id = $1`,
    [tenantId],
  );

  // --- homework: one per class x subject; the first 5 subjects are assigned to every section
  await q(
    `INSERT INTO homework (tenant_id, subject_id, class_id, title, grading_mode)
     SELECT $1, s.id, c.id, 'Load homework ' || c.name || ' ' || s.code, 'TICK'::homework_grading_mode_enum
       FROM classes c, subjects s WHERE c.tenant_id = $1 AND s.tenant_id = $1`,
    [tenantId],
  );
  await q(
    `INSERT INTO homework_assignments (tenant_id, homework_id, assigned_date, due_date, section_id)
     SELECT $1, h.id, $2::date - s.rn * 2, $2::date - s.rn * 2 + 4, cs.id
       FROM homework h
       JOIN (SELECT id, row_number() OVER (ORDER BY code)::int AS rn FROM subjects WHERE tenant_id = $1) s
         ON s.id = h.subject_id AND s.rn <= 5
       JOIN class_sections cs ON cs.class_id = h.class_id AND cs.tenant_id = $1
      WHERE h.tenant_id = $1`,
    [tenantId, today],
  );
  await q(
    `INSERT INTO homework_submissions (tenant_id, assignment_id, student_id, status)
     SELECT $1, ha.id, st.id,
            (CASE WHEN h < 20 THEN 'NOT_SUBMITTED' WHEN h < 60 THEN 'SUBMITTED' ELSE 'DONE' END)::homework_submissions_status_enum
       FROM homework_assignments ha
       JOIN students st ON st.class_section_id = ha.section_id AND st.tenant_id = $1
       CROSS JOIN LATERAL (SELECT abs(hashtext(st.id::text || ha.id::text)) % 100 AS h) x
      WHERE ha.tenant_id = $1`,
    [tenantId],
  );

  // --- syllabus: 10 topics per class x subject, ~35% done / 20% in progress
  await q(
    `INSERT INTO syllabus_topics (tenant_id, class_id, subject_id, name, sequence, status)
     SELECT $1, c.id, s.id, 'Topic ' || t, t,
            (CASE WHEN h < 35 THEN 'DONE' WHEN h < 55 THEN 'IN_PROGRESS' ELSE 'PLANNED' END)::syllabus_topics_status_enum
       FROM classes c, subjects s, generate_series(1, 10) t
       CROSS JOIN LATERAL (SELECT abs(hashtext(c.id::text || s.id::text || t::text)) % 100 AS h) x
      WHERE c.tenant_id = $1 AND s.tenant_id = $1`,
    [tenantId],
  );

  // --- staff attendance: a register for every working day, every staff profile
  await q(`INSERT INTO staff_attendance_sessions (tenant_id, date) SELECT $1, unnest($2::date[])`, [
    tenantId,
    days,
  ]);
  await q(
    `INSERT INTO staff_attendance_records (tenant_id, session_id, staff_profile_id, status, check_in_at)
     SELECT $1, ss.id, sp.id,
            (CASE WHEN h < 88 THEN 'PRESENT' WHEN h < 94 THEN 'LATE' WHEN h < 98 THEN 'ABSENT' ELSE 'LEAVE' END)::attendance_status_enum,
            CASE WHEN h < 94 THEN ss.date::timestamptz + interval '8 hours' END
       FROM staff_attendance_sessions ss
       JOIN staff_profiles sp ON sp.tenant_id = ss.tenant_id
       CROSS JOIN LATERAL (SELECT abs(hashtext(sp.id::text || ss.date::text)) % 100 AS h) x
      WHERE ss.tenant_id = $1`,
    [tenantId],
  );

  // --- communication logs: 3 per student over the last 30 days, 2% FAILED, some QUEUED
  await q(
    `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body,
                                     status, trigger, student_id, created_at)
     SELECT $1, 'SMS', '000' || lpad(n::text, 8, '0'), 'Load Guardian ' || st.rn, 'Load test message ' || n,
            (CASE WHEN h < 2 THEN 'FAILED' WHEN h < 8 THEN 'QUEUED' ELSE 'SENT' END)::communication_logs_status_enum,
            'AUTOMATED'::communication_logs_trigger_enum, st.id,
            NOW() - (n % 30) * interval '1 day' - (n % 24) * interval '1 hour'
       FROM generate_series(1, $2::int) n
       JOIN (SELECT id, row_number() OVER (ORDER BY registration_number)::int AS rn FROM students WHERE tenant_id = $1) st
         ON st.rn = (n - 1) % $3::int + 1
       CROSS JOIN LATERAL (SELECT abs(hashtext(n::text)) % 100 AS h) x`,
    [tenantId, c.students * 3, c.students],
  );

  // --- admissions: 5 intakes on class 1, 600 applicants (~10 arrive today)
  await q(
    `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
     SELECT $1, ($2::uuid[])[n], 'Load intake ' || n, 40, $3::date - 30, $3::date + 30
       FROM generate_series(1, 5) n`,
    [tenantId, sectionIds, today],
  );
  await q(
    `INSERT INTO admission_applicants (tenant_id, intake_id, reference_number, applicant_name, date_of_birth,
                                       gender, guardian_name, guardian_phone, created_at, updated_at)
     SELECT $1, i.id, 'LA-' || n, 'Load Applicant ' || n, $2::date - 2200 - n,
            CASE WHEN n % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END, 'Load Guardian A' || n,
            '000' || lpad(n::text, 8, '0'),
            CASE WHEN n <= 10 THEN NOW() ELSE NOW() - (n % 30) * interval '1 day' END, NOW()
       FROM generate_series(1, 600) n
       JOIN (SELECT id, row_number() OVER (ORDER BY title)::int AS rn FROM admission_intakes WHERE tenant_id = $1) i
         ON i.rn = n % 5 + 1`,
    [tenantId, today],
  );

  // --- seat plans: one PUBLISHED (class 1's monthly test), one DRAFT (class 2's), 10 rooms
  await q(
    `INSERT INTO rooms (tenant_id, room_no) SELECT $1, 'R' || n FROM generate_series(1, 10) n`,
    [tenantId],
  );
  const plans = await q<{ id: string; status: string }>(
    `INSERT INTO seat_plans (tenant_id, name, seat_order_mode, status, published_at)
     VALUES ($1, 'Load seat plan A', 'SEQUENTIAL', 'PUBLISHED', NOW()),
            ($1, 'Load seat plan B', 'SEQUENTIAL', 'DRAFT', NULL)
     RETURNING id, status`,
    [tenantId],
  );
  const published = plans.find((p) => p.status === 'PUBLISHED')!.id;
  const draft = plans.find((p) => p.status === 'DRAFT')!.id;
  for (const [planId, grade] of [
    [published, 1],
    [draft, 2],
  ] as const) {
    await q(
      `INSERT INTO seat_plan_schedules (tenant_id, seat_plan_id, exam_schedule_id)
       SELECT $1, $2, es.id FROM exam_schedules es
         JOIN exams e ON e.id = es.exam_id AND e.status = 'DRAFT'
         JOIN classes c ON c.id = e.class_id AND c.numeric_grade = $3
        WHERE es.tenant_id = $1`,
      [tenantId, planId, grade],
    );
  }
  await q(
    `INSERT INTO seat_allocations (tenant_id, seat_plan_id, exam_schedule_id, student_id, room_id, seat_number)
     SELECT $1, $2, sps.exam_schedule_id, st.id, ($3::uuid[])[1 + (st.rn - 1) / 100 % 10],
            ((st.rn - 1) % 100 + 1)::text
       FROM seat_plan_schedules sps
       JOIN exam_schedules es ON es.id = sps.exam_schedule_id
       JOIN exams e ON e.id = es.exam_id
       JOIN (SELECT s.id, cs.class_id, row_number() OVER (PARTITION BY cs.class_id ORDER BY s.registration_number)::int AS rn
               FROM students s JOIN class_sections cs ON cs.id = s.class_section_id WHERE s.tenant_id = $1) st
         ON st.class_id = e.class_id
      WHERE sps.seat_plan_id = $2`,
    [
      tenantId,
      published,
      (
        await q<{ id: string }>(`SELECT id FROM rooms WHERE tenant_id = $1 ORDER BY room_no`, [
          tenantId,
        ])
      ).map((r) => r.id),
    ],
  );

  // --- leave: policies and ~3 records per staff profile, mixed statuses
  await q(
    `INSERT INTO leave_policies (tenant_id, leave_type, annual_quota_days)
     VALUES ($1, 'CASUAL', 10), ($1, 'SICK', 14), ($1, 'MATERNITY', 112), ($1, 'PATERNITY', 7),
            ($1, 'EARNED', 20)`,
    [tenantId],
  );
  await q(
    `INSERT INTO leave_records (tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status, reason)
     SELECT $1, sp.id, (CASE WHEN k % 2 = 0 THEN 'CASUAL' ELSE 'SICK' END)::leave_type_enum,
            $2::date - 3 - k * 17, $2::date - 3 - k * 17 + (k % 3), 1 + k % 3,
            (CASE WHEN k = 2 THEN 'PENDING' WHEN h < 8 THEN 'REJECTED' ELSE 'APPROVED' END)::leave_status_enum,
            'Load test leave'
       FROM staff_profiles sp, generate_series(0, 2) k
       CROSS JOIN LATERAL (SELECT abs(hashtext(sp.id::text || k::text)) % 100 AS h) x
      WHERE sp.tenant_id = $1`,
    [tenantId, today],
  );

  // --- routine: one published routine, a Day shift with 6 periods, Sun-Thu + Sat, no Friday
  const [{ id: routineId }] = await q<{ id: string }>(
    `INSERT INTO routines (tenant_id, academic_year_id, name, state, published_at)
     VALUES ($1, $2, 'Load routine', 'PUBLISHED', NOW()) RETURNING id`,
    [tenantId, yearId],
  );
  const [{ id: shiftId }] = await q<{ id: string }>(
    `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
     VALUES ($1, 'Day', '08:00', '13:00', 1) RETURNING id`,
    [tenantId],
  );
  await q(
    `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
     SELECT $1, $2, n, 'CLASS', time '08:00' + (n - 1) * interval '45 minutes',
            time '08:00' + n * interval '45 minutes' - interval '5 minutes'
       FROM generate_series(1, 6) n`,
    [tenantId, shiftId],
  );
  await q(
    `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id, recurrence, valid_from)
     SELECT $1, $2, cs.id, ps.id, wd, ($4::uuid[])[1 + (cs.rn + ps.sequence + wd) % 8], 'WEEKLY'::slot_recurrence_enum,
            (SELECT start_date FROM academic_years WHERE id = $3)
       FROM (SELECT id, row_number() OVER (ORDER BY class_id, section_name)::int AS rn FROM class_sections WHERE tenant_id = $1) cs
       CROSS JOIN (SELECT id, sequence::int AS sequence FROM period_slots WHERE shift_id = $5) ps
       CROSS JOIN unnest(ARRAY[0, 1, 2, 3, 4, 6]) wd`,
    [tenantId, routineId, yearId, subjectIds, shiftId],
  );
  await q(
    `INSERT INTO routine_slot_teachers (tenant_id, routine_slot_id, teacher_id)
     SELECT $1, rs.id, ($3::uuid[])[1 + (rs.rn % $4::int)]
       FROM (SELECT id, row_number() OVER ()::int AS rn FROM routine_slots WHERE routine_id = $2) rs`,
    [tenantId, routineId, teacherIds, nT],
  );
}
