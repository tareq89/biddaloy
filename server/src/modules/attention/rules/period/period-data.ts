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
 * resolve + one label query, however many sections. Times are the slot's own
 * dated times, so a special timing (#2290) moves them.
 */
export async function loadDaySlots(
  ds: DataSource,
  resolve: ResolveRoutineService,
  tenantId: string,
  date: string,
): Promise<DaySlot[]> {
  const slots = (await resolve.resolveTenantDay(tenantId, date)).filter((s) => !s.cancelled);
  if (!slots.length) return [];
  const sectionIds = [...new Set(slots.map((s) => s.section_id))];
  const labels: { id: string; label: string }[] = await ds.query(
    `SELECT cs.id, c.name || '-' || cs.section_name AS label
     FROM class_sections cs JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
     WHERE cs.tenant_id = $1 AND cs.id = ANY($2::uuid[])`,
    [tenantId, sectionIds],
  );
  const label = new Map(labels.map((l) => [l.id, l.label]));
  return slots.map((s) => ({
    ...s,
    startsAt: s.starts_at.slice(0, 5),
    endsAt: s.ends_at.slice(0, 5),
    sectionLabel: label.get(s.section_id) ?? '',
  }));
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
