import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateIntakeDto } from './create-intake.dto';

/** [27.3] Partial update of an intake — same shape as create, all optional, except the
 * template: it only seeds stages on create, so changing it later is not allowed.
 * `status` is never a field here: it derives from `open_date`/`close_date`
 * on read (see `AdmissionIntake` entity docstring). */
export class UpdateIntakeDto extends PartialType(
  OmitType(CreateIntakeDto, ['template_key'] as const),
) {}
