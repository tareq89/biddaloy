import type { EntityManager } from 'typeorm';
import type { PresetApplyOptions, PresetPack } from '@biddaloy/shared';

export interface ApplyContext {
  manager: EntityManager;
  tenantId: string;
  userId: string;
  pack: PresetPack;
  options: PresetApplyOptions;
  ids: {
    yearId?: string;
    /** keyed by `keyOf(numericGrade, version)` */
    classIdByKey: Map<string, string>;
    subjectIdByCode: Map<string, string>;
    classSubjectIdByKey: Map<string, string>;
  };
}

/** One apply step; returns created counts keyed by entity. */
export type ApplyWriter = (ctx: ApplyContext) => Promise<Record<string, number>>;

export interface SelectedClass {
  name: string;
  numericGrade: number;
  stage: string;
  version: string | null;
}

export const keyOf = (numericGrade: number, version: string | null): string =>
  `${numericGrade}:${version ?? ''}`;

/** Classes to create: selected stages only, one per class x selected version (null if pack has no versions). */
export function selectedClasses(ctx: ApplyContext): SelectedClass[] {
  const { pack, options } = ctx;
  const versions: (string | null)[] = pack.versions?.length ? options.versions : [null];
  return pack.classes
    .filter((c) => options.stages.includes(c.stage))
    .flatMap((c) => versions.map((version) => ({ ...c, version })));
}
