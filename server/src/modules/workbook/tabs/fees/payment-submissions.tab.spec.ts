import { describe, expect, it } from 'vitest';
import {
  paymentSubmissionEventsTab,
  paymentSubmissionFilesTab,
  paymentSubmissionsTab,
} from './payment-submissions.tab';
import type { ImportContext } from '../../codec/tab-spec';

const ctx: ImportContext = { tenantId: 't', ref: (_tab, key) => key, warn: () => undefined };
const ID = '00000000-0000-4000-8000-000000000001';

describe('payment submission tabs', () => {
  it('the files tab exports storage keys and metadata, never file bytes (D32)', () => {
    const keys = paymentSubmissionFilesTab.columns.map((c) => c.key);
    expect(keys).toEqual([
      'id',
      'submission',
      'storage_key',
      'content_type',
      'size_bytes',
      'original_name_hash',
      'created_at',
    ]);
  });

  it('keys every tab by the row id', () => {
    expect(paymentSubmissionsTab.keyOf({ id: ID } as never)).toBe(ID);
    expect(paymentSubmissionEventsTab.keyOf({ id: ID } as never)).toBe(ID);
  });

  it('events are append-only: never deleted by absence, never diffed, remove throws', async () => {
    expect(paymentSubmissionEventsTab.deleteByAbsence).toBe(false);
    expect(paymentSubmissionEventsTab.diffFields({} as never, {} as never)).toEqual([]);
    await expect(paymentSubmissionEventsTab.remove({} as never, {} as never)).rejects.toThrow(
      'append-only',
    );
  });

  it('rejects a bad enum cell with a row error', () => {
    const result = paymentSubmissionsTab.fromRow(
      { id: ID, source: 'NOPE', status: 'PENDING', amount: '10.00', unmatched: 'FALSE' },
      2,
      ctx,
    );
    expect('errors' in result).toBe(true);
  });
});
