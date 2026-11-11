import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunicationMedium } from '@biddaloy/shared';
import { AdminNoticeService } from '../../schools/trial/admin-notice.service';
import type { SupportSetting } from '../../schools/trial/admin-notice-templates';
import {
  AccountAccessDeliveryService,
  type DeliverInput,
} from '../../account-access/account-access-delivery.service';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';

export interface SupportEntry {
  /** Biddaloy staff member's full name. */
  person: string;
  /** Role entered as, already a plain label. */
  role: string;
  reason: string;
  /** Already formatted for the reader. */
  time: string;
}

export interface NoticeRecipient {
  name: string;
  email?: string | null;
  phone?: string | null;
}

/**
 * One method per support-access message. Every method is best effort: a failed send is logged and
 * never reaches the caller. No method takes a token, a code or a URL fragment, so none can leak one.
 */
@Injectable()
export class SupportAccessNoticeService {
  private readonly logger = new Logger(SupportAccessNoticeService.name);

  constructor(
    private readonly adminNotice: AdminNoticeService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly config: ConfigService,
  ) {}

  /** `allowed` setting: email to every school admin. */
  sessionStarted(schoolId: string, e: SupportEntry): Promise<void> {
    return this.safe('support_session_started', () =>
      this.adminNotice.notifyAdmins(schoolId, 'support_session_started', e, { emailOnly: true }),
    );
  }

  /** Emergency entry: SMS and email, read only. */
  emergency(schoolId: string, e: SupportEntry): Promise<void> {
    return this.safe('support_emergency', () =>
      this.adminNotice.notifyAdmins(schoolId, 'support_emergency', e),
    );
  }

  /** `ask` setting: a request to every admin, link to the answer page. */
  requestToAdmins(schoolId: string, requestId: string, e: SupportEntry): Promise<void> {
    return this.safe('support_request', () => {
      const link = `${resolveAppBaseUrl(this.config)}/support-access/requests/${requestId}`;
      return this.adminNotice.notifyAdmins(schoolId, 'support_request', { ...e, link });
    });
  }

  /** The switch changed: email to the other admins, not the one who changed it. */
  modeChanged(
    schoolId: string,
    c: { person: string; mode: SupportSetting; time: string; changedByUserId: string },
  ): Promise<void> {
    return this.safe('support_mode_changed', () =>
      this.adminNotice.notifyAdmins(
        schoolId,
        'support_mode_changed',
        { person: c.person, mode: c.mode, time: c.time },
        { emailOnly: true, exceptUserId: c.changedByUserId },
      ),
    );
  }

  /** Both owners, every entry. One failing recipient never stops the rest. */
  async ownersSessionStarted(
    owners: NoticeRecipient[],
    e: SupportEntry & { targetSchool: string },
  ): Promise<void> {
    const vars = {
      target_school: e.targetSchool,
      role: e.role,
      person: e.person,
      reason: e.reason,
    };
    for (const o of owners) await this.toPerson('SUPPORT_SESSION_OWNER_NOTICE', o, vars);
  }

  /** The school allowed the request: tell the owner who asked. The link opens the cockpit page. */
  ticketReady(owner: NoticeRecipient, schoolId: string, targetSchool: string): Promise<void> {
    return this.safe('SUPPORT_TICKET_READY', () => {
      const link = `${resolveAppBaseUrl(this.config)}/schools/${schoolId}`;
      return this.toPerson('SUPPORT_TICKET_READY', owner, { target_school: targetSchool, link });
    });
  }

  private async toPerson(
    kind: DeliverInput['kind'],
    to: NoticeRecipient,
    vars: DeliverInput['vars'],
  ): Promise<void> {
    const targets: { medium: DeliverInput['medium']; address?: string | null }[] = [
      { medium: CommunicationMedium.EMAIL, address: to.email },
      { medium: CommunicationMedium.SMS, address: to.phone },
    ];
    for (const { medium, address } of targets) {
      if (!address) continue;
      await this.safe(kind, () =>
        this.delivery.deliver({
          tenantId: null,
          medium,
          to: address,
          recipientName: to.name,
          kind,
          vars,
        }),
      );
    }
  }

  private async safe(what: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch {
      // Name only: the error text may carry an address or a body.
      this.logger.error(`Support access notice ${what} failed`);
    }
  }
}
