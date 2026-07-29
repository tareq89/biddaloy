import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BulkReminderService,
  SkipReason,
  selectReminderGuardians,
  addressForMedium,
} from './reminders.service';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
} from '@beton-boi/shared';

const TENANT = 'tenant-1';
const USER = 'user-1';

function guardian(overrides: Partial<any> = {}) {
  return {
    id: 'g-1',
    full_name: 'Karim Uddin',
    phone: '01712345678',
    alternate_phone: null,
    email: 'karim@example.com',
    is_primary_contact: true,
    preferred_communication: CommunicationMedium.SMS,
    ...overrides,
  };
}

function student(overrides: Partial<any> = {}) {
  return {
    id: 's-1',
    full_name: 'Rahim Uddin',
    guardians: [guardian()],
    ...overrides,
  };
}

function snapshot(overrides: Partial<any> = {}) {
  return {
    student_id: 's-1',
    total_due: 1500,
    earliest_due_month: 3,
    earliest_due_year: 2026,
    ...overrides,
  };
}

describe('selectReminderGuardians', () => {
  it('returns only primary contacts when the student has any', () => {
    const primary = guardian({ id: 'g-1', is_primary_contact: true });
    const secondary = guardian({ id: 'g-2', is_primary_contact: false });

    expect(selectReminderGuardians([primary, secondary] as any)).toEqual([primary]);
  });

  it('falls back to every guardian when none is flagged primary', () => {
    const a = guardian({ id: 'g-1', is_primary_contact: false });
    const b = guardian({ id: 'g-2', is_primary_contact: false });

    expect(selectReminderGuardians([a, b] as any)).toEqual([a, b]);
  });

  it('returns an empty list for a student with no guardians', () => {
    expect(selectReminderGuardians([])).toEqual([]);
  });
});

describe('addressForMedium', () => {
  it('uses the email address for EMAIL', () => {
    expect(addressForMedium(guardian() as any, CommunicationMedium.EMAIL)).toBe('karim@example.com');
  });

  it('uses the phone number for SMS and WhatsApp', () => {
    expect(addressForMedium(guardian() as any, CommunicationMedium.SMS)).toBe('01712345678');
    expect(addressForMedium(guardian() as any, CommunicationMedium.WHATSAPP)).toBe('01712345678');
  });

  it('falls back to the alternate phone when the primary one is missing', () => {
    const g = guardian({ phone: null, alternate_phone: '01898765432' });
    expect(addressForMedium(g as any, CommunicationMedium.SMS)).toBe('01898765432');
  });

  it('returns null when nothing is on file for the medium', () => {
    expect(addressForMedium(guardian({ email: null }) as any, CommunicationMedium.EMAIL)).toBeNull();
    expect(
      addressForMedium(guardian({ phone: null, alternate_phone: null }) as any, CommunicationMedium.SMS),
    ).toBeNull();
  });
});

describe('BulkReminderService', () => {
  let service: BulkReminderService;
  let logRepo: Record<string, ReturnType<typeof vi.fn>>;
  let batchRepo: Record<string, ReturnType<typeof vi.fn>>;
  let queue: Record<string, ReturnType<typeof vi.fn>>;
  let studentService: Record<string, ReturnType<typeof vi.fn>>;
  let feeDuesService: Record<string, ReturnType<typeof vi.fn>>;

  let savedBatch: any;
  let txManager: Record<string, ReturnType<typeof vi.fn>>;

  const dto = {
    student_ids: ['s-1'],
    message_template: 'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}} for {{due_month}}.',
  };

  beforeEach(() => {
    savedBatch = null;
    // The enqueue-failure path saves the log and records the batch outcome
    // inside one transaction (see the "why" in reminders.service.ts) so
    // a crash between the two can't leave a FAILED log the batch never
    // counted. txManager stands in for the transactional EntityManager.
    txManager = {
      save: vi.fn(async (v) => v),
      query: vi.fn(async () => undefined),
    };

    logRepo = {
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn(async (v) => ({ id: 'log-1', ...v })),
      manager: { transaction: vi.fn(async (cb: any) => cb(txManager)) },
    };
    batchRepo = {
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn(async (v) => {
        savedBatch = {
          id: 'batch-1',
          successful_count: 0,
          failed_count: 0,
          created_at: new Date('2026-03-01T00:00:00Z'),
          ...v,
        };
        return savedBatch;
      }),
      findOne: vi.fn(async () => savedBatch),
      query: vi.fn(async () => undefined),
    };
    queue = { add: vi.fn(async () => undefined) };
    studentService = { findManyWithGuardians: vi.fn(async () => [student()]) };
    feeDuesService = {
      getDueSnapshots: vi.fn(async () => new Map([['s-1', snapshot()]])),
    };

    service = new BulkReminderService(
      logRepo as any,
      batchRepo as any,
      queue as any,
      studentService as any,
      feeDuesService as any,
    );
  });

  describe('validation', () => {
    it('rejects a template using an unsupported placeholder before creating anything', async () => {
      await expect(
        service.sendBulk({ ...dto, message_template: 'Hi {{parent}}' } as any, TENANT, USER),
      ).rejects.toThrow(BadRequestException);

      expect(batchRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects whatsapp_template_params naming a placeholder it cannot fill', async () => {
      await expect(
        service.sendBulk(
          { ...dto, whatsapp_template_name: 'fee_reminder', whatsapp_template_params: ['nope'] } as any,
          TENANT,
          USER,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(batchRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFound listing student ids that do not resolve within the tenant', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([student({ id: 's-1' })]);

      await expect(
        service.sendBulk({ ...dto, student_ids: ['s-1', 's-missing'] } as any, TENANT, USER),
      ).rejects.toThrow(/s-missing/);
      await expect(
        service.sendBulk({ ...dto, student_ids: ['s-1', 's-missing'] } as any, TENANT, USER),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the student lookup and the dues lookup to the caller tenant', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(studentService.findManyWithGuardians).toHaveBeenCalledWith(['s-1'], TENANT);
      expect(feeDuesService.getDueSnapshots).toHaveBeenCalledWith(['s-1'], TENANT);
    });

    it('deduplicates repeated student ids so a guardian is not messaged twice', async () => {
      await service.sendBulk({ ...dto, student_ids: ['s-1', 's-1'] } as any, TENANT, USER);

      expect(studentService.findManyWithGuardians).toHaveBeenCalledWith(['s-1'], TENANT);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('happy path', () => {
    it('creates a PROCESSING batch owned by the tenant and queues one job per recipient', async () => {
      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          initiated_by_user_id: USER,
          status: ReminderBatchStatus.PROCESSING,
          total_recipients: 1,
          message_template: dto.message_template,
        }),
      );
      expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
      expect(result.total_recipients).toBe(1);
      expect(result.skipped).toEqual([]);
    });

    it('writes a QUEUED log tagged BULK_REMINDER and linked to the batch', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          reminder_batch_id: 'batch-1',
          student_id: 's-1',
          guardian_id: 'g-1',
          medium: CommunicationMedium.SMS,
          recipient_address: '01712345678',
          recipient_name: 'Karim Uddin',
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.BULK_REMINDER,
        }),
      );
    });

    it('renders the placeholders into each recipient message body', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message_body: 'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for March 2026.',
        }),
      );
    });

    it('records the request in filters_applied for audit', async () => {
      await service.sendBulk({ ...dto, mediums: [CommunicationMedium.SMS] } as any, TENANT, USER);

      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          filters_applied: expect.objectContaining({
            student_ids: ['s-1'],
            mediums: [CommunicationMedium.SMS],
          }),
        }),
      );
    });

    it('uses the supplied batch name, and a dated default otherwise', async () => {
      await service.sendBulk({ ...dto, batch_name: 'March chase-up' } as any, TENANT, USER);
      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ batch_name: 'March chase-up' }),
      );

      batchRepo.create.mockClear();
      await service.sendBulk(dto as any, TENANT, USER);
      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ batch_name: expect.stringMatching(/^Fee Reminder \d{4}-\d{2}-\d{2}$/) }),
      );
    });

    it('sends one message per primary guardian when a student has several', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: true }),
          ],
        }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.total_recipients).toBe(2);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('email specifics', () => {
    it('sets a subject only for email recipients', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.EMAIL })] }),
      ]);

      await service.sendBulk({ ...dto, batch_name: 'March chase-up' } as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          medium: CommunicationMedium.EMAIL,
          recipient_address: 'karim@example.com',
          subject: 'March chase-up',
        }),
      );
    });

    it('leaves the subject null for non-email recipients', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ subject: null }));
    });
  });

  describe('WhatsApp templates', () => {
    beforeEach(() => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.WHATSAPP })] }),
      ]);
    });

    it('maps named template params onto positional values in order', async () => {
      await service.sendBulk(
        {
          ...dto,
          whatsapp_template_name: 'fee_reminder',
          whatsapp_template_language: 'bn',
          whatsapp_template_params: ['guardian_name', 'due_amount', 'due_month'],
        } as any,
        TENANT,
        USER,
      );

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            template_name: 'fee_reminder',
            template_language: 'bn',
            template_params: ['Karim Uddin', '1,500.00', 'March 2026'],
          },
        }),
      );
    });

    it('leaves metadata null when no template name was supplied', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
    });

    it('does not attach template metadata to a non-WhatsApp recipient', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.SMS })] }),
      ]);

      await service.sendBulk({ ...dto, whatsapp_template_name: 'fee_reminder' } as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
    });
  });

  describe('skipping', () => {
    async function skipReasonFor(setup: () => void): Promise<string> {
      setup();
      const result = await service.sendBulk(dto as any, TENANT, USER);
      expect(result.skipped).toHaveLength(1);
      return result.skipped[0].reason;
    }

    it('skips a student with no open dues', async () => {
      const reason = await skipReasonFor(() => {
        feeDuesService.getDueSnapshots.mockResolvedValue(new Map());
      });

      expect(reason).toBe(SkipReason.NO_OPEN_DUES);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips a student with no guardians on file', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([student({ guardians: [] })]);
      });

      expect(reason).toBe(SkipReason.NO_GUARDIANS);
    });

    it('skips a student whose guardians relation was not loaded', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([student({ guardians: undefined })]);
      });

      expect(reason).toBe(SkipReason.NO_GUARDIANS);
    });

    it('skips PHONE_CALL, which has no automated provider', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([
          student({ guardians: [guardian({ preferred_communication: CommunicationMedium.PHONE_CALL })] }),
        ]);
      });

      expect(reason).toBe(SkipReason.NO_AUTOMATED_PROVIDER);
    });

    it('skips MESSENGER, which cannot be reached from a phone or email', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([
          student({ guardians: [guardian({ preferred_communication: CommunicationMedium.MESSENGER })] }),
        ]);
      });

      expect(reason).toBe(SkipReason.NO_AUTOMATED_PROVIDER);
    });

    it('skips a guardian with no address for their preferred medium', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([
          student({ guardians: [guardian({ phone: null, alternate_phone: null })] }),
        ]);
      });

      expect(reason).toBe(SkipReason.MISSING_ADDRESS);
    });

    it('skips a guardian whose preferred medium is outside the requested mediums', async () => {
      const result = await service.sendBulk(
        { ...dto, mediums: [CommunicationMedium.EMAIL] } as any,
        TENANT,
        USER,
      );

      expect(result.skipped[0].reason).toBe(SkipReason.MEDIUM_NOT_ALLOWED);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('treats an empty mediums array as no restriction at all', async () => {
      const result = await service.sendBulk({ ...dto, mediums: [] } as any, TENANT, USER);

      expect(result.skipped).toEqual([]);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('names the skipped student and guardian so the caller can act on it', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ id: 'g-7', phone: null, alternate_phone: null })] }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.skipped[0]).toEqual({
        student_id: 's-1',
        guardian_id: 'g-7',
        reason: SkipReason.MISSING_ADDRESS,
      });
    });

    it('completes a batch immediately when every recipient was skipped', async () => {
      feeDuesService.getDueSnapshots.mockResolvedValue(new Map());

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReminderBatchStatus.COMPLETED, total_recipients: 0 }),
      );
      expect(result.status).toBe(ReminderBatchStatus.COMPLETED);
    });

    it('renders an empty due_month when the snapshot has no dated fee', async () => {
      feeDuesService.getDueSnapshots.mockResolvedValue(
        new Map([['s-1', snapshot({ earliest_due_month: null, earliest_due_year: null })]]),
      );

      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message_body: 'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for .',
        }),
      );
    });
  });

  describe('enqueue failures', () => {
    it('marks the log FAILED and counts it against the batch without aborting the rest', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ id: 's-1', guardians: [guardian({ id: 'g-1' })] }),
        student({ id: 's-2', guardians: [guardian({ id: 'g-2' })] }),
      ]);
      feeDuesService.getDueSnapshots.mockResolvedValue(
        new Map([
          ['s-1', snapshot({ student_id: 's-1' })],
          ['s-2', snapshot({ student_id: 's-2' })],
        ]),
      );
      queue.add.mockRejectedValueOnce(new Error('redis down'));

      const result = await service.sendBulk(
        { ...dto, student_ids: ['s-1', 's-2'] } as any,
        TENANT,
        USER,
      );

      expect(result.total_recipients).toBe(2);
      // Second recipient still enqueued despite the first failing.
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(txManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CommunicationStatus.FAILED,
          metadata: expect.objectContaining({ error: 'Failed to enqueue for delivery' }),
        }),
      );
      // Save and counter update happen inside the same transaction callback.
      expect(logRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(txManager.query).toHaveBeenCalledTimes(1);
    });

    it('reports counts re-read after the enqueue loop, not the ones the batch was created with', async () => {
      queue.add.mockRejectedValueOnce(new Error('redis down'));
      batchRepo.findOne.mockResolvedValue({
        ...savedBatch,
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.FAILED,
        total_recipients: 1,
        successful_count: 0,
        failed_count: 1,
        message_template: dto.message_template,
        created_at: new Date(),
      });

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.failed_count).toBe(1);
      expect(result.status).toBe(ReminderBatchStatus.FAILED);
    });

    it('falls back to the in-memory batch if the re-read returns nothing', async () => {
      batchRepo.findOne.mockResolvedValue(null);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.id).toBe('batch-1');
      expect(result.status).toBe(ReminderBatchStatus.PROCESSING);
    });
  });

  describe('findBatch', () => {
    it('scopes the lookup to the caller tenant', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.COMPLETED,
        total_recipients: 3,
        successful_count: 3,
        failed_count: 0,
        message_template: 'x',
        created_at: new Date(),
        filters_applied: { skipped: [{ student_id: 's-9', guardian_id: null, reason: 'no_open_dues' }] },
      });

      const result = await service.findBatch('batch-1', TENANT);

      expect(batchRepo.findOne).toHaveBeenCalledWith({ where: { id: 'batch-1', tenant_id: TENANT } });
      expect(result.successful_count).toBe(3);
      expect(result.skipped).toHaveLength(1);
    });

    it('throws NotFound for a batch belonging to another tenant', async () => {
      batchRepo.findOne.mockResolvedValue(null);

      await expect(service.findBatch('batch-1', 'other-tenant')).rejects.toThrow(NotFoundException);
    });

    it('returns an empty skipped list when filters_applied has none', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.COMPLETED,
        total_recipients: 0,
        successful_count: 0,
        failed_count: 0,
        message_template: null,
        created_at: new Date(),
        filters_applied: null,
      });

      const result = await service.findBatch('batch-1', TENANT);

      expect(result.skipped).toEqual([]);
    });
  });
});
