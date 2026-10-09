import {
  IsUUID,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsObject,
  IsBoolean,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { FineTrigger } from '@biddaloy/shared';
import { FineRule } from '../../entities/fine-rule.entity';

/**
 * [38.2.1, D6] Per-`FineTrigger` shape of `conditions`. Adding a new
 * trigger needs only a new key here (and in the `FineTrigger` enum) —
 * the acceptance criterion this map exists to satisfy.
 */
type ConditionField = { type: 'int'; min: number; max: number };
const CONDITION_SCHEMAS: Record<FineTrigger, Record<string, ConditionField>> = {
  [FineTrigger.ATTENDANCE_ABSENT]: {},
  [FineTrigger.ATTENDANCE_LATE]: { min_minutes_late: { type: 'int', min: 0, max: 240 } },
};

@ValidatorConstraint({ name: 'conditionsMatchTrigger', async: false })
class ConditionsMatchTriggerConstraint implements ValidatorConstraintInterface {
  validate(conditions: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { trigger?: FineTrigger };
    const trigger = obj.trigger;
    if (!trigger || !(trigger in CONDITION_SCHEMAS)) return true; // @IsEnum reports trigger's own error
    if (typeof conditions !== 'object' || conditions === null || Array.isArray(conditions)) {
      return false;
    }
    const schema = CONDITION_SCHEMAS[trigger];
    for (const [key, value] of Object.entries(conditions)) {
      const field = schema[key];
      if (!field) return false; // unknown key for this trigger
      if (field.type === 'int') {
        if (
          !Number.isInteger(value) ||
          (value as number) < field.min ||
          (value as number) > field.max
        ) {
          return false;
        }
      }
    }
    return true;
  }

  defaultMessage(): string {
    return 'conditions has an unknown key, or a value out of range, for the given trigger';
  }
}

export class CreateFineRuleDto {
  @IsUUID()
  academic_year_id: string;

  @IsEnum(FineTrigger)
  trigger: FineTrigger;

  @IsUUID()
  fee_structure_id: string;

  /** null = school-wide default rule for this trigger. */
  @IsOptional()
  @IsUUID()
  class_id?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  free_per_period?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  cap_per_period?: number | null;

  @IsOptional()
  @IsObject()
  @Validate(ConditionsMatchTriggerConstraint)
  conditions?: Record<string, string | number | boolean | null>;
}

export class UpdateFineRuleDto {
  @IsOptional()
  @IsUUID()
  fee_structure_id?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  free_per_period?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  cap_per_period?: number | null;

  // [D6] Validated against the rule's existing `trigger` in the service —
  // `trigger` isn't itself patchable, so there is nothing on this DTO for
  // `ConditionsMatchTriggerConstraint` to read; the service re-runs the
  // same schema map (`validateConditionsForTrigger`) after merging.
  @IsOptional()
  @IsObject()
  conditions?: Record<string, string | number | boolean | null>;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CopyFineRulesDto {
  @IsUUID()
  from_academic_year_id: string;

  @IsUUID()
  to_academic_year_id: string;
}

export class FineRuleDto {
  id: string;
  academic_year_id: string;
  trigger: FineTrigger;
  fee_structure_id: string;
  fee_structure_name: string;
  fee_structure_amount: number;
  class_id: string | null;
  class_name: string | null;
  free_per_period: number;
  cap_per_period: number | null;
  conditions: Record<string, string | number | boolean | null>;
  is_active: boolean;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Exported so the service can re-validate `conditions` against a trigger
 * that isn't on the DTO being validated right now (the PATCH path, where
 * `trigger` comes from the existing row, not the request body). */
export function validateConditionsForTrigger(
  trigger: FineTrigger,
  conditions: Record<string, unknown> | undefined,
): boolean {
  const schema = CONDITION_SCHEMAS[trigger];
  if (!conditions) return true;
  for (const [key, value] of Object.entries(conditions)) {
    const field = schema[key];
    if (!field) return false;
    if (field.type === 'int') {
      if (
        !Number.isInteger(value) ||
        (value as number) < field.min ||
        (value as number) > field.max
      ) {
        return false;
      }
    }
  }
  return true;
}

export function toFineRuleDto(
  rule: FineRule & {
    fee_structure?: { name: string; amount: number };
    class?: { name: string } | null;
  },
): FineRuleDto {
  return {
    id: rule.id,
    academic_year_id: rule.academic_year_id,
    trigger: rule.trigger,
    fee_structure_id: rule.fee_structure_id,
    fee_structure_name: rule.fee_structure?.name ?? '',
    fee_structure_amount: rule.fee_structure ? Number(rule.fee_structure.amount) : 0,
    class_id: rule.class_id,
    class_name: rule.class?.name ?? null,
    free_per_period: rule.free_per_period,
    cap_per_period: rule.cap_per_period !== null ? Number(rule.cap_per_period) : null,
    conditions: rule.conditions,
    is_active: rule.is_active,
    created_by_user_id: rule.created_by_user_id,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  };
}
