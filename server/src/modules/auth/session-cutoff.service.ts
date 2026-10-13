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

  async cutOff(userId: string, manager?: EntityManager): Promise<void> {
    await (manager ?? this.userRepo.manager).query(
      `UPDATE "users" SET "tokens_valid_after" = now() WHERE "id" = $1`,
      [userId],
    );
  }
}
