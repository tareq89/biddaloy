/** Screenshot manifest (D5, D6): one entry per cropped PNG. File = assets/shots/<role>/<page>.<lang>.<theme>.png */
export type Viewport = 'desktop' | 'phone';

export interface ShotSpec {
  /** Demo card key from server/src/modules/demo/demo-accounts.ts (`/login?role=<key>`, 50.8). */
  role: string;
  /** File stem. The `name` prop of <Shot> is `${role}/${page}`. */
  page: string;
  /** App path opened after sign-in. */
  url: string;
  /** Element to crop. */
  selector: string;
  viewport: Viewport;
}

export const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};
export const LANGS = ['bn', 'en'] as const;
export const THEMES = ['light', 'dark'] as const;

const main = 'main';
// ponytail: urls are a first cut; fix any that 404 when the script first runs against a real demo.
export const shots: ShotSpec[] = [
  { role: 'admin', page: 'dashboard', url: '/dashboard', selector: main, viewport: 'desktop' },
  { role: 'admin', page: 'routine', url: '/routine', selector: main, viewport: 'desktop' },
  { role: 'admin', page: 'marks', url: '/exams', selector: main, viewport: 'desktop' },
  { role: 'admin', page: 'fees-dues', url: '/fees/dues', selector: main, viewport: 'desktop' },
  { role: 'admin', page: 'print-templates', url: '/print/templates', selector: main, viewport: 'desktop' },
  { role: 'principal', page: 'dashboard', url: '/dashboard', selector: main, viewport: 'desktop' },
  { role: 'class-teacher-8a', page: 'my-class', url: '/my-class', selector: main, viewport: 'phone' },
  { role: 'class-teacher-8a', page: 'attendance', url: '/attendance', selector: main, viewport: 'phone' },
  { role: 'accountant', page: 'dues', url: '/fees/dues', selector: main, viewport: 'desktop' },
  { role: 'accountant', page: 'collections', url: '/fees/collections', selector: main, viewport: 'desktop' },
  { role: 'guardian', page: 'home', url: '/portal', selector: main, viewport: 'phone' },
  { role: 'guardian', page: 'fees', url: '/portal/fees', selector: main, viewport: 'phone' },
  { role: 'guardian', page: 'results', url: '/portal/results', selector: main, viewport: 'phone' },
  { role: 'student-9b', page: 'routine', url: '/portal/routine', selector: main, viewport: 'phone' },
];

export const shotName = (s: Pick<ShotSpec, 'role' | 'page'>) => `${s.role}/${s.page}`;
export const shotFile = (s: ShotSpec, lang: string, theme: string) =>
  `${s.role}/${s.page}.${lang}.${theme}.png`;
