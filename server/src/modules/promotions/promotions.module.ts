import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotionRun } from './entities/promotion-run.entity';
import { PromotionEntry } from './entities/promotion-entry.entity';

/**
 * [788] Registers the promotion-workflow entities. Services/controllers
 * land in a later wave (@w3) — this module exists now so migration and
 * schema review can happen ahead of that.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PromotionRun, PromotionEntry])],
})
export class PromotionsModule {}
