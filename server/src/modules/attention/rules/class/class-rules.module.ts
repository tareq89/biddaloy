import { Module } from '@nestjs/common';
import { ClassAbsentStreakRule } from './class-absent-streak.rule';
import { ClassGuardianContactMissingRule } from './class-guardian-contact-missing.rule';

/** Rules of category CLASS (DataSource only). */
@Module({ providers: [ClassAbsentStreakRule, ClassGuardianContactMissingRule] })
export class ClassRulesModule {}
