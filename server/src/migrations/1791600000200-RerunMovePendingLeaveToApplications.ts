import { MigrationInterface, QueryRunner } from 'typeorm';
import { MovePendingLeaveToApplications1791600000100 } from './1791600000100-MovePendingLeaveToApplications';

/**
 * [52.5.2] D15 — re-run the PENDING-leave move. Between deploying the first
 * move (1791600000100) and removing `POST /leave/requests` (this ticket), the
 * old route could still file PENDING `leave_records` rows. Same idempotent SQL,
 * same loud guard (reused, not copied); a no-op when nothing is pending.
 * `down()` is a no-op: undoing a re-run must not undo the original move.
 */
export class RerunMovePendingLeaveToApplications1791600000200 implements MigrationInterface {
  name = 'RerunMovePendingLeaveToApplications1791600000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await new MovePendingLeaveToApplications1791600000100().up(queryRunner);
  }

  public async down(): Promise<void> {
    // intentionally empty
  }
}
