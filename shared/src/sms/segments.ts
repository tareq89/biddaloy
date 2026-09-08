/**
 * SMS segment counting for [8.11.9]'s message composition — "Bangla text
 * correctly, including character-count limits for SMS" is an AC, and the
 * two encodings behave very differently: GSM-7 fits 160 characters in one
 * segment (153 each once concatenated), while a unicode message drops to
 * 70 per segment (67 concatenated). A composer that quoted "160 characters
 * left" against a Bangla message would be wrong by more than half, which
 * is why this exists rather than a plain `maxLength`.
 *
 * **The encoding rule here is the server's, not 3GPP TS 23.038's.**
 * `isUnicodeMessage` (`server/src/modules/communications/providers/sms/
 * sms-gateway.interface.ts`) is the only thing that decides how a message
 * is billed, and it is a single ASCII test:
 *
 * ```ts
 * return /[^\x00-\x7F]/.test(message);
 * ```
 *
 * GreenWeb then gets `unicode=1` and MIM gets `type: 'unicode'`, i.e. 70
 * characters per segment. So `é`, `£`, `ñ`, `ø`, `Ç`, `€` — all genuine
 * GSM-7 characters under TS 23.038 — are non-ASCII and therefore billed as
 * unicode by our gateways. Counting them as GSM-7 (the earlier version of
 * this file did) told a sender that a 150-character message containing one
 * "é" was 1 segment when it is actually billed as 3.
 *
 * Within the ASCII branch the septet accounting *is* TS 23.038's, because
 * that is what a GSM-7 route actually puts on the air: the ASCII extension
 * characters (`^ { } \ [ ~ ] |` and form feed) cost an escape septet plus
 * the character, so they count double. That only ever over-estimates, and
 * over-estimating a segment count is the safe direction — a sender is
 * never surprised by an extra segment on the bill.
 */

export type SmsEncoding = 'GSM_7' | 'UCS_2';

export interface SmsSegmentInfo {
  encoding: SmsEncoding;
  /** Septets for GSM-7 (extension characters already counted double);
   * UTF-16 code units for UCS-2 (so an emoji counts 2, matching what the
   * network actually charges). */
  chars: number;
  /** 0 for an empty message — nothing to send is not "1 segment". */
  segments: number;
  /** The per-segment budget the `segments` figure was computed against:
   * 160/153 for GSM-7, 70/67 for UCS-2 (the smaller figure once the
   * message needs concatenation headers). */
  perSegment: number;
}

/** Mirror of the server's `isUnicodeMessage` — any character outside
 * 7-bit ASCII flips the whole message to unicode billing. */
// The server's own rule is literally this range; narrowing it here would
// re-introduce the drift this constant exists to remove.
/* eslint-disable-next-line no-control-regex */
const NON_ASCII = /[^\x00-\x7F]/;

/** GSM-7 extension-table members that are also ASCII, so they survive the
 * unicode test above and still cost two septets each. (`€` is in the
 * extension table too, but it is non-ASCII, so it never reaches here.) */
const GSM7_ASCII_EXTENSION_SET = new Set('^{}\\[~]|\f');

const GSM7_SINGLE = 160;
const GSM7_CONCAT = 153;
const UCS2_SINGLE = 70;
const UCS2_CONCAT = 67;

export function countSmsSegments(text: string): SmsSegmentInfo {
  if (!NON_ASCII.test(text)) {
    let septets = 0;
    for (const char of text) {
      septets += GSM7_ASCII_EXTENSION_SET.has(char) ? 2 : 1;
    }
    const segments =
      septets === 0 ? 0 : septets <= GSM7_SINGLE ? 1 : Math.ceil(septets / GSM7_CONCAT);
    return {
      encoding: 'GSM_7',
      chars: septets,
      segments,
      perSegment: segments > 1 ? GSM7_CONCAT : GSM7_SINGLE,
    };
  }

  // UCS-2 charges per UTF-16 code unit — `.length`, not code points.
  const units = text.length;
  const segments = units === 0 ? 0 : units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_CONCAT);
  return {
    encoding: 'UCS_2',
    chars: units,
    segments,
    perSegment: segments > 1 ? UCS2_CONCAT : UCS2_SINGLE,
  };
}
