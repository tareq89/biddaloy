import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
} from '@biddaloy/shared';
import { ArrivalNoticeSubscription } from '../../../attendance/entities/arrival-notice-subscription.entity';
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
});
