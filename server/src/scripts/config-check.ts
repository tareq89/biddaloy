import 'reflect-metadata';
import { resolve } from 'path';
import { config } from 'dotenv';
import { validate } from '../config/env.validation';
import { assertSecretEchoAllowed } from '../modules/account-access/account-access-echo';

/**
 * `yarn config:check` — runs the boot-time config checks (env.validation.ts +
 * the ACCOUNT_ACCESS_ECHO_SECRETS guard from main.ts) without starting Nest.
 * Error text names variables only, never their values.
 */
export function runConfigCheck(env: Record<string, unknown>): { ok: boolean; output: string } {
  try {
    validate(env);
    assertSecretEchoAllowed(
      env.NODE_ENV as string | undefined,
      env.ACCOUNT_ACCESS_ECHO_SECRETS as string | undefined,
    );
    return { ok: true, output: 'config ok' };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

/** The deploy container always runs as production, so the CLI judges it that way
 * whatever NODE_ENV the host `.env` says (a dev `.env` must not print a false "config ok"). */
export function runProductionConfigCheck(env: Record<string, unknown>) {
  return runConfigCheck({ ...env, NODE_ENV: 'production' });
}

if (require.main === module) {
  config({ path: resolve(__dirname, '..', '..', '..', '.env') });
  const { ok, output } = runProductionConfigCheck(process.env);
  (ok ? console.log : console.error)(output);
  process.exit(ok ? 0 : 1);
}
