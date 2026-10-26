## CI timing trend

Over the trailing 43 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 100% (43/43)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 43 | 1380.0s | 3833.0s | 0% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Frontend tests (1/3) | 23 | 568.0s | 858.0s |
| Frontend tests (2/3) | 23 | 666.0s | 851.0s |
| Frontend tests (3/3) | 23 | 663.0s | 850.0s |
| E2E smoke (chromium 3/3) | 23 | 607.0s | 722.0s |
| E2E smoke (chromium 2/3) | 23 | 599.0s | 708.0s |
| E2E smoke (chromium 1/3) | 23 | 568.0s | 670.0s |
| Build, lint, unit tests | 43 | 327.0s | 415.0s |
| User guide checks | 41 | 129.0s | 145.0s |
| Bundle size delta | 43 | 24.0s | 128.0s |
| Dependency vulnerability scan | 43 | 94.0s | 113.0s |
| Storybook build | 43 | 0.0s | 111.0s |
| Frontend coverage merge | 43 | 34.0s | 107.0s |
| Test timings & budgets | 43 | 13.0s | 19.0s |
| Detect changed areas | 43 | 9.0s | 11.0s |
| Landing build | 43 | 0.0s | 0.0s |
| Route sweeps (chromium-sweeps) | 43 | 0.0s | 0.0s |
| Nightly quality (merge queue) | 43 | 0.0s | 0.0s |
| Infra config tests | 43 | 0.0s | 0.0s |
| Integration & e2e tests | 43 | 0.0s | 0.0s |
| Frontend tests (${{ matrix.shard }}/3) | 20 | 0.0s | 0.0s |
| E2E smoke (${{ matrix.browser }} ${{ matrix.shard }}/3) | 20 | 0.0s | 0.0s |
