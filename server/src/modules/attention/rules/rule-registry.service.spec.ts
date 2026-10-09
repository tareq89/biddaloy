import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { DiscoveryModule } from '@nestjs/core';
import { AlertCadence, alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from './attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape } from './rule.types';
import { RuleRegistryService } from './rule-registry.service';

const msg = { title: 't', why: 'w', steps: [] };

@AttentionRule()
class FakeA implements AttentionRuleShape {
  meta = alertRuleMeta('class.starting');
  messages = { bn: msg, en: msg };
  evaluate = async () => [];
}

@AttentionRule()
class FakeB implements AttentionRuleShape {
  meta = alertRuleMeta('homework.due_today');
  messages = { bn: msg, en: msg };
  evaluate = async () => [];
}

@AttentionRule()
class DupOfA implements AttentionRuleShape {
  meta = alertRuleMeta('class.starting');
  messages = { bn: msg, en: msg };
  evaluate = async () => [];
}

@AttentionRule()
class CopiedMeta implements AttentionRuleShape {
  // A copy, not the catalogue object: must be rejected.
  meta = { ...alertRuleMeta('class.starting') };
  messages = { bn: msg, en: msg };
  evaluate = async () => [];
}

@AttentionRule()
class EmptyTitle implements AttentionRuleShape {
  meta = alertRuleMeta('class.starting');
  messages = { bn: { ...msg, title: '' }, en: msg };
  evaluate = async () => [];
}

async function boot(providers: unknown[]) {
  const mod = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [RuleRegistryService, ...(providers as never[])],
  }).compile();
  return mod;
}

describe('RuleRegistryService', () => {
  it('collects decorated rules and filters by cadence', async () => {
    const mod = await boot([FakeA, FakeB]);
    await mod.init();
    const reg = mod.get(RuleRegistryService);
    expect(reg.all()).toHaveLength(2);
    expect(reg.get('class.starting')).toBeInstanceOf(FakeA);
    expect(reg.forCadence(AlertCadence.FAST)).toHaveLength(1);
    expect(reg.forCadence(AlertCadence.FAST)[0]).toBeInstanceOf(FakeA);
    expect(reg.forCadence(AlertCadence.DAILY)[0]).toBeInstanceOf(FakeB);
  });

  it('boots empty when no rules are registered', async () => {
    const mod = await boot([]);
    await mod.init();
    expect(mod.get(RuleRegistryService).all()).toEqual([]);
  });

  it('rejects a duplicate key', async () => {
    const mod = await boot([FakeA, DupOfA]);
    await expect(mod.init()).rejects.toThrow(/class\.starting/);
  });

  it('rejects meta that is not the catalogue object', async () => {
    const mod = await boot([CopiedMeta]);
    await expect(mod.init()).rejects.toThrow(/alertRuleMeta/);
  });

  it('rejects an empty title', async () => {
    const mod = await boot([EmptyTitle]);
    await expect(mod.init()).rejects.toThrow(/empty/);
  });
});
