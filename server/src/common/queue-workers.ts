/**
 * Whether `AppModule` starts its BullMQ workers when it boots. Only
 * `createScriptAppContext` (scripts/script-app-context.ts) turns this off,
 * and it must do so before `app.module.ts` is loaded — that is when
 * `BullModule.forRootAsync` reads it.
 *
 * Deliberately a code-level switch, not an env var: `app.module.ts` copies
 * `.env` into `process.env` while it loads, so an env var could be set from
 * `.env` and silently stop the real server's workers (SMS, backups, token
 * cleanup) with no error at all.
 */
export const queueWorkers = { enabled: true };
