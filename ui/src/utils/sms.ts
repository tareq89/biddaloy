/**
 * SMS segment counting for [8.11.9]'s message composition — "Bangla text
 * correctly, including character-count limits for SMS" is an AC, and the
 * two encodings behave very differently: GSM-7 fits 160 characters in one
 * segment (153 each once concatenated), while any character outside the
 * GSM-7 tables — which is *every* Bangla character — forces the whole
 * message to UCS-2 at 70 per segment (67 concatenated). A composer that
 * quoted "160 characters left" against a Bangla message would be wrong by
 * more than half, which is why this exists rather than a plain
 * `maxLength`.
 *
 * Tables are 3GPP TS 23.038's default alphabet. Extension-table
 * characters (`{}[]~^€|\` and form feed) are GSM-7 but cost two septets
 * each — an escape plus the character — so they count double.
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

// 3GPP TS 23.038 basic character set. `\n`/`\r` are real members; the
// ESC slot is omitted (it's the escape *into* the extension table, not a
// typable character).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑܧ¿abcdefghijklmnopqrstuvwxyzäöñüà';

// Extension table — each costs two septets (ESC + char).
const GSM7_EXTENSION = '^{}\\[~]|€\f';

const GSM7_BASIC_SET = new Set(GSM7_BASIC);
const GSM7_EXTENSION_SET = new Set(GSM7_EXTENSION);

const GSM7_SINGLE = 160;
const GSM7_CONCAT = 153;
const UCS2_SINGLE = 70;
const UCS2_CONCAT = 67;

export function countSmsSegments(text: string): SmsSegmentInfo {
  let gsmSeptets = 0;
  let fitsGsm7 = true;

  // `for..of` iterates code points, so an astral character (emoji, some
  // symbols) arrives whole here and correctly fails both GSM-7 tables.
  for (const char of text) {
    if (GSM7_BASIC_SET.has(char)) {
      gsmSeptets += 1;
    } else if (GSM7_EXTENSION_SET.has(char)) {
      gsmSeptets += 2;
    } else {
      fitsGsm7 = false;
      break;
    }
  }

  if (fitsGsm7) {
    const segments =
      gsmSeptets === 0 ? 0 : gsmSeptets <= GSM7_SINGLE ? 1 : Math.ceil(gsmSeptets / GSM7_CONCAT);
    return {
      encoding: 'GSM_7',
      chars: gsmSeptets,
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
