import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GUARDIAN_OCCUPATIONS } from './occupations';
import { DHAKA_AREAS, ROAD_PATTERNS, SCHOOL_AREA } from './places';
import { NAME_POOLS, OTHER_GROUP_WEIGHTS, RELIGION_WEIGHTS, type NameGroup } from './names';
import {
  PERIODS_PER_DAY,
  SUBJECTS,
  TEACHER_ROSTER,
  TEACHING_DAYS_PER_WEEK,
  WEEKLY_PERIODS,
  type BranchKey,
} from './subjects-staffing';
import {
  ACR_PHRASES,
  ADMISSION_NOTES,
  CALENDAR_EVENTS,
  HOMEWORK_TITLES,
  INCIDENT_PHRASES,
  NOTICES,
  PROGRAM_NAMES,
} from './texts';
import { BD_PUBLIC_HOLIDAYS_BY_YEAR } from '../public-holidays-bd';

const BENGALI = /[ঀ-৿]/;
const ASCII = /^[\x20-\x7E]+$/;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Fails with the offending string, so a bad row is easy to find. */
function expectPairOk(p: { en: string; bn: string }) {
  expect({ s: p.en, ok: ASCII.test(p.en) }).toEqual({ s: p.en, ok: true });
  expect({ s: p.bn, ok: BENGALI.test(p.bn) }).toEqual({ s: p.bn, ok: true });
}
function expectBnOk(s: string) {
  expect({ s, ok: BENGALI.test(s) }).toEqual({ s, ok: true });
}

describe('demo-bn name pools', () => {
  // Minimum sizes per group: [boys, girls, surnames]
  const MIN: Record<NameGroup, [number, number, number]> = {
    MUSLIM: [150, 150, 60],
    HINDU: [40, 40, 25],
    BUDDHIST: [10, 10, 10],
    CHRISTIAN: [10, 10, 10],
    CHAKMA: [10, 10, 10],
    MARMA: [10, 10, 10],
  };

  for (const group of Object.keys(MIN) as NameGroup[]) {
    describe(group, () => {
      const pool = NAME_POOLS[group];

      it('has enough boys, girls and surnames', () => {
        const [b, g, s] = MIN[group];
        expect(pool.boys.length).toBeGreaterThanOrEqual(b);
        expect(pool.girls.length).toBeGreaterThanOrEqual(g);
        expect(pool.surnames.length).toBeGreaterThanOrEqual(s);
      });

      it('every en is ASCII and every bn is Bengali script', () => {
        for (const p of [...pool.boys, ...pool.girls, ...pool.surnames]) expectPairOk(p);
      });

      it('has no duplicate en/bn pair within a list', () => {
        for (const list of [pool.boys, pool.girls, pool.surnames]) {
          const keys = list.map((p) => `${p.en}|${p.bn}`);
          expect(new Set(keys).size).toBe(keys.length);
        }
      });

      it('has no duplicate en spelling within a list', () => {
        for (const list of [pool.boys, pool.girls, pool.surnames]) {
          const en = list.map((p) => p.en);
          expect(new Set(en).size).toBe(en.length);
        }
      });
    });
  }

  it('religion weights sum to 100, and so do the OTHER split weights', () => {
    expect(sum(Object.values(RELIGION_WEIGHTS))).toBe(100);
    expect(sum(Object.values(OTHER_GROUP_WEIGHTS))).toBe(100);
  });
});

describe('demo-bn places, occupations and texts', () => {
  it('places are ASCII en and Bengali bn', () => {
    for (const p of [SCHOOL_AREA, ...DHAKA_AREAS, ...ROAD_PATTERNS]) expectPairOk(p);
  });

  it('guardian occupation weights sum to 100', () => {
    for (const o of GUARDIAN_OCCUPATIONS) expectPairOk(o);
    expect(sum(GUARDIAN_OCCUPATIONS.map((o) => o.weight))).toBe(100);
  });

  it('every Bangla text is non-empty Bengali script', () => {
    for (const n of NOTICES) {
      expectBnOk(n.title);
      expectBnOk(n.body);
    }
    for (const list of Object.values(HOMEWORK_TITLES)) list.forEach(expectBnOk);
    for (const e of CALENDAR_EVENTS) expectPairOk(e);
    for (const p of PROGRAM_NAMES) expectPairOk(p);
    for (const list of [INCIDENT_PHRASES, ACR_PHRASES, ADMISSION_NOTES]) list.forEach(expectBnOk);
  });

  it('has homework titles for every subject', () => {
    for (const code of Object.keys(SUBJECTS))
      expect(HOMEWORK_TITLES[code]?.length).toBeGreaterThan(0);
  });
});

describe('demo-bn subjects and staffing', () => {
  const branches: BranchKey[] = ['PRIMARY', 'HIGH', 'COLLEGE'];

  it('subjects are ASCII en and Bengali bn', () => {
    for (const s of Object.values(SUBJECTS)) expectPairOk(s);
  });

  it('no class has more weekly periods than the branch can fit', () => {
    for (const b of branches) {
      for (const [cls, subjects] of Object.entries(WEEKLY_PERIODS[b])) {
        const total = sum(Object.values(subjects));
        expect({ b, cls, fits: total <= PERIODS_PER_DAY[b] * TEACHING_DAYS_PER_WEEK }).toEqual({
          b,
          cls,
          fits: true,
        });
      }
    }
  });

  it('roster sizes match D9 (13 / 18 / 8)', () => {
    expect(TEACHER_ROSTER.PRIMARY).toHaveLength(13);
    expect(TEACHER_ROSTER.HIGH).toHaveLength(18);
    expect(TEACHER_ROSTER.COLLEGE).toHaveLength(8);
  });

  it('every taught subject has a teacher, and College has some teachers covering 2 subjects', () => {
    for (const b of branches) {
      const covered = new Set(TEACHER_ROSTER[b].flatMap((t) => t.subjects));
      // D10: the shared ICT teacher sits in High but also covers College.
      for (const t of TEACHER_ROSTER.HIGH)
        if (t.alsoTeachesIn === b) t.subjects.forEach((s) => covered.add(s));
      const taught = new Set(Object.values(WEEKLY_PERIODS[b]).flatMap((c) => Object.keys(c)));
      for (const code of taught) {
        expect({ b, code, covered: covered.has(code) }).toEqual({ b, code, covered: true });
        expect(SUBJECTS[code]).toBeDefined();
      }
    }
    expect(TEACHER_ROSTER.COLLEGE.filter((t) => t.subjects.length === 2).length).toBeGreaterThan(0);
  });

  it('exactly one ICT teacher is shared between High and College (D10)', () => {
    const shared = TEACHER_ROSTER.HIGH.filter((t) => t.alsoTeachesIn === 'COLLEGE');
    expect(shared).toHaveLength(1);
    expect(shared[0].subjects).toEqual(['ICT']);
  });

  it('teacher slot keys are unique', () => {
    const keys = branches.flatMap((b) => TEACHER_ROSTER[b].map((t) => t.slot));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('BD public holidays 2016-2027', () => {
  const years = Array.from({ length: 12 }, (_, i) => 2016 + i);
  const isRealDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) && d.toISOString().startsWith(iso);
  };

  it('has a non-empty set for every year, with no gaps', () => {
    for (const y of years) expect(BD_PUBLIC_HOLIDAYS_BY_YEAR[y]?.length).toBeGreaterThan(5);
  });

  it('every entry is a valid date inside its year, ordered, with a Bengali name', () => {
    for (const y of years) {
      for (const h of BD_PUBLIC_HOLIDAYS_BY_YEAR[y]) {
        expect(isRealDate(h.date)).toBe(true);
        expect(isRealDate(h.end_date)).toBe(true);
        expect(h.date.startsWith(`${y}-`)).toBe(true);
        expect(h.end_date >= h.date).toBe(true);
        expect(BENGALI.test(h.name_bn)).toBe(true);
      }
    }
  });

  it('every historic year has Eid-ul-Fitr, Eid-ul-Azha and Durga Puja', () => {
    for (const y of years.filter((y) => y <= 2025)) {
      const names = BD_PUBLIC_HOLIDAYS_BY_YEAR[y].map((h) => h.name);
      expect(names).toEqual(
        expect.arrayContaining(['Eid-ul-Fitr', 'Eid-ul-Azha', 'Durga Puja (Vijaya Dashami)']),
      );
    }
  });

  it('spot checks: known dates', () => {
    const find = (y: number, name: string) =>
      BD_PUBLIC_HOLIDAYS_BY_YEAR[y].find((h) => h.name === name);
    expect(find(2019, 'Eid-ul-Fitr')?.date).toBe('2019-06-04');
    expect(find(2022, 'Eid-ul-Azha')?.date).toBe('2022-07-10');
    expect(find(2023, 'Ashura')?.date).toBe('2023-07-29');
    // The 17.2.6 sets must stay as they were; 58.1.04 only added older years.
    const eid2026 = find(2026, 'Eid-ul-Fitr');
    expect([eid2026?.date, eid2026?.end_date]).toEqual(['2026-03-20', '2026-03-22']);
  });
});

describe('demo avatars', () => {
  it('has 24 JPEGs, each under 30 KB', () => {
    for (let i = 1; i <= 24; i++) {
      const file = join(
        __dirname,
        '..',
        'demo-avatars',
        `avatar-${String(i).padStart(2, '0')}.jpg`,
      );
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(30 * 1024);
    }
  });
});
