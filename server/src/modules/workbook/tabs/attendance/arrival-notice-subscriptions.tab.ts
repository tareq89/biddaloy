import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
} from '@biddaloy/shared';
import { ArrivalNoticeSubscription } from '../../../attendance/entities/arrival-notice-subscription.entity';
import { Guardian } from '../../../students/entities/guardian.entity';
import { Student } from '../../../students/entities/student.entity';
import { createRefChildTab } from '../people/ref-child-tab.factory';
import { guardiansTab } from '../people/guardians.tab';
import { studentsTab } from '../people/students.tab';

/**
 * [84.2.3] `arrival_notice_subscriptions`: which guardian asked to be told when
 * which child is marked in. One row per (student, guardian), the same pair the
 * DB makes unique, so that pair is the natural key.
 *
 * `set_by_user_id` and `locked_by_user_id` are left out: they only record which
 * staff or parent account made the change, and users are not part of a backup.
 * The `lock` value itself is kept, so a restored school still honours its locks.
 */
export const arrivalNoticeSubscriptionsTab = createRefChildTab<ArrivalNoticeSubscription>({
  name: 'arrival_notice_subscriptions',
  entityClass: ArrivalNoticeSubscription,
  refs: [
    {
      key: 'student',
      fk: 'student_id',
      tab: studentsTab,
      label: { en: 'Student', bn: 'শিক্ষার্থী' },
    },
    {
      key: 'guardian',
      fk: 'guardian_id',
      tab: guardiansTab,
      label: { en: 'Guardian', bn: 'অভিভাবক' },
    },
  ],
  fields: [
    {
      key: 'status',
      type: 'enum',
      enumValues: Object.values(ArrivalNoticeStatus),
      required: true,
      label: { en: 'Status', bn: 'অবস্থা' },
    },
    {
      key: 'mode',
      type: 'enum',
      enumValues: Object.values(ArrivalNoticeMode),
      required: true,
      label: { en: 'Mode', bn: 'ধরন' },
    },
    {
      key: 'channel',
      type: 'enum',
      enumValues: Object.values(ArrivalNoticeChannel),
      required: true,
      label: { en: 'Channel', bn: 'মাধ্যম' },
    },
    {
      key: 'lock',
      type: 'enum',
      enumValues: Object.values(ArrivalNoticeLock),
      required: true,
      label: { en: 'Lock', bn: 'লক' },
    },
    { key: 'consumed_at', type: 'datetime', label: { en: 'Consumed at', bn: 'ব্যবহারের সময়' } },
  ],
  excluded: ['set_by_user_id', 'locked_by_user_id'],
  naturalKey: ['student', 'guardian'],
  // The subscription has no soft delete of its own: a soft-deleted student or
  // guardian leaves its rows behind, and their parent is absent from the export.
  filterRows: async (rows, tenant_id, m) => {
    const [students, guardians] = await Promise.all([
      m.find(Student, { select: ['id'], where: { tenant_id } }),
      m.find(Guardian, { select: ['id'], where: { tenant_id } }),
    ]);
    const s = new Set(students.map((x) => x.id));
    const g = new Set(guardians.map((x) => x.id));
    return rows.filter((r) => s.has(r.student_id) && g.has(r.guardian_id));
  },
  // D35, the rules `ArrivalSubscriptionsService.setLock` enforces: ALWAYS is
  // ACTIVE + RECURRING and unconsumed (a consumed row is never sent), NEVER is OFF
  // (else clearing the lock later would switch notices on by itself).
  checkRow: (row) => {
    if (row.lock === ArrivalNoticeLock.ALWAYS) {
      if (row.status !== ArrivalNoticeStatus.ACTIVE || row.mode !== ArrivalNoticeMode.RECURRING) {
        return {
          column: 'lock',
          message: 'An ALWAYS lock needs status ACTIVE and mode RECURRING.',
        };
      }
      if (row.consumed_at) {
        return { column: 'consumed_at', message: 'An ALWAYS lock needs an empty Consumed at.' };
      }
    }
    if (row.lock === ArrivalNoticeLock.NEVER && row.status !== ArrivalNoticeStatus.OFF) {
      return { column: 'lock', message: 'A NEVER lock needs status OFF.' };
    }
    return null;
  },
});
