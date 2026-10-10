import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { alertRuleMeta, isAlertRuleKey, type AlertCadence } from '@biddaloy/shared';
import { ATTENTION_RULE_METADATA } from './attention-rule.decorator';
import type { AttentionRule } from './rule.types';

@Injectable()
export class RuleRegistryService implements OnModuleInit {
  private rules = new Map<string, AttentionRule>();

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
      this.rules.set(key, rule);
    }
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
