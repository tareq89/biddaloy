import { ApplicationAddressee, ApplicationType } from '@biddaloy/shared';
import type { EntityManager } from 'typeorm';
import { ApplicationLetterService, type LetterContext } from './application-letter.service';
import { LETTER_TEMPLATES, cleanText, fill } from './letter-templates';

const TENANT = 'tenant-a';

const baseCtx = (over: Partial<LetterContext> = {}): LetterContext => ({
  locale: 'bn',
  date: '2026-10-09',
  school_name: 'ঢাকা আদর্শ উচ্চ বিদ্যালয়',
  to_title: 'শ্রেণি শিক্ষক',
  applicant_name: 'রহিমা খাতুন',
  applicant_relation: 'অভিভাবক',
  serial: '2026/0045',
  subject_name: 'তানভীর হাসান',
  class_name: 'ষষ্ঠ শ্রেণি',
  section_name: 'ক শাখা',
  roll: '12',
  ref_names: {
    to_section_id: 'Class 7 · B',
    class_section_id: 'Class 7 · B',
    exam_id: 'Half-yearly',
    subject_id: 'Math',
  },
  days: 3,
  ...over,
});

// Every key any type's payload could carry, so no placeholder can stay empty by luck.
const fullPayload = {
  leave_type: 'SICK',
  reason_kind: 'SICK',
  start_date: '2026-10-12',
  end_date: '2026-10-14',
  reason: 'জ্বর',
  details: 'ডাক্তার বিশ্রাম নিতে বলেছেন।',
  purpose: 'চাকরি',
  kind: 'PERCENT',
  value: 50,
  fee_types: ['TUITION'],
  leaving_date: '2026-12-01',
  destination: 'Dhaka College',
  occurred_on: '2026-11-01',
  subject_line: 'বিষয়',
  body: 'বিস্তারিত',
};

const service = new ApplicationLetterService({} as never, {} as never);

describe('ApplicationLetterService.render', () => {
  it('renders all 10 types in bn and en with no leftover placeholder', () => {
    const types = Object.values(ApplicationType);
    expect(types).toHaveLength(10);
    for (const type of types) {
      for (const locale of ['bn', 'en'] as const) {
        const text = service.render(type, fullPayload, baseCtx({ locale }));
        expect(text, `${type}/${locale}`).not.toContain('{{');
        expect(text, `${type}/${locale}`).not.toContain('}}');
        expect(text.length, `${type}/${locale}`).toBeGreaterThan(40);
        expect(LETTER_TEMPLATES[type][locale], `${type}/${locale} template`).toBeTruthy();
      }
    }
  });

  it('matches the documented STUDENT_LEAVE bn example', () => {
    const text = service.render(
      ApplicationType.STUDENT_LEAVE,
      { ...fullPayload, reason_kind: 'SICK', details: 'জ্বর, ডাক্তার বিশ্রাম নিতে বলেছেন।' },
      baseCtx(),
    );
    expect(text).toBe(
      [
        'তারিখ: ০৯/১০/২০২৬',
        'বরাবর',
        'শ্রেণি শিক্ষক',
        'ঢাকা আদর্শ উচ্চ বিদ্যালয়',
        '',
        'বিষয়: ছুটির আবেদন',
        '',
        'জনাব,',
        'আমার সন্তান তানভীর হাসান, ষষ্ঠ শ্রেণি ক শাখা, রোল ১২, অসুস্থতার কারণে ১২/১০/২০২৬ থেকে ১৪/১০/২০২৬ পর্যন্ত বিদ্যালয়ে উপস্থিত থাকতে পারবে না। জ্বর, ডাক্তার বিশ্রাম নিতে বলেছেন।',
        '',
        'বিনীত',
        'রহিমা খাতুন',
        'অভিভাবক',
        'আবেদন নং: 2026/0045',
      ].join('\n'),
    );
  });

  it('keeps the serial Latin in bn while dates use Bangla digits (D47)', () => {
    const text = service.render(ApplicationType.GENERAL, fullPayload, baseCtx());
    expect(text).toContain('আবেদন নং: 2026/0045');
    expect(text).toContain('তারিখ: ০৯/১০/২০২৬');
  });

  it('drops the serial line when serial is null (preview)', () => {
    const text = service.render(ApplicationType.GENERAL, fullPayload, baseCtx({ serial: null }));
    expect(text).not.toContain('আবেদন নং');
    expect(text.endsWith('অভিভাবক')).toBe(true);
  });

  it('en school gets ASCII digits and English labels', () => {
    const text = service.render(
      ApplicationType.GENERAL,
      fullPayload,
      baseCtx({ locale: 'en', to_title: 'Headmaster', applicant_relation: 'Guardian' }),
    );
    expect(text).toContain('Date: 09/10/2026');
    expect(text).toContain('Application no.: 2026/0045');
    expect(text).not.toMatch(/[০-৯]/);
  });

  it('STAFF_LEAVE shows the working days from the context', () => {
    const text = service.render(ApplicationType.STAFF_LEAVE, fullPayload, baseCtx({ days: 3 }));
    expect(text).toContain('(৩ কর্মদিবস)');
  });

  it('FEE_WAIVER shows the requested value from the payload', () => {
    const text = service.render(
      ApplicationType.FEE_WAIVER,
      { ...fullPayload, kind: 'PERCENT', value: 50 },
      baseCtx({ locale: 'en', to_title: 'Headmaster' }),
    );
    expect(text).toContain('waiver of 50%');
    const flat = service.render(
      ApplicationType.FEE_WAIVER,
      { ...fullPayload, kind: 'FLAT', value: 1200 },
      baseCtx({ locale: 'en' }),
    );
    expect(flat).toContain('waiver of 1200 BDT');
  });

  // Safety: user text is plain text and never re-expanded.
  describe('user-supplied values', () => {
    const evil = {
      subject_line: 'Hi<script>alert(1)</script>\r',
      body: 'a\r\nb\u0000\u0007c\u202Ed {{school}} {{sign}} <b>x</b>',
    };

    it('strips \\r, control chars, bidi overrides and angle brackets', () => {
      const text = service.render(ApplicationType.GENERAL, evil, baseCtx({ locale: 'en' }));
      expect(text).not.toContain('\r');
      expect(text).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u202E<>]/);
      expect(text).toContain('Subject: Hiscriptalert(1)/script');
      expect(text).toContain('a\nbc');
    });

    it('does not re-expand {{placeholders}} typed by the user', () => {
      const ctx = baseCtx({ locale: 'en', school_name: 'Real School' });
      const text = service.render(ApplicationType.GENERAL, evil, ctx);
      // The literal text survives; it was not replaced by the school name or signature.
      expect(text).toContain('d {{school}} {{sign}} bx/b');
      expect(text.match(/Real School/g)).toHaveLength(1);
    });

    it('also cleans names coming from the context (e.g. the applicant name)', () => {
      const text = service.render(
        ApplicationType.GENERAL,
        fullPayload,
        baseCtx({ applicant_name: '<img src=x onerror=1>Bob\r' }),
      );
      expect(text).not.toMatch(/[<>\r]/);
    });
  });
});

describe('letter-templates helpers', () => {
  it('fill is single pass and blanks unknown keys', () => {
    expect(fill('{{a}} {{b}} {{c}}', { a: '{{b}}', b: 'B' })).toBe('{{b}} B ');
  });
  it('cleanText handles non-strings', () => {
    expect(cleanText(null)).toBe('');
    expect(cleanText(42)).toBe('42');
  });
});

describe('ApplicationLetterService.buildContext', () => {
  const calendar = { getWorkingDays: vi.fn() };
  const schools = { getResolvedSettings: vi.fn() };
  const svc = new ApplicationLetterService(schools as never, calendar as never);

  // Routes by SQL fragment; every call is recorded so we can assert the tenant filter.
  let calls: Array<{ sql: string; params: unknown[] }>;
  let tables: Record<string, unknown[]>;
  // One distinct name per user id, so addressee and applicant can never be confused.
  let userNames: Record<string, string>;
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('FROM users u')) {
        const name = userNames[params[1] as string];
        return name ? [{ full_name: name }] : [];
      }
      const key = Object.keys(tables).find((k) => sql.includes(k));
      return key ? tables[key] : [];
    }),
  } as unknown as EntityManager;

  const studentRow = {
    user_id: 'u-student',
    full_name: 'Tanvir Hasan',
    full_name_bn: 'তানভীর হাসান',
    roll: '12',
    section_name: 'ক শাখা',
    class_name: 'ষষ্ঠ শ্রেণি',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    userNames = { 'u-parent': 'Rahima Khatun', 'u-staff': 'Karim Addressee' };
    tables = {
      'FROM schools': [{ name: 'Dhaka Model', name_bn: 'ঢাকা আদর্শ' }],
      'FROM students': [studentRow],
      'FROM staff_profiles': [{ full_name: 'Karim Sir' }],
    };
    schools.getResolvedSettings.mockResolvedValue({ region: { locale: 'bn-BD' } });
    calendar.getWorkingDays.mockResolvedValue({ dates: [], count: 3 });
  });

  const studentLeave = {
    type: ApplicationType.STUDENT_LEAVE,
    payload: { ...fullPayload },
    subject_student_id: 'st-1',
    applicant_user_id: 'u-parent',
    serial: null,
    date: '2026-10-09',
  };

  it('bn-BD school -> locale bn, bn names, guardian relation, final-step title', async () => {
    const ctx = await svc.buildContext(manager, TENANT, studentLeave);
    expect(ctx).toMatchObject({
      locale: 'bn',
      school_name: 'ঢাকা আদর্শ',
      subject_name: 'তানভীর হাসান',
      applicant_name: 'Rahima Khatun',
      applicant_relation: 'অভিভাবক',
      to_title: 'শ্রেণি শিক্ষক',
      roll: '12',
      days: 3,
    });
    expect(calendar.getWorkingDays).toHaveBeenCalledWith({
      tenantId: TENANT,
      from: '2026-10-12',
      to: '2026-10-14',
    });
  });

  it('en-BD school -> locale en and English names (language follows the school, D40)', async () => {
    schools.getResolvedSettings.mockResolvedValue({ region: { locale: 'en-BD' } });
    const ctx = await svc.buildContext(manager, TENANT, studentLeave);
    expect(ctx.locale).toBe('en');
    expect(ctx.school_name).toBe('Dhaka Model');
    expect(ctx.subject_name).toBe('Tanvir Hasan');
    expect(ctx.applicant_relation).toBe('Guardian');
  });

  it('paper applicant with no login: name-only signature, guardian relation (D46)', async () => {
    const ctx = await svc.buildContext(manager, TENANT, {
      ...studentLeave,
      applicant_user_id: null,
      applicant_name: 'Salma Begum',
    });
    expect(ctx.applicant_name).toBe('Salma Begum');
    expect(ctx.applicant_relation).toBe('অভিভাবক');
  });

  it('the student applying for themself has no relation line', async () => {
    const ctx = await svc.buildContext(manager, TENANT, {
      ...studentLeave,
      applicant_user_id: 'u-student',
    });
    expect(ctx.applicant_relation).toBe('');
  });

  it('FEE_WAIVER is addressed to the Headmaster (final step), not the Class Teacher', async () => {
    const ctx = await svc.buildContext(manager, TENANT, {
      ...studentLeave,
      type: ApplicationType.FEE_WAIVER,
    });
    expect(ctx.to_title).toBe('প্রধান শিক্ষক');
    expect(ctx.days).toBeNull();
    expect(calendar.getWorkingDays).not.toHaveBeenCalled();
  });

  it('GENERAL with STAFF_USER addresses that user by name', async () => {
    const ctx = await svc.buildContext(manager, TENANT, {
      type: ApplicationType.GENERAL,
      payload: { subject_line: 's', body: 'b' },
      addressee: ApplicationAddressee.STAFF_USER,
      addressee_user_id: 'u-staff',
      applicant_user_id: 'u-parent',
      serial: null,
      date: '2026-10-09',
    });
    expect(ctx.to_title).toBe('Karim Addressee'); // addressee's name, not the applicant's
  });

  it('GENERAL with HEADMASTER maps to the Headmaster title', async () => {
    const ctx = await svc.buildContext(manager, TENANT, {
      type: ApplicationType.GENERAL,
      payload: {},
      addressee: ApplicationAddressee.HEADMASTER,
      applicant_user_id: 'u-parent',
      serial: null,
      date: '2026-10-09',
    });
    expect(ctx.to_title).toBe('প্রধান শিক্ষক');
  });

  it('STAFF_LEAVE uses the staff name as subject and no relation', async () => {
    const ctx = await svc.buildContext(manager, TENANT, {
      type: ApplicationType.STAFF_LEAVE,
      payload: fullPayload,
      subject_staff_profile_id: 'sp-1',
      applicant_user_id: 'u-staff',
      serial: '2026/0001',
      date: '2026-10-09',
    });
    expect(ctx.subject_name).toBe('Karim Sir');
    expect(ctx.applicant_relation).toBe('');
    expect(ctx.days).toBe(3);
  });

  it('loads ref names for section / exam / subject', async () => {
    tables['FROM class_sections cs JOIN'] = [{ name: 'Class 7 · B' }];
    tables['FROM exams'] = [{ name: 'Half-yearly' }];
    tables['FROM subjects'] = [{ name: 'গণিত' }];
    const ctx = await svc.buildContext(manager, TENANT, {
      ...studentLeave,
      type: ApplicationType.SCRIPT_RECHECK,
      payload: { exam_id: 'e1', subject_id: 'sub1', to_section_id: 'cs1' },
    });
    expect(ctx.ref_names).toEqual({
      to_section_id: 'Class 7 · B',
      exam_id: 'Half-yearly',
      subject_id: 'গণিত',
    });
  });

  it('every lookup filters tenant_id (tenant isolation)', async () => {
    tables['FROM class_sections cs JOIN'] = [{ name: 'x' }];
    tables['FROM exams'] = [{ name: 'x' }];
    tables['FROM subjects'] = [{ name: 'x' }];
    await svc.buildContext(manager, TENANT, {
      ...studentLeave,
      addressee: ApplicationAddressee.STAFF_USER,
      addressee_user_id: 'u-staff',
      subject_staff_profile_id: 'sp-1',
      payload: { ...fullPayload, exam_id: 'e1', subject_id: 'sub1', to_section_id: 'cs1' },
    });
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const c of calls) {
      const filtered =
        /tenant_id\s*=\s*\$1/.test(c.sql) || /FROM schools WHERE id = \$1/.test(c.sql);
      expect(filtered, c.sql).toBe(true);
      expect(c.params[0], c.sql).toBe(TENANT);
    }
  });
});
