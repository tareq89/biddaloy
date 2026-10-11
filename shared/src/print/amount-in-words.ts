/**
 * Amount in words, Bangladeshi grouping (crore / lakh / thousand / hundred).
 * One helper for the server A4/POS templates and the browser receipt, so both
 * runtimes print the same words (SENSE-10).
 */

const EN_ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]; // prettier-ignore
const EN_TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

// 0–99, standard Bangla spellings.
const BN_WORDS = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বাহান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'অষ্টাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
]; // prettier-ignore

type Locale = 'en' | 'bn';

const under100 = (n: number, l: Locale): string => {
  if (l === 'bn') return BN_WORDS[n];
  if (n < 20) return EN_ONES[n];
  return EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN_ONES[n % 10]}` : '');
};

/** Words for a positive whole number; zero is handled by the caller. */
const words = (n: number, l: Locale): string => {
  const unit = l === 'bn' ? ['কোটি', 'লক্ষ', 'হাজার'] : ['Crore', 'Lakh', 'Thousand'];
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  // The crore count can itself be >= 100, so it is spelled recursively.
  if (crore) parts.push(`${words(crore, l)} ${unit[0]}`);
  const lakh = Math.floor((n % 1e7) / 1e5);
  if (lakh) parts.push(`${under100(lakh, l)} ${unit[1]}`);
  const thousand = Math.floor((n % 1e5) / 1e3);
  if (thousand) parts.push(`${under100(thousand, l)} ${unit[2]}`);
  const h = Math.floor((n % 1e3) / 100);
  if (h) parts.push(l === 'bn' ? `${BN_WORDS[h]}শত` : `${EN_ONES[h]} Hundred`);
  if (n % 100) parts.push(under100(n % 100, l));
  return parts.join(' ');
};

export function amountInWords(amount: number, locale: 'en' | 'bn'): string {
  if (!Number.isFinite(amount) || Math.abs(amount) >= 1e15) {
    throw new RangeError(`amountInWords: amount out of range: ${amount}`);
  }
  const cents = Math.round(Math.abs(amount) * 100);
  const taka = Math.floor(cents / 100);
  const paisa = cents % 100;
  const takaWords = taka === 0 ? under100(0, locale) : words(taka, locale);
  if (locale === 'bn') {
    return paisa
      ? `${takaWords} টাকা ${under100(paisa, 'bn')} পয়সা মাত্র`
      : `${takaWords} টাকা মাত্র`;
  }
  return paisa
    ? `Taka ${takaWords} and ${under100(paisa, 'en')} Paisa only`
    : `Taka ${takaWords} only`;
}
