import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';

export const ATTENTION_RULE_METADATA = 'attention:rule';

/**
 * Marks an injectable class as an attention rule, picked up by RuleRegistryService.
 * The interface has the same name, so rule files import both with an alias:
 *
 *   import { AttentionRule } from '../attention-rule.decorator';
 *   import type { AttentionRule as AttentionRuleShape } from '../rule.types';
 *
 *   @AttentionRule()
 *   export class XRule implements AttentionRuleShape { meta = alertRuleMeta('x.y'); ... }
 */
export function AttentionRule(): ClassDecorator {
  return applyDecorators(Injectable(), SetMetadata(ATTENTION_RULE_METADATA, true));
}
