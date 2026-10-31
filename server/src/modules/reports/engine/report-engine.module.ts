import { Module } from '@nestjs/common';
import { ReportCompiler } from './compiler/report-compiler';
import { ReportRegistry } from './registry/registry';
import { RoleScopePolicy } from './security/role-scope.policy';

/** [8.15.14] The report engine's shared pieces: the semantic layer, the role scope policy and the compiler. */
@Module({
  providers: [ReportRegistry, RoleScopePolicy, ReportCompiler],
  exports: [ReportRegistry, RoleScopePolicy, ReportCompiler],
})
export class ReportEngineModule {}
