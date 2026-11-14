import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ALL_TABS } from '../codec/registry';
import { INSERT_ONLY_TABS } from '../codec/insert-only-tabs';
import { softDeletedRowIds } from '../codec/soft-deleted';
import type { TabSpec } from '../codec/tab-spec';
import type { ValidatedWorkbook } from './validated-workbook';
import type { RowError } from '../codec/tab-spec';
import { getSeatUsage } from '../../schools/trial/seat-limit.service';
import { EnrollmentStatus } from '@biddaloy/shared';
import type { DiffCounts, DiffReport, TabDiff } from './diff-report';

const SAMPLE_SIZE = 5;

const emptyCounts = (): DiffCounts => ({ creates: 0, updates: 0, unchanged: 0, deletes: 0 });

/**
 * Compares an already-validated workbook against the destination's current
 * data, tab by tab.
 *
 * Deliberately downstream of `ValidationService` rather than folded into it:
 * validation answers "is this workbook well-formed", diffing answers "what
 * would applying it change", and a caller may want the first without ever
 * paying for the second (e.g. a validate-only preflight). Like validation,
 * this reads only — matching an accepted row to an existing entity and
 * comparing fields never calls `upsert`/`remove`/`save`.
 */
@Injectable()
export class DiffService {
  async diff(
    validated: ValidatedWorkbook,
    tenantId: string,
    manager: EntityManager,
    // Overridable only for tests, exactly like `ValidationService.validate`.
    tabSpecs: readonly TabSpec<any, any>[] = ALL_TABS,
  ): Promise<DiffReport> {
    const tabs: TabDiff[] = [];
    const totals = emptyCounts();
    let presentNonSchoolTabsHaveRows = false;
    const diffErrors: RowError[] = [];

    for (const tabSpec of tabSpecs) {
      const validatedTab = validated.tabs[tabSpec.name];

      if (!validatedTab || !validatedTab.present) {
        tabs.push({
          name: tabSpec.name,
          present: false,
          ...emptyCounts(),
          changedFields: {},
          errors: validatedTab?.errors ?? [],
          warnings: validatedTab?.warnings ?? [],
          samples: { creates: [], updates: [], deletes: [] },
        });
        continue;
      }

      const existing: any[] = await tabSpec.load(tenantId, manager);
      if (tabSpec.name !== 'school' && existing.length > 0) {
        presentNonSchoolTabsHaveRows = true;
      }

      // [#688] A row naming a soft-deleted row of this school is revived by the restore: an update.
      const revivable = await softDeletedRowIds(tabSpec, validatedTab.rows, tenantId, manager);
      const existingById = new Map<string, any>();
      const existingByKey = new Map<string, any>();
      for (const entity of existing) {
        const id: unknown = (entity as { id?: unknown }).id;
        if (typeof id === 'string') existingById.set(id, entity);
        existingByKey.set(tabSpec.keyOf(entity), entity);
      }

      const counts = emptyCounts();
      const changedFields: Record<string, number> = {};
      const samples: TabDiff['samples'] = { creates: [], updates: [], deletes: [] };
      const matchedIds = new Set<string>();
      const claimedBy = new Map<string, string>(); // matched entity id -> key of the row that took it
      let newSeats = 0; // students tab only: rows that end ACTIVE and were not an active seat
      const isActive = (x: unknown) =>
        (x as { enrollment_status?: string }).enrollment_status === EnrollmentStatus.ACTIVE;

      for (const row of validatedTab.rows) {
        const rowId = (row as { id?: unknown }).id;
        const matched =
          (typeof rowId === 'string' && existingById.get(rowId)) ||
          existingByKey.get(tabSpec.keyOf(row as any));

        if (isActive(row) && (!matched || !isActive(matched))) newSeats++;
        if (!matched && typeof rowId === 'string' && revivable.has(rowId)) {
          counts.updates++;
          if (samples.updates.length < SAMPLE_SIZE) samples.updates.push(tabSpec.keyOf(row as any));
          continue;
        }
        if (!matched) {
          counts.creates++;
          if (samples.creates.length < SAMPLE_SIZE) samples.creates.push(tabSpec.keyOf(row as any));
          continue;
        }

        const matchedId: unknown = (matched as { id?: unknown }).id;
        if (typeof matchedId === 'string') {
          // [#690] A second row claiming an entity another row already matched would be counted
          // as a second update: refuse it, naming both rows.
          const first = claimedBy.get(matchedId);
          if (first !== undefined) {
            diffErrors.push({
              tab: tabSpec.name,
              row: 0,
              column: null,
              severity: 'error',
              message: `Rows "${first}" and "${tabSpec.keyOf(row as any)}" both match the same existing row. Give them distinct rows or remove one.`,
            });
            continue;
          }
          claimedBy.set(matchedId, tabSpec.keyOf(row as any));
          matchedIds.add(matchedId);
        }

        const changed = tabSpec.diffFields(row as any, matched);
        if (changed.length > 0) {
          counts.updates++;
          if (samples.updates.length < SAMPLE_SIZE) samples.updates.push(tabSpec.keyOf(row as any));
          for (const field of changed) {
            changedFields[field] = (changedFields[field] ?? 0) + 1;
          }
        } else {
          counts.unchanged++;
        }
      }

      // A TEMPLATE workbook (blank sheets + one SAMPLE row) reports every
      // tab `present: true` with (after the SAMPLE row is skipped) zero
      // rows. Never let that read as "the user deleted every row" — gate
      // deletion on the workbook not being a template, regardless of what
      // any individual `TabSpec.deleteByAbsence` says.
      if (
        tabSpec.deleteByAbsence &&
        !INSERT_ONLY_TABS.has(tabSpec.name) &&
        validated.meta.kind !== 'TEMPLATE'
      ) {
        for (const entity of existing) {
          const id: unknown = (entity as { id?: unknown }).id;
          if (typeof id === 'string' && !matchedIds.has(id)) {
            counts.deletes++;
            if (isActive(entity)) newSeats--;
            if (samples.deletes.length < SAMPLE_SIZE) samples.deletes.push(tabSpec.keyOf(entity));
          }
        }
      }

      // [#1654] Net seats the file needs vs `seat_limit`, so an over-limit restore fails here, not
      // mid-commit. Per-row `takeSeat()` stays as the race-safe backstop.
      // ponytail: ignores soft-deleted students a restore revives (counted conservatively at commit).
      if (tabSpec.name === 'students' && newSeats > 0) {
        const { used, limit } = await getSeatUsage(manager, tenantId);
        if (limit !== null && used + newSeats > limit) {
          diffErrors.push({
            tab: 'students',
            row: 0,
            column: null,
            severity: 'error',
            message: `This file needs ${newSeats} more student seat(s) but only ${Math.max(limit - used, 0)} of the ${limit}-student limit are free.`,
          });
        }
      }

      totals.creates += counts.creates;
      totals.updates += counts.updates;
      totals.unchanged += counts.unchanged;
      totals.deletes += counts.deletes;

      tabs.push({
        name: tabSpec.name,
        present: true,
        ...counts,
        changedFields,
        errors: validatedTab.errors,
        warnings: validatedTab.warnings,
        samples,
      });
    }

    return {
      tabs,
      totals,
      hardErrorCount: validated.hardErrorCount + diffErrors.length,
      diffErrors,
      isEmptyTenant: !presentNonSchoolTabsHaveRows,
    };
  }
}
