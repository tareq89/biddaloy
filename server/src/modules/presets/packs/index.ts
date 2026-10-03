import type { PresetPack } from '@biddaloy/shared';
import { NCTB_PACK } from './bd/nctb';
import { ALIA_PACK } from './bd/alia-madrasa';
import { QAWMI_PACK } from './bd/qawmi-madrasa';
import { CAMBRIDGE_PACK } from './intl/cambridge';
import { BLANK_PACK } from './blank';

/** Registered curriculum packs. Test packs never go here. */
export const PRESET_PACKS: PresetPack[] = [
  NCTB_PACK,
  ALIA_PACK,
  QAWMI_PACK,
  CAMBRIDGE_PACK,
  BLANK_PACK,
];
