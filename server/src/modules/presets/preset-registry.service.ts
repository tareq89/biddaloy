import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { validatePresetPack, type PresetPack, type PresetSummary } from '@biddaloy/shared';
import { PRESET_PACKS } from './packs';

@Injectable()
export class PresetRegistryService implements OnModuleInit {
  // ponytail: reads the module const so specs can swap packs via `packs`.
  packs: PresetPack[] = PRESET_PACKS;

  onModuleInit(): void {
    this.validateAll();
  }

  /** Throws on any invalid pack so a bad pack fails the boot, not a user's apply. */
  validateAll(): void {
    const errors = this.packs.flatMap((p) => validatePresetPack(p).map((e) => `${p.id}: ${e}`));
    if (errors.length) throw new Error(`Invalid preset pack(s):\n${errors.join('\n')}`);
  }

  list(): PresetSummary[] {
    return this.packs.map((p) => ({
      id: p.id,
      version: p.version,
      name: p.name,
      board: p.board,
      description: p.description,
      verified: p.verified,
      country: p.country,
      stages: p.stages,
      ...(p.versions ? { versions: p.versions } : {}),
    }));
  }

  get(id: string): PresetPack {
    const pack = this.packs.find((p) => p.id === id);
    if (!pack) throw new NotFoundException(`Preset ${id} not found`);
    return pack;
  }
}
