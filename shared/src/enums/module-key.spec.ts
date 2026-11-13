import { describe, expect, it } from 'vitest';
import { UserRole } from './index';
import {
  CORE_AREAS,
  ModuleKey,
  moduleEnabled,
  resolveModuleState,
  type ModuleInput,
} from './module-key';

const K = ModuleKey;
const off = { on: false };
const T = UserRole.TEACHER;

describe('resolveModuleState', () => {
  const cases: [string, ModuleInput, ModuleKey, boolean, string, ModuleKey?][] = [
    ['empty input is on', {}, K.fees, true, 'default'],
    ['null inputs are on', { platform: null, school: null, role: null }, K.fees, true, 'default'],
    [
      'platform off beats lock on and school on',
      { platform: { fees: false }, school: { fees: { on: true, lock: 'on' } } },
      K.fees,
      false,
      'platform-off',
    ],
    ['platform true is not a kill', { platform: { fees: true } }, K.fees, true, 'default'],
    [
      'lock off beats school on',
      { school: { fees: { on: true, lock: 'off' } } },
      K.fees,
      false,
      'platform-lock',
    ],
    [
      'lock on beats school off',
      { school: { fees: { on: false, lock: 'on' } } },
      K.fees,
      true,
      'platform-lock',
    ],
    ['school off', { school: { fees: off } }, K.fees, false, 'school'],
    ['school on explicit', { school: { fees: { on: true } } }, K.fees, true, 'school'],
    ['fees off hides fines', { school: { fees: off } }, K.fines, false, 'dependency', K.fees],
    [
      'platform fees off hides fines',
      { platform: { fees: false } },
      K.fines,
      false,
      'dependency',
      K.fees,
    ],
    [
      'fees on restores fines own choice (on)',
      { school: { fines: { on: true } } },
      K.fines,
      true,
      'school',
    ],
    [
      'fees on restores fines own choice (off)',
      { school: { fines: off } },
      K.fines,
      false,
      'school',
    ],
    [
      'exams off hides seatPlans',
      { school: { exams: off } },
      K.seatPlans,
      false,
      'dependency',
      K.exams,
    ],
    [
      'routines off hides studyPlans',
      { school: { routines: off } },
      K.studyPlans,
      false,
      'dependency',
      K.routines,
    ],
    [
      'role-off hides for TEACHER',
      { role: T, school: { fees: { offForRoles: [T] } } },
      K.fees,
      false,
      'role',
    ],
    [
      'role-off leaves other roles',
      { role: UserRole.ACCOUNTANT, school: { fees: { offForRoles: [T] } } },
      K.fees,
      true,
      'default',
    ],
    [
      'role-off never hides ADMIN',
      { role: UserRole.ADMIN, school: { fees: { offForRoles: [UserRole.ADMIN] } } },
      K.fees,
      true,
      'default',
    ],
    [
      'role-off never hides SUPER_ADMIN',
      { role: UserRole.SUPER_ADMIN, school: { fees: { offForRoles: [UserRole.SUPER_ADMIN] } } },
      K.fees,
      true,
      'default',
    ],
    [
      'no role given ignores offForRoles',
      { school: { fees: { offForRoles: [T] } } },
      K.fees,
      true,
      'default',
    ],
    ['entry without offForRoles', { role: T, school: { fees: {} } }, K.fees, true, 'default'],
  ];

  it.each(cases)('%s', (_n, input, key, on, source, dependsOn) => {
    const s = resolveModuleState(input, key);
    expect(s.on).toBe(on);
    expect(s.source).toBe(source);
    expect(s.dependsOn).toBe(dependsOn);
    expect(moduleEnabled(input, key)).toBe(on);
  });

  it('has 17 switchable keys and no core area among them', () => {
    expect(Object.keys(ModuleKey)).toHaveLength(17);
    for (const a of CORE_AREAS) expect(Object.keys(ModuleKey)).not.toContain(a);
  });
});
