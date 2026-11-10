import { Module } from '@nestjs/common';
import { PromotionGroupsPendingRule } from './promotion-groups-pending.rule';

/** Rules category STRUCTURE for year-rollover promotions (DataSource only). */
@Module({ providers: [PromotionGroupsPendingRule] })
export class PromotionRulesModule {}
