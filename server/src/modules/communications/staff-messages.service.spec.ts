import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CommunicationMedium, UserRole } from '@biddaloy/shared';
import {
  STAFF_MESSAGE_DUPLICATE,
  STAFF_MESSAGE_FORBIDDEN,
  STAFF_MESSAGE_INSUFFICIENT_CREDIT,
  STAFF_MESSAGE_NO_AUDIENCE,
  STAFF_MESSAGE_NO_RECIPIENTS,
  StaffMessagesService,
} from './staff-messages.service';
import { StaffMessageDto } from './dto/staff-message.dto';

const PHONE = '+8801712345678';
const NAME = 'Secret Teacher Name';

function build(opts: {
  recipients?: { user_id: string; name: string; phone: string }[];
  skipped?: { user_id: string; name: string; reason: 'no_phone' }[];
  metered?: boolean;
  available?: number;
  reserve?: () => Promise<unknown>;
  duplicate?: number;
}) {
  const batchRepo: any = {
    create: (x: any) => x,
    save: vi.fn(async (x: any) => ({ id: 'batch-1', ...x })),
    delete: vi.fn(async () => undefined),
    createQueryBuilder: () => {
      const q: any = {
        where: () => q,
        andWhere: () => q,
        getCount: async () => opts.duplicate ?? 0,
      };
      return q;
    },
  };
  // send() takes an advisory lock, counts and inserts inside one transaction.
  batchRepo.manager = {
    transaction: async (fn: (m: any) => unknown) =>
      fn({ query: vi.fn(async () => []), getRepository: () => batchRepo }),
  };
  const logRepo: any = {
    create: (x: any) => x,
    save: vi.fn(async (x: any) => ({ id: `log-${Math.random()}`, ...x })),
  };
  const queue: any = { add: vi.fn(async () => undefined) };
  const audience: any = {
    resolve: vi.fn(async () => ({
      recipients: opts.recipients ?? [],
      skipped: opts.skipped ?? [],
    })),
  };
  const credits: any = {
    isMetered: vi.fn(async () => opts.metered ?? false),
    getBalance: vi.fn(async () => ({ available: opts.available ?? 0, reserved: 0 })),
    reserve: vi.fn(opts.reserve ?? (async () => ({ ok: true }))),
    settlePart: vi.fn(),
  };
  const audit: any = { record: vi.fn(async () => undefined) };
  return {
    service: new StaffMessagesService(logRepo, batchRepo, queue, audience, credits, audit),
    batchRepo,
    logRepo,
    queue,
    audience,
    credits,
    audit,
  };
}

const sms = (message = 'Hello team'): StaffMessageDto =>
  ({ audience: { roles: [UserRole.TEACHER] }, message, medium: CommunicationMedium.SMS }) as any;
const one = [{ user_id: 'u1', name: NAME, phone: PHONE }];

describe('StaffMessagesService', () => {
  describe('callerScope', () => {
    const { service } = build({});
    it('ADMIN and EXECUTIVE are school-wide', () => {
      expect(service.callerScope(UserRole.ADMIN)).toBe('school');
      expect(service.callerScope(UserRole.EXECUTIVE)).toBe('school');
    });
    it('TEACHER is coordinated only', () => {
      expect(service.callerScope(UserRole.TEACHER)).toBe('coordinated');
    });
    it.each([
      UserRole.ACCOUNTANT,
      UserRole.OFFICE_STAFF,
      UserRole.PARENT,
      UserRole.STUDENT,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
    ])('%s is refused with the fixed sentence', (role) => {
      expect(() => service.callerScope(role)).toThrow(ForbiddenException);
      expect(() => service.callerScope(role)).toThrow(STAFF_MESSAGE_FORBIDDEN);
    });
  });

  describe('preview', () => {
    it('counts segments from the text as typed and multiplies by people with a phone', async () => {
      const { service } = build({
        recipients: [...one, { user_id: 'u2', name: 'B', phone: '+8801700000000' }],
        skipped: [{ user_id: 'u3', name: 'C', reason: 'no_phone' }],
      });
      // 200 GSM-7 chars = 2 segments (153 per part when concatenated).
      const res = await service.preview(sms('a'.repeat(200)), 't', 'me', UserRole.ADMIN);
      expect(res).toMatchObject({
        people: 3,
        with_phone: 2,
        segments_each: 2,
        credits_needed: 4,
        balance: null,
        shortfall: 0,
        whatsapp_template: null,
      });
      expect(res.skipped).toEqual([{ user_id: 'u3', name: 'C', reason: 'no_phone' }]);
    });

    it('reports balance and shortfall when the school meters SMS', async () => {
      const { service } = build({ recipients: one, metered: true, available: 0 });
      const res = await service.preview(sms(), 't', 'me', UserRole.ADMIN);
      expect(res).toMatchObject({ credits_needed: 1, balance: 0, shortfall: 1 });
    });

    it('WhatsApp costs no SMS credit and shows the template that will be delivered', async () => {
      const { service, credits } = build({ recipients: one, metered: true });
      const dto = {
        audience: { roles: [UserRole.TEACHER] },
        message: 'x',
        medium: CommunicationMedium.WHATSAPP,
        whatsapp_template_name: 'staff_notice',
        whatsapp_template_language: 'bn',
        whatsapp_template_params: ['Exam day'],
      } as any;
      const res = await service.preview(dto, 't', 'me', UserRole.ADMIN);
      expect(res.credits_needed).toBe(0);
      expect(credits.getBalance).not.toHaveBeenCalled();
      expect(res.whatsapp_template).toEqual({
        name: 'staff_notice',
        language: 'bn',
        params: ['Exam day'],
      });
    });

    it('a coordinator with nobody in their classes gets the fixed 400, with no input echoed', async () => {
      const { service, audience } = build({});
      const err = await service
        .preview(sms('secret text'), 't', 'coord', UserRole.TEACHER)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(STAFF_MESSAGE_NO_AUDIENCE);
      // Coordinator scope is passed down, not decided by the client.
      expect(audience.resolve).toHaveBeenCalledWith('t', expect.anything(), {
        coordinatedOnly: true,
        callerUserId: 'coord',
      });
    });
  });

  describe('send', () => {
    it('refuses when nobody has a phone, creating nothing', async () => {
      const { service, batchRepo } = build({
        skipped: [{ user_id: 'u', name: 'x', reason: 'no_phone' }],
      });
      await expect(service.send(sms(), 't', 'me', UserRole.ADMIN)).rejects.toThrow(
        STAFF_MESSAGE_NO_RECIPIENTS,
      );
      expect(batchRepo.save).not.toHaveBeenCalled();
    });

    it('reserves under batch:<id> before any log or job exists', async () => {
      const { service, credits, logRepo, queue } = build({ recipients: one, metered: true });
      const order: string[] = [];
      credits.reserve.mockImplementation(async () => {
        order.push('reserve');
        return { ok: true };
      });
      logRepo.save.mockImplementation(async (x: any) => {
        order.push('log');
        return { id: 'l1', ...x };
      });
      const res = await service.send(sms(), 't', 'me', UserRole.ADMIN);
      expect(order).toEqual(['reserve', 'log']);
      expect(credits.reserve).toHaveBeenCalledWith('t', 1, 'batch:batch-1', {
        type: 'batch',
        id: 'batch-1',
      });
      expect(queue.add).toHaveBeenCalledWith('send', {
        logId: 'l1',
        batchId: 'batch-1',
        segments: 1,
      });
      expect(res).toMatchObject({ batch_id: 'batch-1', queued: 1, failed: 0 });
    });

    it('an unmetered school queues jobs without segments (nothing reserved to settle)', async () => {
      const { service, credits, queue } = build({ recipients: one, metered: false });
      await service.send(sms(), 't', 'me', UserRole.ADMIN);
      expect(credits.reserve).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith('send', {
        logId: expect.any(String),
        batchId: 'batch-1',
      });
      expect(queue.add.mock.calls[0][1]).not.toHaveProperty('segments');
    });

    it('whitespace-only text is rejected by the DTO with a fixed sentence', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const dto = plainToInstance(StaffMessageDto, {
        audience: { roles: [UserRole.TEACHER] },
        message: '   \n ',
        medium: CommunicationMedium.SMS,
      });
      const errors = await validate(dto);
      const msgs = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      expect(msgs).toContain('Write a message.');
    });

    it('insufficient credit deletes the batch, writes no log or job, same 409 shape', async () => {
      const { service, batchRepo, logRepo, queue } = build({
        recipients: one,
        metered: true,
        reserve: async () => ({ ok: false, available: 0 }),
      });
      const err = await service.send(sms(), 't', 'me', UserRole.ADMIN).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({
        message: STAFF_MESSAGE_INSUFFICIENT_CREDIT,
        details: { code: 'INSUFFICIENT_SMS_CREDIT', required: 1, available: 0 },
      });
      expect(batchRepo.delete).toHaveBeenCalledWith({ id: 'batch-1', tenant_id: 't' });
      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('a throwing reserve also deletes the batch and rethrows', async () => {
      const { service, batchRepo, logRepo } = build({
        recipients: one,
        metered: true,
        reserve: async () => {
          throw new Error('redis down');
        },
      });
      await expect(service.send(sms(), 't', 'me', UserRole.ADMIN)).rejects.toThrow('redis down');
      expect(batchRepo.delete).toHaveBeenCalled();
      expect(logRepo.save).not.toHaveBeenCalled();
    });

    it('a duplicate inside the window is a 409 with the fixed sentence, no echo', async () => {
      const { service, batchRepo } = build({ recipients: one, duplicate: 1 });
      const err = await service.send(sms('secret text'), 't', 'me', UserRole.ADMIN).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(STAFF_MESSAGE_DUPLICATE);
      expect(JSON.stringify(err.getResponse())).not.toContain('secret text');
      expect(batchRepo.save).not.toHaveBeenCalled();
    });

    it('WhatsApp stores the template on the log and never reserves credit', async () => {
      const { service, credits, logRepo, queue } = build({ recipients: one, metered: true });
      const dto = {
        audience: { roles: [UserRole.TEACHER] },
        message: 'x',
        medium: CommunicationMedium.WHATSAPP,
        whatsapp_template_name: 'staff_notice',
        whatsapp_template_language: 'bn',
        whatsapp_template_params: ['p1'],
      } as any;
      await service.send(dto, 't', 'me', UserRole.ADMIN);
      expect(credits.reserve).not.toHaveBeenCalled();
      expect(logRepo.save.mock.calls[0][0].metadata).toEqual({
        template_name: 'staff_notice',
        template_language: 'bn',
        template_params: ['p1'],
      });
      expect(queue.add).toHaveBeenCalledWith('send', {
        logId: expect.any(String),
        batchId: 'batch-1',
      });
    });

    it('fixed sentences never carry a phone or name', async () => {
      const texts = [
        STAFF_MESSAGE_FORBIDDEN,
        STAFF_MESSAGE_NO_AUDIENCE,
        STAFF_MESSAGE_NO_RECIPIENTS,
        STAFF_MESSAGE_DUPLICATE,
        STAFF_MESSAGE_INSUFFICIENT_CREDIT,
      ];
      for (const t of texts) {
        expect(t).not.toContain(PHONE);
        expect(t).not.toContain(NAME);
      }
    });
  });
});
