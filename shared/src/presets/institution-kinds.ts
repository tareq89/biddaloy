import type { LabelEntry, ModuleKey, SchoolLabels } from '../enums/module-key';
import type { BilingualText } from './pack.types';

export interface InstitutionKind {
  id: string;
  name: BilingualText;
  /** false = defaults not yet checked with a real school of this kind. */
  verified: boolean;
  /** Curriculum pack ids (server/src/modules/presets/packs) that map here. */
  matchesPresetIds: string[];
  modules: Partial<Record<ModuleKey, boolean>>;
  labels: SchoolLabels;
}

const label = (one: string, other: string, bn: string): LabelEntry => ({
  en: { one, other },
  bn,
});

export const INSTITUTION_KINDS: InstitutionKind[] = [
  {
    id: 'primary',
    name: { en: 'Primary school', bn: 'প্রাথমিক বিদ্যালয়' },
    verified: true,
    matchesPresetIds: [],
    modules: { seatPlans: false, evaluations: false },
    labels: {},
  },
  {
    id: 'secondary',
    name: { en: 'Secondary school', bn: 'মাধ্যমিক বিদ্যালয়' },
    verified: true,
    matchesPresetIds: ['bd/nctb'],
    modules: {},
    labels: {},
  },
  {
    id: 'college',
    name: { en: 'College', bn: 'কলেজ' },
    verified: false,
    matchesPresetIds: [],
    modules: {},
    labels: {},
  },
  {
    id: 'alia-madrasa',
    name: { en: 'Alia madrasa', bn: 'আলিয়া মাদ্রাসা' },
    verified: true,
    matchesPresetIds: ['bd/alia-madrasa'],
    modules: {},
    labels: {},
  },
  {
    id: 'qawmi-madrasa',
    name: { en: 'Qawmi madrasa', bn: 'কওমি মাদ্রাসা' },
    verified: false,
    matchesPresetIds: ['bd/qawmi-madrasa'],
    modules: {},
    labels: {},
  },
  {
    id: 'english-medium',
    name: { en: 'English medium', bn: 'ইংলিশ মিডিয়াম' },
    verified: true,
    matchesPresetIds: ['intl/cambridge'],
    modules: {},
    labels: {},
  },
  {
    id: 'coaching',
    name: { en: 'Coaching centre', bn: 'কোচিং সেন্টার' },
    verified: true,
    matchesPresetIds: [],
    modules: { fines: false, programs: false, evaluations: false, seatPlans: false },
    labels: {
      class: label('Course', 'Courses', 'কোর্স'),
      section: label('Batch', 'Batches', 'ব্যাচ'),
    },
  },
  {
    id: 'technical',
    name: { en: 'Technical institute', bn: 'কারিগরি প্রতিষ্ঠান' },
    verified: false,
    matchesPresetIds: [],
    modules: {},
    labels: {},
  },
];
