# Contributing

## Database migrations

Production runs migrations from the compiled image, no ts-node:

```bash
node server/dist/scripts/migrate.js pending   # exit 0 none, 2 pending (back up first), 1 error
node server/dist/scripts/migrate.js run       # apply all pending, one transaction each
node server/dist/scripts/migrate.js revert    # undo the last one
```

### Backward-compatibility rule (one release)

During a deploy the old code runs against the new schema, so a migration must
work for the release before it. Never rename or drop a column or table in the
release that stops using it. Split it over releases:

```text
release N    add the new column (nullable or defaulted);
             code writes BOTH columns, still reads the old;
             backfill copies old -> new for existing rows  -> deploy
release N+1  code reads/writes the new column only        -> deploy
release N+2  drop the old column                           -> deploy
```

Example: rename `students.phone` to `students.mobile`. In N, every save sets
both `phone` and `mobile`, and a migration runs
`UPDATE students SET mobile = phone WHERE mobile IS NULL`. Now every row has
`mobile`, so N+1 can read it safely. N+2 drops `phone`.
