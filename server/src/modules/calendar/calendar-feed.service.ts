import { Injectable } from '@nestjs/common';

/** Stub for [17.1.2] — issues/revokes `CalendarFeedToken`s and renders an
 * ICS feed body for a token. Filled in by a wave-2 lane, which will record
 * audit entries with `entity_type: 'CalendarFeedToken'` (already reserved
 * in `AUDIT_ENTITY_TYPES`). */
@Injectable()
export class CalendarFeedService {}
