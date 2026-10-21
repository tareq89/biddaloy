import type { L } from './hero';

/** FAQ (D43). `{privacy}` in an answer is replaced with the privacy page URL at render. */
export const faq: { q: L; a: L }[] = [
  { q: { bn: 'ইন্টারনেট না থাকলে?', en: 'What if there is no internet?' },
    a: { bn: 'যে পাতাগুলো একবার খুলেছেন, ইন্টারনেট ছাড়াও খোলে। হাজিরা নিলে ফোনে জমা থাকে, ইন্টারনেট এলে নিজে থেকে পাঠিয়ে দেয়।', en: 'Pages you have opened once open without internet. Attendance is kept on the phone and sent by itself when the connection returns.' } },
  { q: { bn: 'আমাদের কম্পিউটার নেই, ফোনে চলবে?', en: 'We have no computer. Does it run on a phone?' },
    a: { bn: 'চলবে। শিক্ষক আর অভিভাবকের সব কাজ ফোনের জন্যই বানানো। অফিসের কাজের জন্য একটা কম্পিউটার থাকলে সুবিধা, না থাকলেও আটকায় না।', en: 'Yes. Everything a teacher or guardian does is built for the phone. A computer helps for office work but nothing stops without one.' } },
  { q: { bn: 'শিক্ষকরা পারবেন তো?', en: 'Will the teachers manage?' },
    a: { bn: 'হাজিরা নেওয়া মানে নামের পাশে একটা বোতাম চাপা। নম্বর তোলা মানে Excel-এর মতো ঘরে সংখ্যা লেখা। প্রথম সপ্তাহে আমরা WhatsApp-এ সাথে থাকি।', en: 'Taking attendance means pressing one button beside a name. Entering marks means typing numbers into cells, like Excel. The first week we are with you on WhatsApp.' } },
  { q: { bn: 'ডেটা চুরি হবে না তো?', en: 'Could the data be stolen?' },
    a: { bn: 'প্রতিটা স্কুলের তথ্য আলাদা করে রাখা, সার্ভার বাংলাদেশে, প্রতি ঘণ্টায় সুরক্ষিত কপি। কী কী ব্যবস্থা আছে, <a href="{privacy}">এখানে</a> সব লেখা।', en: 'Each school’s data is kept separately, the server is in Bangladesh, a protected copy every hour. Every measure is written <a href="{privacy}">here</a>.' } },
  { q: { bn: 'আপনারা বন্ধ হয়ে গেলে আমাদের কী হবে?', en: 'What happens to us if you shut down?' },
    a: { bn: 'আপনার স্কুলের পুরো তথ্য যেকোনো দিন Excel ফাইলে নামিয়ে নিতে পারেন, আজই পারেন। কোনো চুক্তিতে আটকে থাকতে হয় না।', en: 'You can download your school’s entire data as an Excel file any day, today even. No contract locks you in.' } },
  { q: { bn: '২০২৭-এ দাম বাড়িয়ে দেবেন না তো?', en: 'Will you raise the price in 2027?' },
    a: { bn: 'দাম লেখা আছে: ছাত্র প্রতি মাসে ১০ টাকা। কোনো প্যাকেজ নেই, লুকানো খরচ নেই। যতজন ছাত্র, ততটুকু।', en: 'The price is written down: ৳10 per student per month. No packages, no hidden cost. As many students, that much.' } },
  { q: { bn: 'মাদ্রাসায় চলবে?', en: 'Does it work for a madrasa?' },
    a: { bn: 'আলিয়া আর কওমি, দুটোরই ছক তৈরি আছে। জামাত, কিতাব, বিষয়, সব বসানো। অ্যাকাউন্ট খোলার সময় বেছে নিলেই হয়।', en: 'Both Alia and Qawmi templates are ready: jamaat, kitab, subjects all set. Just pick one when opening the account.' } },
  { q: { bn: 'কে শেখাবে?', en: 'Who will teach us?' },
    a: { bn: 'প্রথম মাস WhatsApp আর ফোনে আমরা, বিনামূল্যে। ডকুমেন্টেশনে প্রতিটা কাজের ছবিসহ ধাপ লেখা আছে, বাংলায়।', en: 'The first month, us, on WhatsApp and phone, free. The documentation has every task written step by step with pictures, in Bangla.' } },
];

export const faqTitle: L = { bn: 'যে প্রশ্নগুলো সবাই করেন', en: 'The questions everyone asks' };

/** Final CTA (D44). */
export const finalCta = {
  title: { bn: 'আগে নিজের চোখে দেখুন, তারপর সিদ্ধান্ত', en: 'See it with your own eyes first, then decide' },
  lead: { bn: 'ডেমো স্কুলে লগ ইন লাগে না। ১,২০০ ছাত্রের স্কুল, ১০ বছরের তথ্য, যা খুশি ঘেঁটে দেখুন।', en: 'No login needed for the demo school. A 1,200-student school, 10 years of data, poke around as you like.' },
  demo: { bn: '▶ ডেমো স্কুলে ঢুকুন', en: '▶ Enter the demo school' },
  register: { bn: 'ফ্রি অ্যাকাউন্ট খুলুন', en: 'Open a free account' },
  pdfB: { bn: 'কমিটির মিটিংয়ে দেখাতে চান?', en: 'Need to show the committee?' },
  pdf: { bn: 'এক পাতার PDF: কী পাবেন, কত খরচ, কীভাবে শুরু। বড় হরফে, বাংলায়।', en: 'A one-page PDF: what you get, what it costs, how to start. Large print, in Bangla.' },
};
