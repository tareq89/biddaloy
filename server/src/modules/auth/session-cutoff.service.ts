import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';

/**
 * Refuses every access token the user already holds, from the next request on
 * (JwtStrategy compares the token's `iat` with `users.tokens_valid_after`).
 * DB only, no Redis. [75.2, D12]
 */
@Injectable()
export class SessionCutoffService {
  constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}

  /**
   * `at` is the APP clock, the same source as the token's `iat_ms` (never
   * Postgres `now()`: a DB clock that differs from the app's, or a long
   * transaction, would refuse or keep the wrong tokens). Call it after the
   * change that ends the sessions has committed.
   */
  async cutOff(userId: string, manager?: EntityManager, at: Date = new Date()): Promise<void> {
    await (manager ?? this.userRepo.manager).query(
      `UPDATE "users" SET "tokens_valid_after" = $2 WHERE "id" = $1`,
      [userId, at],
    );
  }
}
