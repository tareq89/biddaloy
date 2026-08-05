import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SingleReminderService } from './single-reminder.service';
import { SkipReason } from './reminders.service';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@beton-boi/shared';

const TENANT = 'tenant-1';
const USER = 'user-1';
const STUDENT_ID = 's-1';

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
    id: STUDENT_ID,
    full_name: 'Rahim Uddin',
    guardians: [guardian()],
    ...overrides,
  };
}

function snapshot(overrides: Partial<any> = {}) {
  return {
    student_id: STUDENT_ID,
    total_due: 1500,
    earliest_due_month: 3,
    earliest_due_year: 2026,
    ...overrides,
  };
}

describe('SingleReminderService', () => {
  let service: SingleReminderService;
  let logRepo: Record<string, ReturnType<typeof vi.fn>>;
  let queue: Record<string, ReturnType<typeof vi.fn>>;
  let studentService: Record<string, ReturnType<typeof vi.fn>>;
  let guardianService: Record<string, ReturnType<typeof vi.fn>>;
  let feeDuesService: Record<string, ReturnType<typeof vi.fn>>;
  let auditService: Record<string, ReturnType<typeof vi.fn>>;

  const dto = {
    message_template:
      'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}} for {{due_month}}.',
  };

  beforeEach(() => {
    logRepo = {
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn(async (v) => ({ id: 'log-1', status: CommunicationStatus.QUEUED, ...v })),
    };
    queue = { add: vi.fn(async () => undefined) };
    studentService = { findOne: vi.fn(async () => student()) };
    guardianService = { findOne: vi.fn() };
    feeDuesService = { getDueSnapshots: vi.fn(async () => new Map([[STUDENT_ID, snapshot()]])) };
    auditService = { record: vi.fn(async () => undefined) };

    service = new SingleReminderService(
      logRepo as any,
      queue as any,
      studentService as any,
      guardianService as any,
      feeDuesService as any,
      auditService as any,
    );
  });

  describe('validation', () => {
    it('rejects an unsupported template placeholder before touching the student', async () => {
      await expect(
        service.preview(STUDENT_ID, { ...dto, message_template: 'Hi {{parent}}' } as any, TENANT),
      ).rejects.toThrow(BadRequestException);

      expect(studentService.findOne).not.toHaveBeenCalled();
    });

    it('rejects unsupported whatsapp_template_params', async () => {
      await expect(
        service.preview(
          STUDENT_ID,
          {
            ...dto,
            whatsapp_template_name: 'fee_reminder',
            whatsapp_template_params: ['nope'],
          } as any,
          TENANT,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates NotFoundException when the student does not resolve in this tenant', async () => {
      studentService.findOne.mockRejectedValue(new NotFoundException('not found'));

      await expect(service.preview(STUDENT_ID, dto as any, TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('errors when the student has no guardians and none were specified', async () => {
      studentService.findOne.mockResolvedValue(student({ guardians: [] }));

      await expect(service.preview(STUDENT_ID, dto as any, TENANT)).rejects.toThrow(
        /no guardians on file/,
      );
    });

    it('errors when the student has no open dues', async () => {
      feeDuesService.getDueSnapshots.mockResolvedValue(new Map());

      await expect(service.preview(STUDENT_ID, dto as any, TENANT)).rejects.toThrow(/no open dues/);
    });

    it('errors when every candidate guardian is undeliverable, listing reasons', async () => {
      studentService.findOne.mockResolvedValue(
        student({ guardians: [guardian({ phone: null, alternate_phone: null, email: null })] }),
      );

      await expect(service.preview(STUDENT_ID, dto as any, TENANT)).rejects.toThrow(
        /No deliverable guardian/,
      );
    });
  });

  describe('guardian selection', () => {
    it('defaults to primary-contact guardians when guardian_ids is omitted', async () => {
      studentService.findOne.mockResolvedValue(
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: false }),
          ],
        }),
      );

      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.recipients.map((r) => r.guardian_id)).toEqual(['g-1']);
    });

    it('contacts exactly the guardians named in guardian_ids', async () => {
      studentService.findOne.mockResolvedValue(
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: false }),
          ],
        }),
      );
      guardianService.findOne.mockResolvedValue(guardian({ id: 'g-2', is_primary_contact: false }));

      const result = await service.preview(
        STUDENT_ID,
        { ...dto, guardian_ids: ['g-2'] } as any,
        TENANT,
      );

      expect(result.recipients.map((r) => r.guardian_id)).toEqual(['g-2']);
      expect(guardianService.findOne).toHaveBeenCalledWith('g-2', TENANT);
    });

    it('deduplicates repeated guardian_ids', async () => {
      guardianService.findOne.mockResolvedValue(guardian({ id: 'g-1' }));

      await service.preview(STUDENT_ID, { ...dto, guardian_ids: ['g-1', 'g-1'] } as any, TENANT);

      expect(guardianService.findOne).toHaveBeenCalledTimes(1);
    });

    it('propagates NotFoundException for a guardian_id from another tenant', async () => {
      guardianService.findOne.mockRejectedValue(new NotFoundException('not found'));

      await expect(
        service.preview(STUDENT_ID, { ...dto, guardian_ids: ['g-99'] } as any, TENANT),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a guardian_id that exists in the tenant but is not linked to this student', async () => {
      guardianService.findOne.mockResolvedValue(guardian({ id: 'g-unrelated' }));

      await expect(
        service.preview(STUDENT_ID, { ...dto, guardian_ids: ['g-unrelated'] } as any, TENANT),
      ).rejects.toThrow(/not linked to student/);
    });

    it('treats an explicit empty guardian_ids the same as omitting it', async () => {
      const result = await service.preview(STUDENT_ID, { ...dto, guardian_ids: [] } as any, TENANT);

      expect(guardianService.findOne).not.toHaveBeenCalled();
      expect(result.recipients.map((r) => r.guardian_id)).toEqual(['g-1']);
    });

    it('rejects guardian_ids when the guardians relation was not loaded on the student', async () => {
      studentService.findOne.mockResolvedValue(student({ guardians: undefined }));
      guardianService.findOne.mockResolvedValue(guardian({ id: 'g-1' }));

      await expect(
        service.preview(STUDENT_ID, { ...dto, guardian_ids: ['g-1'] } as any, TENANT),
      ).rejects.toThrow(/not linked to student/);
    });
  });

  describe('medium override', () => {
    it('uses the guardian preferred medium when no override is given', async () => {
      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.recipients[0].medium).toBe(CommunicationMedium.SMS);
    });

    it('overrides every selected guardian medium for this call only', async () => {
      studentService.findOne.mockResolvedValue(
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.SMS })] }),
      );

      const result = await service.preview(
        STUDENT_ID,
        { ...dto, medium: CommunicationMedium.EMAIL } as any,
        TENANT,
      );

      expect(result.recipients[0].medium).toBe(CommunicationMedium.EMAIL);
      expect(result.recipients[0].address).toBe('karim@example.com');
    });

    it('does not mutate the guardian record with the override', async () => {
      const g = guardian({ preferred_communication: CommunicationMedium.SMS });
      studentService.findOne.mockResolvedValue(student({ guardians: [g] }));

      await service.preview(
        STUDENT_ID,
        { ...dto, medium: CommunicationMedium.EMAIL } as any,
        TENANT,
      );

      expect(g.preferred_communication).toBe(CommunicationMedium.SMS);
    });

    it('skips PHONE_CALL, which has no automated provider, even as an override', async () => {
      await expect(
        service.preview(
          STUDENT_ID,
          { ...dto, medium: CommunicationMedium.PHONE_CALL } as any,
          TENANT,
        ),
      ).rejects.toThrow(/No deliverable guardian/);
    });
  });

  describe('preview', () => {
    it('renders the template per recipient without writing anything', async () => {
      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.recipients[0].message_body).toBe(
        'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for March 2026.',
      );
      expect(logRepo.create).not.toHaveBeenCalled();
      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('sets a subject only for an EMAIL recipient', async () => {
      studentService.findOne.mockResolvedValue(
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.EMAIL })] }),
      );

      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.recipients[0].subject).toBe('Fee Reminder');
    });

    it('leaves the subject null for a non-email recipient', async () => {
      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.recipients[0].subject).toBeNull();
    });

    it('reports the student_id and skipped guardians alongside recipients', async () => {
      studentService.findOne.mockResolvedValue(
        student({
          guardians: [guardian({ id: 'g-1', is_primary_contact: true })],
        }),
      );

      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.student_id).toBe(STUDENT_ID);
      expect(result.skipped).toEqual([]);
    });

    it('renders an empty due_month when the snapshot has no dated fee', async () => {
      feeDuesService.getDueSnapshots.mockResolvedValue(
        new Map([[STUDENT_ID, snapshot({ earliest_due_month: null, earliest_due_year: null })]]),
      );

      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.recipients[0].message_body).toBe(
        'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for .',
      );
    });

    it('lists a skipped guardian with its reason alongside deliverable ones', async () => {
      studentService.findOne.mockResolvedValue(
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: true, phone: null, alternate_phone: null }),
          ],
        }),
      );

      const result = await service.preview(STUDENT_ID, dto as any, TENANT);

      expect(result.recipients.map((r) => r.guardian_id)).toEqual(['g-1']);
      expect(result.skipped).toEqual([
        { guardian_id: 'g-2', guardian_name: 'Karim Uddin', reason: SkipReason.MISSING_ADDRESS },
      ]);
    });
  });

  describe('sendSingle', () => {
    it('creates one QUEUED CommunicationLog per recipient tagged MANUAL, with no batch', async () => {
      await service.sendSingle(STUDENT_ID, dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          student_id: STUDENT_ID,
          guardian_id: 'g-1',
          sent_by_user_id: USER,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.MANUAL,
        }),
      );
      expect(logRepo.create.mock.calls[0][0]).not.toHaveProperty('reminder_batch_id');
      expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
    });

    it('renders the template into the log message_body', async () => {
      await service.sendSingle(STUDENT_ID, dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message_body: 'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for March 2026.',
        }),
      );
    });

    it('sets a subject for an EMAIL recipient and enqueues the log', async () => {
      studentService.findOne.mockResolvedValue(
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.EMAIL })] }),
      );

      await service.sendSingle(STUDENT_ID, dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ medium: CommunicationMedium.EMAIL, subject: 'Fee Reminder' }),
      );
    });

    it('sends one message per selected guardian', async () => {
      studentService.findOne.mockResolvedValue(
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: true }),
          ],
        }),
      );

      const result = await service.sendSingle(STUDENT_ID, dto as any, TENANT, USER);

      expect(result.sent).toHaveLength(2);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('marks a log FAILED when enqueueing fails, without aborting other recipients', async () => {
      studentService.findOne.mockResolvedValue(
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: true }),
          ],
        }),
      );
      queue.add.mockRejectedValueOnce(new Error('redis down'));

      const result = await service.sendSingle(STUDENT_ID, dto as any, TENANT, USER);

      expect(result.sent).toHaveLength(2);
      expect(result.sent[0].status).toBe(CommunicationStatus.FAILED);
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(logRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CommunicationStatus.FAILED,
          metadata: expect.objectContaining({ error: 'Failed to enqueue for delivery' }),
        }),
      );
      // Derived from each recipient's actual status, not just sent.length —
      // one guardian's enqueue failure must show up as a failure here too.
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: expect.objectContaining({ queued_count: 1, failed_count: 1 }),
        }),
      );
    });

    it('returns the skipped guardians alongside what was sent', async () => {
      studentService.findOne.mockResolvedValue(
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: true, phone: null, alternate_phone: null }),
          ],
        }),
      );

      const result = await service.sendSingle(STUDENT_ID, dto as any, TENANT, USER);

      expect(result.sent).toHaveLength(1);
      expect(result.skipped).toEqual([
        { guardian_id: 'g-2', guardian_name: 'Karim Uddin', reason: SkipReason.MISSING_ADDRESS },
      ]);
    });

    describe('WhatsApp template metadata', () => {
      beforeEach(() => {
        studentService.findOne.mockResolvedValue(
          student({
            guardians: [guardian({ preferred_communication: CommunicationMedium.WHATSAPP })],
          }),
        );
      });

      it('maps named template params onto positional values in order', async () => {
        await service.sendSingle(
          STUDENT_ID,
          {
            ...dto,
            whatsapp_template_name: 'fee_reminder',
            whatsapp_template_language: 'bn',
            whatsapp_template_params: ['guardian_name', 'due_amount'],
          } as any,
          TENANT,
          USER,
        );

        expect(logRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              template_name: 'fee_reminder',
              template_language: 'bn',
              template_params: ['Karim Uddin', '1,500.00'],
            },
          }),
        );
      });

      it('leaves metadata null when no template name was supplied', async () => {
        await service.sendSingle(STUDENT_ID, dto as any, TENANT, USER);

        expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
      });

      it('defaults template_params to an empty array when omitted', async () => {
        await service.sendSingle(
          STUDENT_ID,
          { ...dto, whatsapp_template_name: 'fee_reminder' } as any,
          TENANT,
          USER,
        );

        expect(logRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              template_name: 'fee_reminder',
              template_language: undefined,
              template_params: [],
            },
          }),
        );
      });
    });

    it('does not attach WhatsApp metadata to a non-WhatsApp recipient', async () => {
      await service.sendSingle(
        STUDENT_ID,
        { ...dto, whatsapp_template_name: 'fee_reminder' } as any,
        TENANT,
        USER,
      );

      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
    });
  });
});
