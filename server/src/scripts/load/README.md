# Dashboard load test scripts

Manual only, throwaway database only, never in CI.

- `seed-load-10k.ts` fills a throwaway database with a 10,000-student school (`yarn workspace @biddaloy/server load:seed`).
- `run-dashboard-load.ts` exercises the endpoints of each role's default layout with 50 users by default and prints p95 by phase, role and endpoint against 300 ms. A route that answers 404 fails the run.

The run guide (diagram, exact commands, how to read the table) is
[`docs/architecture/26-dashboard-load-test.md`](../../../../docs/architecture/26-dashboard-load-test.md).
