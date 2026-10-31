import { Module } from '@nestjs/common';
import { ReportRegistry } from './registry/registry';
import { RoleScopePolicy } from './security/role-scope.policy';

/** [8.15.14] The report engine's shared pieces: the semantic layer and the role scope policy. */
@Module({
  providers: [ReportRegistry, RoleScopePolicy],
  exports: [ReportRegistry, RoleScopePolicy],
})
export class ReportEngineModule {}
