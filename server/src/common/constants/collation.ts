/**
 * ICU collation used to sort Bengali text in Bengali dictionary order
 * (rather than libc/C byte order, which sorts by raw codepoint and puts
 * Bengali script in an order no Bengali reader recognizes).
 *
 * Created by migration
 * `server/src/migrations/1788307200000-AddBengaliCollationAndSearchIndexes.ts`
 * via `CREATE COLLATION "bn_icu" (provider = icu, locale = 'bn-u-co-standard')`.
 *
 * Every `ORDER BY ... COLLATE` clause must interpolate this constant rather
 * than the string literal, so there is exactly one place to change if the
 * collation is ever renamed.
 */
export const BN_COLLATION = 'bn_icu';
