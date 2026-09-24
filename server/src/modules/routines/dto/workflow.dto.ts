import { IsUUID, IsString, IsOptional, MaxLength, IsIn } from 'class-validator';
import { ChangeRequestState } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** `POST /routines/slots/:slotId/change-requests` payload — a teacher
 * flagging a published slot for the builder's attention (D11). */
export class CreateChangeRequestDto {
  @IsString()
  @MaxLength(500)
  @SanitizeText()
  note: string;
}

/** `PATCH /routines/change-requests/:id` payload. Only `ACCEPTED` /
 * `REJECTED` are legal resolutions — `OPEN` is the request's only starting
 * state and is never written back to. */
export class ResolveChangeRequestDto {
  @IsIn([ChangeRequestState.ACCEPTED, ChangeRequestState.REJECTED])
  state: typeof ChangeRequestState.ACCEPTED | typeof ChangeRequestState.REJECTED;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @SanitizeText()
  resolution_note?: string;
}

/** `POST /routines/:id/copy-year` payload — source routine is the `:id`
 * path param, this names the target academic year the copy lands in. */
export class CopyRoutineDto {
  @IsUUID()
  target_academic_year_id: string;
}
