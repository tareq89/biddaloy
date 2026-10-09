import { APPLICATION_TYPES, ApplicationType } from '@biddaloy/shared';
import { APPLICATION_HANDLERS } from './application-types';

const types = Object.values(ApplicationType);

describe('APPLICATION_HANDLERS', () => {
  it('has a key for every ApplicationType', () => {
    expect(Object.keys(APPLICATION_HANDLERS).sort()).toEqual([...types].sort());
  });

  it('maps a type to a handler iff its effect is not NONE', () => {
    for (const t of types) {
      expect(APPLICATION_HANDLERS[t] !== null, t).toBe(APPLICATION_TYPES[t].effect !== 'NONE');
    }
  });

  it('gives every cancellable type a handler with cancel()', () => {
    const cancellable = types.filter((t) => APPLICATION_TYPES[t].cancellable);
    expect(cancellable.length).toBeGreaterThan(0);
    for (const t of cancellable) {
      expect(typeof APPLICATION_HANDLERS[t]?.prototype.cancel, t).toBe('function');
    }
  });
});
