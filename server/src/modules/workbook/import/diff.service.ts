import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ALL_TABS } from '../codec/registry';
import type { TabSpec } from '../codec/tab-spec';
import type { ValidatedWorkbook } from './validated-workbook';
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

      for (const row of validatedTab.rows) {
        const rowId = (row as { id?: unknown }).id;
        const matched =
          (typeof rowId === 'string' && existingById.get(rowId)) ||
          existingByKey.get(tabSpec.keyOf(row as any));

        if (!matched) {
          counts.creates++;
          if (samples.creates.length < SAMPLE_SIZE) samples.creates.push(tabSpec.keyOf(row as any));
          continue;
        }

        const matchedId: unknown = (matched as { id?: unknown }).id;
        if (typeof matchedId === 'string') matchedIds.add(matchedId);

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
      if (tabSpec.deleteByAbsence && validated.meta.kind !== 'TEMPLATE') {
        for (const entity of existing) {
          const id: unknown = (entity as { id?: unknown }).id;
          if (typeof id === 'string' && !matchedIds.has(id)) {
            counts.deletes++;
            if (samples.deletes.length < SAMPLE_SIZE) samples.deletes.push(tabSpec.keyOf(entity));
          }
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
      hardErrorCount: validated.hardErrorCount,
      isEmptyTenant: !presentNonSchoolTabsHaveRows,
    };
  }
}
