import { ApiProperty } from '@nestjs/swagger';

/** Swagger-only shape for `POST /schools/:id/settings/test`'s 200 response
 * — mirrors `ConnectionTestResult` (`providers/shared/connection-test.types.ts`).
 * The generated schema previously declared this as `Record<string, never>`;
 * nothing constructs an instance of this class, `ProviderConnectionTestController`
 * still returns the plain `ConnectionTestResult` object `ConnectionTestService`
 * produces. */
export class ConnectionTestResultDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;
}
