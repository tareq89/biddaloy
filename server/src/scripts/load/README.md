# Dashboard load test scripts

Manual only, throwaway database only, never in CI.

- `seed-load-10k.ts` fills a throwaway database with a 10,000-student school (`yarn workspace @biddaloy/server load:seed`).
- `run-dashboard-load.ts` hits every dashboard widget with 50 users and prints p95 per widget against 300 ms.

The run guide (diagram, exact commands, how to read the table) is
[`docs/architecture/26-dashboard-load-test.md`](../../../../docs/architecture/26-dashboard-load-test.md).
