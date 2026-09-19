import { Injectable } from '@nestjs/common';
import { CalendarEvent } from './entities/calendar-event.entity';

/**
 * Stub for [17.1.2] — every method is a no-op so [17.2.1] can call them and
 * [17.3.3] only has to fill in bodies (push notification on
 * create/update/import) without changing any caller's signature.
 */
@Injectable()
export class CalendarNotifyService {
  async eventCreated(event: CalendarEvent, opts?: Record<string, unknown>): Promise<void> {
    void event;
    void opts;
  }

  async eventUpdated(event: CalendarEvent, opts?: Record<string, unknown>): Promise<void> {
    void event;
    void opts;
  }

  async eventsImported(events: CalendarEvent[], opts?: Record<string, unknown>): Promise<void> {
    void events;
    void opts;
  }
}
