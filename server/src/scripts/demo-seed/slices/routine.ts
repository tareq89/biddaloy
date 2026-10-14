import { PeriodSlotKind, SlotRecurrence, TeacherAssignmentType } from '@biddaloy/shared';
import { Routine } from '../../../modules/routines/entities/routine.entity';
import { RoutineSlot } from '../../../modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../../../modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../../../modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../../../modules/routines/entities/routine-change-request.entity';
import { TeacherClassSection } from '../../../modules/academics/entities/teacher-class-section.entity';
import { RoutineService } from '../../../modules/routines/routine.service';
import { RoutineSlotsService } from '../../../modules/routines/routine-slots.service';
import { RoutineStateService } from '../../../modules/routines/routine-state.service';
import { SubstitutionsService } from '../../../modules/routines/substitutions.service';
import { ChangeRequestsService } from '../../../modules/routines/change-requests.service';
import { WEEKLY_PERIODS, type BranchKey } from '../../seed-data/demo-bn/subjects-staffing';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { todayAt } from '../dates';
import { orgIds, type OrgTenant } from './org';
import { staffByCardKey, teachersByTenant, type StaffTeacher } from './staff';

/** Preset subject name (HSC suffix dropped) -> the code `WEEKLY_PERIODS` uses. Others are not timetabled. */
const CODE_OF: Record<string, string> = {
  Bangla: 'BAN',
  English: 'ENG',
  Mathematics: 'MATH',
  Science: 'SCI',
  'Bangladesh and Global Studies': 'BGS',
  // One religion period per cell: the Islam subject stands for the religion block (ceiling: no
  // parallel Hindu / Buddhist / Christian slots, a section holds one slot per period).
  'Islam and Moral Education': 'REL',
  'Information and Communication Technology': 'ICT',
  'Arts and Crafts': 'ART',
  'Physical Education and Health': 'PE',
  'Agricultural Education': 'AGR',
  Physics: 'PHY',
  Chemistry: 'CHEM',
  Biology: 'BIO',
  Accounting: 'ACC',
  'Business Organisation and Management': 'BORG',
  'Finance and Banking': 'FIN',
};
/** Saturday..Thursday (0 = Sunday); Friday is the off day. */
const WEEK = [6, 0, 1, 2, 3, 4];
/** D9: at most 5 periods a day on average = 30 a week. */
const WEEKLY_CAP = 30;
/** A teacher outside the subject is picked only when the subject's own teachers are this much busier. */
const OFF_SUBJECT_PENALTY = 5;
const ROMAN: Record<number, string> = { 11: 'XI', 12: 'XII' };

interface Planned {
  ci: number;
  si: number;
  weekday: number;
  period: number; // index into the tenant's CLASS periods
  subjectId: string;
  teacher: StaffTeacher;
}
interface Interval {
  weekday: number;
  start: string;
  end: string;
}

export const slice: DemoSlice = {
  name: 'routine',
  covers: [RoutineSlot, RoutineSlotTeacher, Routine, RoutineSubstitution, RoutineChangeRequest],
  run: async (ctx) => {
    const org = orgIds(ctx);
    const staff = teachersByTenant(ctx);
    const slots = ctx.app.get(RoutineSlotsService);
    const adminId = org.adminUserId;
    const q = <T>(sql: string, args: unknown[]): Promise<T[]> => ctx.ds.query(sql, args);

    // The one teacher in two branches: its intervals are checked across branches.
    const branchCount = new Map<string, number>();
    for (const list of staff.values()) {
      for (const t of list) branchCount.set(t.userId, (branchCount.get(t.userId) ?? 0) + 1);
    }
    const shared = new Set([...branchCount].filter(([, n]) => n > 1).map(([id]) => id));
    const sharedBusy: Interval[] = [];
    const load = new Map<string, number>(); // userId -> periods a week

    let rows = 0;
    const created: {
      tenant: OrgTenant;
      yearIdx: number;
      sectionId: string;
      weekday: number;
      period: number;
      slotId: string;
      teacher: StaffTeacher;
    }[] = [];
    const busyByTenant = new Map<string, Set<string>>();

    for (const tenant of org.tenants) {
      const teachers = staff.get(tenant.id)!;
      const cur = tenant.years[tenant.years.length - 1];
      const periods = tenant.periodSlots
        .filter((p) => p.kind === PeriodSlotKind.CLASS)
        .sort((a, b) => a.sequence - b.sequence);
      const times = new Map(
        (
          await q<{ id: string; starts_at: string; ends_at: string }>(
            `SELECT id, starts_at, ends_at FROM period_slots WHERE tenant_id = $1`,
            [tenant.id],
          )
        ).map((p) => [p.id, p] as const),
      );
      const subjects = await q<{
        class_id: string;
        subject_id: string;
        name_en: string;
        group_name: string | null;
      }>(
        `SELECT cs.class_id, cs.subject_id, s.name_en, cs.group_name
           FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
          WHERE cs.tenant_id = $1 AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL
          ORDER BY s.code`,
        [tenant.id, cur.id],
      );

      // --- the weekly grid, planned once per branch and repeated for each year -------------
      const busy = new Set<string>(); // `${userId}|${weekday}|${period}`
      busyByTenant.set(tenant.id, busy);
      const free = (t: StaffTeacher, weekday: number, p: number) => {
        if (busy.has(`${t.userId}|${weekday}|${p}`)) return false;
        if (!shared.has(t.userId)) return true;
        const { starts_at: start, ends_at: end } = times.get(periods[p].id)!;
        return !sharedBusy.some((i) => i.weekday === weekday && i.start < end && start < i.end);
      };
      const pick = (code: string, weekday: number, p: number) => {
        const ok = teachers.filter((t) => free(t, weekday, p));
        const under = ok.filter((t) => (load.get(t.userId) ?? 0) < WEEKLY_CAP);
        const pool = under; // hard cap: a full grid with no teacher under 30 a week throws below
        const score = (t: StaffTeacher) =>
          (load.get(t.userId) ?? 0) + (t.subjects.includes(code) ? 0 : OFF_SUBJECT_PENALTY);
        return pool.sort((a, b) => score(a) - score(b))[0] ?? null;
      };

      const sections = cur.classes.flatMap((cls, ci) =>
        cls.sections.map((sec, si) => ({ ci, si, cls, sec })),
      );
      const cells = WEEK.length * periods.length;
      const demand = sections.map(({ cls, sec }) => {
        // Class 9-10 sections A/B carry no group of their own: they take the science subjects.
        const group = sec.group ?? 'Science';
        const key =
          tenant.kind === 'COLLEGE' ? `${ROMAN[cls.numericGrade]} ${sec.group}` : cls.name;
        const table = WEEKLY_PERIODS[tenant.kind as BranchKey][key];
        if (!table) throw new Error(`routine: no weekly periods for ${tenant.kind} "${key}"`);
        const seen = new Set<string>();
        const want: { subjectId: string; code: string; n: number }[] = [];
        for (const s of subjects) {
          if (s.class_id !== cls.id || (s.group_name && s.group_name !== group)) continue;
          const code = CODE_OF[s.name_en.replace(/ \(HSC\)$/, '')];
          if (!code || !table[code] || seen.has(code)) continue;
          seen.add(code);
          want.push({ subjectId: s.subject_id, code, n: table[code] });
        }
        if (!want.length) throw new Error(`routine: no timetabled subjects for "${key}"`);
        // The preset lacks some timetable subjects (Arts, PE in Primary), so top up or trim to fill
        // exactly the grid: extra periods go to the biggest subjects first.
        let total = want.reduce((n, w) => n + w.n, 0);
        const bySize = () => [...want].sort((a, b) => b.n - a.n);
        for (let i = 0; total < cells; i++, total++) bySize()[i % want.length].n++;
        for (; total > cells; total--) bySize()[0].n--;
        return want.map((w) => ({ ...w, left: w.n, cap: Math.ceil(w.n / WEEK.length) }));
      });

      const planned: Planned[] = [];
      for (const weekday of WEEK) {
        const today = sections.map(() => new Map<string, number>());
        for (let p = 0; p < periods.length; p++) {
          for (let k = 0; k < sections.length; k++) {
            const idx = (k + weekday + p) % sections.length; // rotate who picks first
            const want = demand[idx];
            let done = false;
            // First pass keeps a subject to its fair share of the day; second pass drops that.
            for (const spread of [true, false]) {
              for (const w of [...want].sort((a, b) => b.left - a.left)) {
                if (w.left <= 0 || (spread && (today[idx].get(w.code) ?? 0) >= w.cap)) continue;
                const t = pick(w.code, weekday, p);
                if (!t) continue;
                busy.add(`${t.userId}|${weekday}|${p}`);
                load.set(t.userId, (load.get(t.userId) ?? 0) + 1);
                if (shared.has(t.userId)) {
                  const { starts_at: start, ends_at: end } = times.get(periods[p].id)!;
                  sharedBusy.push({ weekday, start, end });
                }
                w.left--;
                today[idx].set(w.code, (today[idx].get(w.code) ?? 0) + 1);
                planned.push({
                  ci: sections[idx].ci,
                  si: sections[idx].si,
                  weekday,
                  period: p,
                  subjectId: w.subjectId,
                  teacher: t,
                });
                done = true;
                break;
              }
              if (done) break;
            }
            if (!done) {
              throw new Error(
                `routine: no free teacher for ${tenant.slug} ${sections[idx].cls.name} weekday ${weekday} period ${p + 1}`,
              );
            }
          }
        }
      }

      // --- save the last two years through the real slot service (it validates every slot) ---
      const saved = tenant.years.slice(-2); // one year when --years 1
      for (const [offset, year] of saved.entries()) {
        const yearIdx = tenant.years.length - saved.length + offset;
        const routine = await ctx.app
          .get(RoutineService)
          .create({ academic_year_id: year.id, name: `${year.name} Routine` }, tenant.id);
        rows++;

        // Subject-teacher assignments the constraint check requires (class-teacher rows already exist).
        // Older years may have fewer classes or sections than the current one: index by name and
        // skip what that year lacks.
        const sectionOf = (pl: Planned) => {
          const mine = cur.classes[pl.ci];
          return year.classes
            .find((c) => c.name === mine.name)
            ?.sections.find((s) => s.name === mine.sections[pl.si].name);
        };
        const usable = planned.flatMap((pl) => {
          const section = sectionOf(pl);
          return section ? [{ pl, section }] : [];
        });
        const pairs = new Map<string, Record<string, unknown>>();
        for (const { pl, section } of usable) {
          const sectionId = section.id;
          pairs.set(`${pl.teacher.teacherId}|${sectionId}|${pl.subjectId}`, {
            teacher_id: pl.teacher.teacherId,
            section_id: sectionId,
            tenant_id: tenant.id,
            subject_id: pl.subjectId,
            assignment_type: TeacherAssignmentType.SUBJECT_TEACHER,
          });
        }
        rows += await insertChunked(ctx.ds.getRepository(TeacherClassSection), [
          ...pairs.values(),
        ] as never);

        const base = (pl: Planned, section: { id: string }) => {
          return {
            section_id: section.id,
            period_slot_id: periods[pl.period].id,
            weekday: pl.weekday,
            subject_id: pl.subjectId,
            room_id: tenant.rooms.find((r) => r.sectionId === section.id)?.id ?? null,
            recurrence: SlotRecurrence.WEEKLY,
            recurrence_offset: 0,
            valid_from: year.start,
            valid_to: year.isCurrent ? null : year.end,
          };
        };
        if (year.isCurrent) {
          // The newest year goes through the real slot service: it checks every slot (D4).
          // ponytail: 8 at a time (the planned grid is clash-free, so no create can see a
          // half-written neighbour); fully serial costs ~60 s at scale 1.
          for (let i = 0; i < usable.length; i += 8) {
            const batch = usable.slice(i, i + 8);
            const results = await Promise.all(
              batch.map(({ pl, section }) =>
                slots.create(
                  routine.id,
                  { ...base(pl, section), teacher_ids: [pl.teacher.teacherId] },
                  tenant.id,
                  adminId,
                ),
              ),
            );
            batch.forEach(({ pl, section }, j) => {
              rows += 2;
              created.push({
                tenant,
                yearIdx,
                sectionId: section.id,
                weekday: pl.weekday,
                period: pl.period,
                slotId: results[j].slot.id,
                teacher: pl.teacher,
              });
            });
          }
        } else {
          // Older years repeat the same checked grid, so they are bulk-inserted (D38, 90 s budget).
          const slotRows = usable.map(({ pl, section }) => ({
            id: ctx.rng.string.uuid(),
            routine_id: routine.id,
            tenant_id: tenant.id,
            ...base(pl, section),
          }));
          rows += await insertChunked(ctx.ds.getRepository(RoutineSlot), slotRows as never);
          rows += await insertChunked(
            ctx.ds.getRepository(RoutineSlotTeacher),
            slotRows.map((r, i) => ({
              routine_slot_id: r.id,
              tenant_id: tenant.id,
              teacher_id: usable[i].pl.teacher.teacherId,
            })) as never,
          );
        }

        const state = ctx.app.get(RoutineStateService);
        const context = { ip: null, userAgent: null };
        await state.submitForReview(routine.id, tenant.id, adminId, context);
        await state.publish(routine.id, tenant.id, adminId, context);
        // The service stamps the wall clock; the demo's "now" is the anchor (same data every run).
        await ctx.ds.query(`UPDATE routines SET published_at = $1 WHERE id = $2`, [
          todayAt(ctx.anchor, 8),
          routine.id,
        ]);
      }
    }

    // --- load check (D9) and table ----------------------------------------------------------
    console.log('routine load (periods / teaching day):');
    const bad: string[] = [];
    for (const t of org.tenants) {
      for (const x of staff.get(t.id)!) {
        // The shared ICT teacher's load already sums High and College: check it once, under High.
        if (t.kind === 'COLLEGE' && shared.has(x.userId)) continue;
        const perDay = (load.get(x.userId) ?? 0) / WEEK.length;
        console.log(`  ${t.kind.padEnd(7)} ${x.slot}  ${perDay.toFixed(2)}`);
        const min = t.kind === 'COLLEGE' ? 2.5 : 3;
        if (perDay < min || perDay > 5) bad.push(`${t.kind} ${x.slot} ${perDay.toFixed(2)}`);
      }
    }
    if (bad.length)
      throw new Error(`routine: teacher load outside D9 (3-5/day): ${bad.join(', ')}`);

    // --- today (D15): one substitution, one change request ----------------------------------
    const high = org.tenants.find((t) => t.kind === 'HIGH')!;
    const highYear = high.years.length - 1;
    const dayMs = 86_400_000;
    // The anchor can be a Friday (off day): cover the first school day from the anchor on.
    let date = ctx.anchor;
    while (!WEEK.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
      date = new Date(Date.parse(date) + dayMs).toISOString().slice(0, 10);
    }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const second = created.find(
      (c) =>
        c.tenant.id === high.id &&
        c.yearIdx === highYear &&
        c.weekday === weekday &&
        c.period === 1 &&
        !shared.has(c.teacher.userId),
    );
    if (!second)
      throw new Error(`routine: no unshared High slot at period 2 on weekday ${weekday}`);
    const highBusy = busyByTenant.get(high.id)!;
    const cover = staff
      .get(high.id)!
      .find(
        (t) =>
          t.userId !== second.teacher.userId &&
          !shared.has(t.userId) &&
          !highBusy.has(`${t.userId}|${weekday}|1`),
      );
    if (!cover) throw new Error('routine: nobody is free to cover the substitution');
    await ctx.app.get(SubstitutionsService).record(
      {
        routine_slot_id: second.slotId,
        date,
        substitute_teacher_id: cover.teacherId,
        reason: 'Teacher on leave',
      },
      high.id,
      adminId,
    );
    const card = staffByCardKey(ctx).get('class-teacher-8a')!;
    const sec8a = high.years[highYear].classes
      .find((c) => c.name === 'Class 8')!
      .sections.find((s) => s.name === 'A')!;
    // The note asks to move the last period of the day, so flag a slot in the last period.
    const flagged = created
      .filter((c) => c.tenant.id === high.id && c.yearIdx === highYear && c.sectionId === sec8a.id)
      .sort((a, b) => b.period - a.period)[0];
    if (!flagged) throw new Error('routine: Class 8-A has no slot to flag');
    await ctx.app
      .get(ChangeRequestsService)
      .open(
        flagged.slotId,
        { note: 'Please move this period away from the last slot of the day.' },
        high.id,
        card.userId,
      );
    rows += 2;
    // 58.3.01 marks the covered teacher on leave for this date.
    ctx.ids.set('routineToday', {
      tenantId: high.id,
      date,
      coveredTeacherId: second.teacher.teacherId,
      coveredUserId: second.teacher.userId,
      substituteTeacherId: cover.teacherId,
      slotId: second.slotId,
    });
    return rows;
  },
};
