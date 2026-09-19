import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicHolidaySource } from '@biddaloy/shared';
import { parseIcsEvents } from './ics/ics-parse.util';

export interface FetchedHolidayEntry {
  date: string;
  end_date: string;
  name: string;
}

export interface FetchedHolidaySet {
  source: PublicHolidaySource;
  entries: FetchedHolidayEntry[];
}

/** Thrown when neither the Google ICS feed nor the Nager.Date fallback
 * returns anything usable — the controller maps this to a 502 with code
 * `PUBLIC_HOLIDAY_SOURCE_UNAVAILABLE`. */
export class PublicHolidaySourceUnavailableError extends Error {
  constructor(country: string, year: number) {
    super(`No public-holiday source available for ${country}/${year}`);
    this.name = 'PublicHolidaySourceUnavailableError';
  }
}

/** Google's public per-country holiday calendar ids, `en.<id>` variant —
 * least the set the plan requires. Extend as more countries onboard. */
const GOOGLE_CALENDAR_IDS: Record<string, string> = {
  BD: 'bangladesh',
  IN: 'indian',
  PK: 'pakistan',
  GB: 'uk',
  US: 'usa',
  MY: 'malaysia',
  SA: 'saudiarabia',
  AE: 'ae',
};

const DEFAULT_TIMEOUT_MS = 8000;

interface NagerHoliday {
  date: string;
  localName?: string;
  name: string;
}

/**
 * Fetches a country/year's public holidays from an external source into a
 * plain `{ source, entries }` shape — [17.2.4]. **Never called from a
 * tenant-scoped route (D10)**: only `PublicHolidaysService`'s platform-side
 * `fetchIntoSet` calls this, gated `SUPER_ADMIN`. A tenant never triggers an
 * outbound call to a third party as a side effect of its own request.
 */
@Injectable()
export class PublicHolidayFetchService {
  private readonly logger = new Logger(PublicHolidayFetchService.name);

  constructor(private readonly config: ConfigService) {}

  private timeoutMs(): number {
    const raw = this.config.get<string>('PUBLIC_HOLIDAY_FETCH_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  async fetch(country: string, year: number): Promise<FetchedHolidaySet> {
    const google = await this.tryGoogle(country, year);
    if (google && google.length > 0) {
      return { source: PublicHolidaySource.GOOGLE_ICS, entries: google };
    }

    const nager = await this.tryNager(country, year);
    if (nager && nager.length > 0) {
      return { source: PublicHolidaySource.NAGER_DATE, entries: nager };
    }

    throw new PublicHolidaySourceUnavailableError(country, year);
  }

  private async tryGoogle(country: string, year: number): Promise<FetchedHolidayEntry[] | null> {
    const calendarId = GOOGLE_CALENDAR_IDS[country.toUpperCase()];
    if (!calendarId) return null;

    const url = `https://calendar.google.com/calendar/ical/en.${calendarId}%23holiday%40group.v.calendar.google.com/public/basic.ics`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs()) });
      if (!response.ok) return null;

      const body = await response.text();
      if (!body) return null;

      const events = parseIcsEvents(body);
      const filtered = events.filter((event) => event.date.startsWith(`${year}-`));
      return filtered.map((event) => ({
        date: event.date,
        end_date: event.end_date,
        name: event.name,
      }));
    } catch (error) {
      this.logger.warn(
        `Google ICS fetch failed for ${country}/${year}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async tryNager(country: string, year: number): Promise<FetchedHolidayEntry[] | null> {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country.toUpperCase()}`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs()) });
      if (!response.ok) return null;

      const body = (await response.json()) as NagerHoliday[];
      if (!Array.isArray(body) || body.length === 0) return null;

      return body.map((holiday) => ({
        date: holiday.date,
        end_date: holiday.date,
        name: holiday.localName ?? holiday.name,
      }));
    } catch (error) {
      this.logger.warn(
        `Nager.Date fetch failed for ${country}/${year}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
