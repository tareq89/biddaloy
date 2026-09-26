import { PartialType } from '@nestjs/swagger';
import { CreateIntakeDto } from './create-intake.dto';

/** [27.3] Partial update of an intake — same shape as create, all optional.
 * `status` is never a field here: it derives from `open_date`/`close_date`
 * on read (see `AdmissionIntake` entity docstring). */
export class UpdateIntakeDto extends PartialType(CreateIntakeDto) {}
