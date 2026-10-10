import { describe, it, expect, vi } from 'vitest';
import { ApplicationType } from '@biddaloy/shared';
import { ManualHandler } from './manual.handler';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';

const TENANT = 't-1';
const ctx = { tenantId: TENANT, actorUserId: 'u-1' } as ApplicationEffectContext;
const mk = (over: Partial<Application>) => ({ payload: {}, ...over }) as unknown as Application;

/** Fake manager whose Student repo returns `student` and records the where clause. */
function managerWith(student: unknown) {
  const findOne = vi.fn().mockResolvedValue(student);
  return { manager: { getRepository: () => ({ findOne }) } as never, findOne };
}

describe('ManualHandler', () => {
  const handler = new ManualHandler();
  const { manager } = managerWith(null);

  it('TESTIMONIAL returns a STUDENT print follow-up', async () => {
    const res = await handler.apply(
      manager,
      mk({ type: ApplicationType.TESTIMONIAL, subject_student_id: 's-1' }),
      ctx,
    );
    expect(res).toEqual({
      follow_up: {
        kind: 'PRINT',
        document_kind: 'TESTIMONIAL',
        subject_type: 'STUDENT',
        subject_ids: ['s-1'],
      },
    });
  });

  it('ID_CARD_REPRINT for a student uses STUDENT_ID_CARD', async () => {
    const res = await handler.apply(
      manager,
      mk({ type: ApplicationType.ID_CARD_REPRINT, subject_student_id: 's-1' }),
      ctx,
    );
    expect(res).toEqual({
      follow_up: {
        kind: 'PRINT',
        document_kind: 'STUDENT_ID_CARD',
        subject_type: 'STUDENT',
        subject_ids: ['s-1'],
      },
    });
  });

  it('ID_CARD_REPRINT for staff uses STAFF_ID_CARD / STAFF', async () => {
    const res = await handler.apply(
      manager,
      mk({
        type: ApplicationType.ID_CARD_REPRINT,
        subject_student_id: null,
        subject_staff_profile_id: 'sp-1',
      }),
      ctx,
    );
    expect(res).toEqual({
      follow_up: {
        kind: 'PRINT',
        document_kind: 'STAFF_ID_CARD',
        subject_type: 'STAFF',
        subject_ids: ['sp-1'],
      },
    });
  });

  it("SCRIPT_RECHECK returns a MARKS follow-up for the student's current section, tenant-filtered", async () => {
    const { manager: m, findOne } = managerWith({ class_section_id: 'sec-9' });
    const res = await handler.apply(
      m,
      mk({
        type: ApplicationType.SCRIPT_RECHECK,
        subject_student_id: 's-1',
        payload: { exam_id: 'e-1', subject_id: 'b-1', reason: 'Recheck' },
      }),
      ctx,
    );
    expect(res).toEqual({
      follow_up: { kind: 'MARKS', exam_id: 'e-1', section_id: 'sec-9', subject_id: 'b-1' },
    });
    // Tenant isolation: the student lookup must carry the tenant and skip soft-deleted rows.
    expect(findOne.mock.calls[0][0].where).toMatchObject({ id: 's-1', tenant_id: TENANT });
  });

  it('SCRIPT_RECHECK with a missing / other-tenant student -> 404', async () => {
    await expect(
      handler.apply(
        manager,
        mk({ type: ApplicationType.SCRIPT_RECHECK, subject_student_id: 's-1' }),
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('print types with no subject id -> 404, never an empty subject_ids', async () => {
    for (const type of [ApplicationType.TESTIMONIAL, ApplicationType.ID_CARD_REPRINT]) {
      await expect(
        handler.apply(
          manager,
          mk({ type, subject_student_id: null, subject_staff_profile_id: null }),
          ctx,
        ),
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  it('any other type is a registry misconfiguration -> 500', async () => {
    await expect(
      handler.apply(manager, mk({ type: ApplicationType.STAFF_LEAVE }), ctx),
    ).rejects.toMatchObject({ status: 500 });
  });
});
