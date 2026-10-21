import type { L } from './hero';

/** Logo strip. Empty until real schools give permission; the strip hides below 3 entries. */
export interface School { name: L; logo: string }
export const schools: School[] = [];

export const schoolsCopy = {
  eyebrow: { bn: 'যারা SchoolManager-এ চলছে', en: 'Running on SchoolManager' },
  note: { bn: 'আসল স্কুলের অনুমতি নিয়ে লোগো বসবে; ৩টার কম হলে সেকশন লুকানো থাকবে।', en: 'Logos appear with each school’s permission; the section stays hidden below three.' },
};
