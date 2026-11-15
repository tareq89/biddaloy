import { describe, expect, it } from 'vitest';
import { dropStaleRelations } from './stale-relations';

const manager = {
  connection: {
    hasMetadata: () => true,
    getMetadata: () => ({
      relations: [
        {
          propertyName: 'resolved_by_user',
          isManyToOne: true,
          isOneToOne: false,
          isOwning: true,
          joinColumns: [{ propertyName: 'resolved_by' }],
        },
        {
          propertyName: 'routine_slot',
          isManyToOne: true,
          isOneToOne: false,
          isOwning: true,
          joinColumns: [{ propertyName: 'routine_slot_id' }],
        },
        {
          propertyName: 'children',
          isManyToOne: false,
          isOneToOne: false,
          isOwning: false,
          joinColumns: [],
        },
      ],
    }),
  },
} as never;

describe('dropStaleRelations [2761]', () => {
  const existing = () => ({
    resolved_by: 'u1',
    resolved_by_user: { id: 'u1' },
    routine_slot_id: 's1',
    routine_slot: { id: 's1' },
    children: [{}],
  });

  it('drops the relation whose FK the file clears or changes, keeps the others', () => {
    const e = existing();
    dropStaleRelations(
      { entity: class {} } as never,
      { resolved_by: null, routine_slot_id: 's1' },
      e,
      manager,
    );
    expect(e.resolved_by_user).toBeUndefined();
    expect(e.routine_slot).toEqual({ id: 's1' });
    expect(e.children).toHaveLength(1);

    const e2 = existing();
    dropStaleRelations(
      { entity: class {} } as never,
      { resolved_by: 'u1', routine_slot_id: 's2' },
      e2,
      manager,
    );
    expect(e2.resolved_by_user).toEqual({ id: 'u1' });
    expect(e2.routine_slot).toBeUndefined();
  });

  it('leaves everything when the row does not carry the FK or it is unchanged', () => {
    const e = existing();
    dropStaleRelations({ entity: class {} } as never, { resolved_by: 'u1' }, e, manager);
    expect(e.resolved_by_user).toEqual({ id: 'u1' });
    expect(e.routine_slot).toEqual({ id: 's1' });
  });
});
