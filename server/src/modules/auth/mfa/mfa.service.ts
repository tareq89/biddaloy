import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EncryptionService } from '../../schools/settings/encryption.service';
import { generateSecret, matchStep, otpauthUri, issuerName } from './totp.util';
import { generateCodes, hashCode } from './recovery-codes.util';

/**
 * Generic MFA engine (Epic 98). No route here: callers rate-limit and audit.
 * Never log a secret, code or URI. Errors are fixed sentences (Security Rules 13, 23).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly encryption: EncryptionService,
  ) {}

  /** Starts (or restarts) enrolment. Returns the secret and URI once, for the QR code. */
  async beginEnrolment(userId: string, label: string): Promise<{ secret: string; uri: string }> {
    const secret = generateSecret();
    const res = await this.dataSource.query(
      `INSERT INTO user_mfa (user_id, secret_enc) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_step = NULL
       WHERE user_mfa.confirmed_at IS NULL
       RETURNING user_id`,
      [userId, this.encryption.encrypt(secret)],
    );
    if (affected(res) === 0) throw new ConflictException('Authenticator is already set up.');
    return { secret, uri: otpauthUri(secret, label, issuerName()) };
  }

  /** Confirms enrolment with a first valid code and returns the fresh recovery codes (shown once). */
  async confirmEnrolment(userId: string, code: string, nowMs = Date.now()): Promise<string[]> {
    const row = await this.load(userId);
    const step =
      row && !row.confirmed_at
        ? matchStep(this.encryption.decrypt(row.secret_enc), code, nowMs)
        : null;
    if (step === null) throw new BadRequestException('Code is not valid.');
    return this.dataSource.transaction(async (em) => {
      const res = await em.query(
        `UPDATE user_mfa SET confirmed_at = now(), last_step = $2
         WHERE user_id = $1 AND confirmed_at IS NULL RETURNING user_id`,
        [userId, step],
      );
      if (affected(res) === 0) throw new BadRequestException('Code is not valid.');
      return this.replaceCodes(em, userId);
    });
  }

  /** True once per code: a step at or before `last_step` is a replay. */
  async verifyCode(userId: string, code: string, nowMs = Date.now()): Promise<boolean> {
    const row = await this.load(userId);
    if (!row?.confirmed_at) return false;
    const step = matchStep(this.encryption.decrypt(row.secret_enc), code, nowMs);
    if (step === null) return false;
    const res = await this.dataSource.query(
      `UPDATE user_mfa SET last_step = $2
       WHERE user_id = $1 AND confirmed_at IS NOT NULL AND (last_step IS NULL OR last_step < $2)
       RETURNING user_id`,
      [userId, step],
    );
    return affected(res) === 1;
  }

  /** Burns one recovery code; two parallel calls on the same code: exactly one wins. */
  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const res = await this.dataSource.query(
      `UPDATE user_recovery_codes SET used_at = now()
       WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
      [userId, hashCode(code)],
    );
    return affected(res) === 1;
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const row = await this.load(userId);
    if (!row?.confirmed_at) throw new BadRequestException('Authenticator is not set up.');
    return this.dataSource.transaction((em) => this.replaceCodes(em, userId));
  }

  async status(userId: string): Promise<{ enrolled: boolean; recoveryRemaining: number }> {
    const row = await this.load(userId);
    if (!row?.confirmed_at) return { enrolled: false, recoveryRemaining: 0 };
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    return { enrolled: true, recoveryRemaining: n };
  }

  /** Removes the MFA row and every recovery code (Wave 4 reset script). */
  async reset(userId: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
      await em.query(`DELETE FROM user_mfa WHERE user_id = $1`, [userId]);
    });
  }

  /** Dev seed and staging smoke only (D16, D17): confirmed enrolment with a given secret, no codes. */
  async enrolWithKnownSecret(userId: string, secret: string): Promise<void> {
    if (process.env.NODE_ENV === 'production' && process.env.ENV_NAME !== 'staging') {
      throw new BadRequestException('Not available in this environment.');
    }
    await this.dataSource.query(
      `INSERT INTO user_mfa (user_id, secret_enc, confirmed_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
         SET secret_enc = EXCLUDED.secret_enc, confirmed_at = now(), last_step = NULL`,
      [userId, this.encryption.encrypt(secret)],
    );
  }

  private async replaceCodes(em: EntityManager, userId: string): Promise<string[]> {
    const codes = generateCodes(10);
    await em.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
    for (const c of codes) {
      await em.query(`INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, [
        userId,
        hashCode(c),
      ]);
    }
    return codes;
  }

  private async load(
    userId: string,
  ): Promise<{ secret_enc: string; confirmed_at: Date | null } | undefined> {
    const rows = await this.dataSource.query(
      `SELECT secret_enc, confirmed_at FROM user_mfa WHERE user_id = $1`,
      [userId],
    );
    return rows[0];
  }
}

// TypeORM's pg driver returns `[rows, affected]` for UPDATE/DELETE ... RETURNING, plain rows for INSERT/SELECT.
function affected(res: unknown): number {
  if (!Array.isArray(res)) return 0;
  return Array.isArray(res[0]) ? res[0].length : res.length;
}
