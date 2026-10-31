import { Injectable, OnModuleInit } from '@nestjs/common';
import type { ReportSubjectArea } from '@biddaloy/shared';
import { ALL_AREAS } from './areas';
import type { EntityDef, FieldDef, MeasureDef, SubjectAreaDef } from './registry.types';

/** Every entity an area can reach: the root and each joined table, by alias. */
export function entitiesOf(area: SubjectAreaDef): Map<string, EntityDef> {
  const byAlias = new Map<string, EntityDef>([[area.root.alias, area.root]]);
  for (const join of area.joins) byAlias.set(join.to.alias, join.to);
  return byAlias;
}

/**
 * Throws on a registry that could produce an unsafe or broken query. Called when the
 * module starts, so the app refuses to boot with a bad registry (fail closed).
 * Checks: unique area, field and measure keys; unique aliases; every table is
 * school-scoped (own `tenant_id`, or through an always-joined `tenantVia` table);
 * every join starts from an alias already in the query; every field and measure
 * reads an entity the area can reach.
 */
export function assertRegistryValid(areas: readonly SubjectAreaDef[]): void {
  const problems: string[] = [];
  const seenAreas = new Set<string>();

  for (const area of areas) {
    const where = `area ${area.key}`;
    if (seenAreas.has(area.key)) problems.push(`${where}: defined twice`);
    seenAreas.add(area.key);

    // Aliases: the root first, then each join in order, each `from` must already exist.
    const known = new Map<string, EntityDef>([[area.root.alias, area.root]]);
    for (const join of area.joins) {
      if (!known.has(join.from)) {
        problems.push(
          `${where}: join to "${join.to.alias}" starts from unknown alias "${join.from}"`,
        );
      }
      if (known.has(join.to.alias)) {
        problems.push(`${where}: alias "${join.to.alias}" is used twice`);
      }
      known.set(join.to.alias, join.to);
    }

    for (const entity of known.values()) {
      if (entity.tenantColumn === 'tenant_id') continue;
      const via = entity.tenantVia ? known.get(entity.tenantVia) : undefined;
      if (via?.tenantColumn !== 'tenant_id') {
        problems.push(
          `${where}: entity "${entity.alias}" (${entity.table}) has no tenant column and no tenantVia entity that does`,
        );
      }
    }

    const keys = new Set<string>();
    const check = (kind: string, def: FieldDef | MeasureDef) => {
      if (keys.has(def.key)) problems.push(`${where}: ${kind} key "${def.key}" is not unique`);
      keys.add(def.key);
      if (!known.has(def.entity)) {
        problems.push(
          `${where}: ${kind} "${def.key}" reads entity "${def.entity}", which the area cannot reach`,
        );
      }
    };
    for (const field of area.fields) check('field', field);
    for (const measure of area.measures) check('measure', measure);
  }

  if (problems.length > 0) {
    throw new Error(`Invalid report registry:\n- ${problems.join('\n- ')}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Read-only view of the semantic layer. Server code only: it holds SQL fragments (D19). */
@Injectable()
export class ReportRegistry implements OnModuleInit {
  private readonly byKey: ReadonlyMap<ReportSubjectArea, SubjectAreaDef>;

  constructor() {
    this.byKey = new Map(ALL_AREAS.map((area) => [area.key, deepFreeze(area)]));
  }

  onModuleInit(): void {
    assertRegistryValid(ALL_AREAS);
  }

  areas(): readonly SubjectAreaDef[] {
    return [...this.byKey.values()];
  }

  area(key: ReportSubjectArea): SubjectAreaDef | undefined {
    return this.byKey.get(key);
  }

  field(key: ReportSubjectArea, fieldKey: string): FieldDef | undefined {
    return this.area(key)?.fields.find((f) => f.key === fieldKey);
  }

  measure(key: ReportSubjectArea, measureKey: string): MeasureDef | undefined {
    return this.area(key)?.measures.find((m) => m.key === measureKey);
  }
}
