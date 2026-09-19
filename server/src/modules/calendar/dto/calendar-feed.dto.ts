import { ApiProperty } from '@nestjs/swagger';

/** Response for `GET /calendar/feed` and `POST /calendar/feed/regenerate`
 * (17.4.1) — the caller's own active feed token, as a ready-to-subscribe
 * URL. `url` embeds the raw token; the server only ever stores its hash
 * (see `CalendarFeedToken` entity doc). */
export class CalendarFeedDto {
  @ApiProperty({ description: 'Full subscribable ICS feed URL, including the raw token.' })
  url: string;

  @ApiProperty({ description: 'When this feed token was issued.' })
  created_at: string;
}
