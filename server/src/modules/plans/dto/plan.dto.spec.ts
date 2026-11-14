import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto } from './plan.dto';

const ID = '11111111-1111-4111-8111-111111111111';
const bad = (cls: new () => object, v: object) =>
  validateSync(plainToInstance(cls, v)).map((e) => e.property);

describe('plan dto bounds', () => {
  it('create: name 2..60, price whole paisa 1..100000000', () => {
    expect(bad(CreatePlanDto, { name: 'Gold', unit_price_paisa: 1000 })).toEqual([]);
    expect(bad(CreatePlanDto, { name: 'G', unit_price_paisa: 1000 })).toEqual(['name']);
    expect(bad(CreatePlanDto, { name: 'x'.repeat(61), unit_price_paisa: 1000 })).toEqual(['name']);
    expect(bad(CreatePlanDto, { name: 'Gold', unit_price_paisa: 0 })).toEqual(['unit_price_paisa']);
    expect(bad(CreatePlanDto, { name: 'Gold', unit_price_paisa: 100_000_001 })).toEqual([
      'unit_price_paisa',
    ]);
    // Money is integer paisa: a fraction is refused (Rule 26).
    expect(bad(CreatePlanDto, { name: 'Gold', unit_price_paisa: 10.5 })).toEqual([
      'unit_price_paisa',
    ]);
  });

  it('update: every field optional, same bounds when present', () => {
    expect(bad(UpdatePlanDto, {})).toEqual([]);
    expect(bad(UpdatePlanDto, { active: false })).toEqual([]);
    expect(bad(UpdatePlanDto, { unit_price_paisa: 0 })).toEqual(['unit_price_paisa']);
    expect(bad(UpdatePlanDto, { active: 'no' })).toEqual(['active']);
  });

  it('assign: uuid plan_id and reason 5..300', () => {
    expect(bad(AssignPlanDto, { plan_id: ID, reason: 'Agreed deal' })).toEqual([]);
    expect(bad(AssignPlanDto, { plan_id: 'x', reason: 'Agreed deal' })).toEqual(['plan_id']);
    expect(bad(AssignPlanDto, { plan_id: ID, reason: 'hi' })).toEqual(['reason']);
    expect(bad(AssignPlanDto, { plan_id: ID, reason: 'r'.repeat(301) })).toEqual(['reason']);
  });
});
