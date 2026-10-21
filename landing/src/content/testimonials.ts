/** D13: the page stays unlinked + noindex until three real testimonials exist. Flip this to true then. */
export const SHOW_TESTIMONIALS = false;

export interface Testimonial {
  /** ≤ 40 words. */
  quote: { bn: string; en: string };
  name: { bn: string; en: string };
  role: { bn: string; en: string };
  school: { bn: string; en: string };
  district: { bn: string; en: string };
}

export const testimonials: Testimonial[] = [];

/** True when the testimonials route must carry `<meta name="robots" content="noindex">`. */
export const testimonialsNoindex = (show = SHOW_TESTIMONIALS, count = testimonials.length) =>
  !show || count < 3;

/** One rule for every caller (home grid, testimonials page): show only when the route is indexable. */
export const showTestimonials = !testimonialsNoindex();
