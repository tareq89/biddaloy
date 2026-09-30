import anekBangla from '../../../styles/fonts/anek-bangla.woff2?url';
import anekLatin from '../../../styles/fonts/anek-latin.woff2?url';
import librebaskerville from '../../../styles/fonts/libre-baskerville.woff2?url';
import notoSansBengali from '../../../styles/fonts/noto-sans-bengali.woff2?url';
import notoSerifBengali from '../../../styles/fonts/noto-serif-bengali.woff2?url';

export interface PrintFont {
  family: string;
  url: string;
  /** Lets two files (Latin + Bangla) share one family. */
  unicodeRange?: string;
}

const BN = 'U+0980-09FF, U+0964-0965, U+200C-200D, U+25CC';
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+2013-2014, U+2018-201A, U+201C-201E, U+2022, U+2026, U+2212';

/** Fonts every template can use without an uploaded FONT asset (D24). */
export const BUNDLED_PRINT_FONTS: PrintFont[] = [
  { family: 'Biddaloy Sans', url: anekLatin, unicodeRange: LATIN },
  { family: 'Biddaloy Sans', url: anekBangla, unicodeRange: BN },
  { family: 'Noto Sans Bengali', url: notoSansBengali },
  { family: 'Noto Serif Bengali', url: notoSerifBengali },
  { family: 'Libre Baskerville', url: librebaskerville, unicodeRange: LATIN },
];
