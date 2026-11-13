import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';
import type { AttentionRuleModule } from './rule.types';

export const ATTENTION_RULE_METADATA = 'attention:rule';
export const ATTENTION_RULE_MODULE_METADATA = 'attention:rule:module';

/**
 * Marks an injectable class as an attention rule, picked up by RuleRegistryService.
 * `module` is required (D9): the switchable module the rule is about, or 'core' when it is in none.
 * The interface has the same name, so rule files import both with an alias:
 *
 *   import { AttentionRule } from '../attention-rule.decorator';
 *   import type { AttentionRule as AttentionRuleShape } from '../rule.types';
 *
 *   @AttentionRule({ module: 'core' })
 *   export class XRule implements AttentionRuleShape { meta = alertRuleMeta('x.y'); ... }
 */
export function AttentionRule(opts: { module: AttentionRuleModule }): ClassDecorator {
  return applyDecorators(
    Injectable(),
    SetMetadata(ATTENTION_RULE_METADATA, true),
    SetMetadata(ATTENTION_RULE_MODULE_METADATA, opts.module),
  );
}
