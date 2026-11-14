import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { alertRuleMeta, isAlertRuleKey, ModuleKey, type AlertCadence } from '@biddaloy/shared';
import {
  ATTENTION_RULE_METADATA,
  ATTENTION_RULE_MODULE_METADATA,
} from './attention-rule.decorator';
import type { AttentionRule, AttentionRuleModule } from './rule.types';

@Injectable()
export class RuleRegistryService implements OnModuleInit {
  private rules = new Map<string, AttentionRule>();
  private modules = new Map<string, AttentionRuleModule>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    for (const w of this.discovery.getProviders()) {
      const type = w.metatype;
      if (!type || typeof type !== 'function') continue;
      if (!Reflect.getMetadata(ATTENTION_RULE_METADATA, type)) continue;
      const rule = w.instance as AttentionRule;
      const name = type.name;
      const key = rule.meta?.key;
      if (!key || !isAlertRuleKey(key)) {
        throw new Error(`Attention rule ${name}: unknown key "${String(key)}"`);
      }
      if (rule.meta !== alertRuleMeta(key)) {
        throw new Error(`Attention rule ${name} (${key}): meta must come from alertRuleMeta()`);
      }
      if (this.rules.has(key)) throw new Error(`Attention rule key "${key}" registered twice`);
      if (!rule.messages?.bn?.title || !rule.messages?.en?.title) {
        throw new Error(`Attention rule ${name} (${key}): empty bn/en title`);
      }
      const module = Reflect.getMetadata(ATTENTION_RULE_MODULE_METADATA, type) as unknown;
      if (module !== 'core' && !(Object.values(ModuleKey) as unknown[]).includes(module)) {
        throw new Error(`Attention rule ${name} (${key}): missing or unknown module`);
      }
      this.modules.set(key, module as AttentionRuleModule);
      this.rules.set(key, rule);
    }
  }

  /** The module a rule belongs to; undefined for a key with no registered rule (manual, notice). */
  moduleOf(key: string): AttentionRuleModule | undefined {
    return this.modules.get(key);
  }

  all(): AttentionRule[] {
    return [...this.rules.values()];
  }

  get(key: string): AttentionRule | undefined {
    return this.rules.get(key);
  }

  forCadence(c: AlertCadence): AttentionRule[] {
    return this.all().filter((r) => r.meta.cadence.includes(c));
  }
}
