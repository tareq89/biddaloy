import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { AttentionQueryService } from './attention-query.service';

describe('AttentionQueryService.studentAlerts teacher scope', () => {
  // A year rollover leaves two ACTIVE enrollments (one per academic year).
  function make(teaches: string) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM students')) return [{ id: 's1' }];
      if (sql.includes('FROM enrollments')) return [{ section_id: 'old' }, { section_id: 'new' }];
      return [];
    });
    const teacherScope = {
      rolesInSection: vi.fn(async ({ sectionId }: { sectionId: string }) =>
        sectionId === teaches
          ? { homeroom: 'CLASS_TEACHER', subjectIds: [] }
          : { homeroom: null, subjectIds: [] },
      ),
    };
    const schools = { getResolvedSettings: async () => ({ region: { locale: 'en' } }) };
    return new AttentionQueryService(
      { query } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      teacherScope as never,
      schools as never,
      {} as never,
    );
  }
  const teacher = { userId: 'u1', role: UserRole.TEACHER };

  it('allows the class teacher of either ACTIVE enrollment, whichever row comes first', async () => {
    await expect(make('new').studentAlerts('t1', teacher, 's1')).resolves.toEqual([]);
    await expect(make('old').studentAlerts('t1', teacher, 's1')).resolves.toEqual([]);
  });

  it('403 when the teacher teaches none of the sections', async () => {
    await expect(make('other').studentAlerts('t1', teacher, 's1')).rejects.toMatchObject({
      status: 403,
    });
  });
});
