import type { DataSource } from 'typeorm';
import type { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import type { ResolvedSlot } from '../../../routines/dto/resolve.dto';

export interface DaySlot extends ResolvedSlot {
  startsAt: string; // HH:mm
  endsAt: string; // HH:mm
  sectionLabel: string;
}

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Today's live (not cancelled) periods for the whole school: one routine
 * resolve + one period query + one label query, however many sections.
 */
export async function loadDaySlots(
  ds: DataSource,
  resolve: ResolveRoutineService,
  tenantId: string,
  date: string,
): Promise<DaySlot[]> {
  const slots = (await resolve.resolveTenantDay(tenantId, date)).filter((s) => !s.cancelled);
  if (!slots.length) return [];
  const periodIds = [...new Set(slots.map((s) => s.period_slot_id))];
  const sectionIds = [...new Set(slots.map((s) => s.section_id))];
  const [periods, labels]: [
    { id: string; starts_at: string; ends_at: string }[],
    { id: string; label: string }[],
  ] = await Promise.all([
    ds.query(
      `SELECT id, to_char(starts_at,'HH24:MI') AS starts_at, to_char(ends_at,'HH24:MI') AS ends_at
       FROM period_slots WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, periodIds],
    ),
    ds.query(
      `SELECT cs.id, c.name || '-' || cs.section_name AS label
       FROM class_sections cs JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
       WHERE cs.tenant_id = $1 AND cs.id = ANY($2::uuid[])`,
      [tenantId, sectionIds],
    ),
  ]);
  const period = new Map(periods.map((p) => [p.id, p]));
  const label = new Map(labels.map((l) => [l.id, l.label]));
  return slots.flatMap((s) => {
    const p = period.get(s.period_slot_id);
    if (!p) return [];
    return [
      {
        ...s,
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        sectionLabel: label.get(s.section_id) ?? '',
      },
    ];
  });
}

/** Active teachers of the tenant by teacher id. */
export async function loadTeachers(
  ds: DataSource,
  tenantId: string,
  teacherIds: string[],
): Promise<Map<string, { userId: string; staffProfileId: string | null }>> {
  if (!teacherIds.length) return new Map();
  const rows: { id: string; user_id: string; staff_profile_id: string | null }[] = await ds.query(
    `SELECT t.id, t.user_id, t.staff_profile_id
     FROM teachers t
     JOIN users u ON u.id = t.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
     WHERE t.tenant_id = $1 AND t.deleted_at IS NULL AND t.id = ANY($2::uuid[])`,
    [tenantId, teacherIds],
  );
  return new Map(
    rows.map((r) => [r.id, { userId: r.user_id, staffProfileId: r.staff_profile_id }]),
  );
}

export const earliest = (slots: DaySlot[]): DaySlot =>
  slots.reduce((a, b) => (b.startsAt < a.startsAt ? b : a));
