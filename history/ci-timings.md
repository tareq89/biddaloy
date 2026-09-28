## CI timing trend

Over the trailing 59 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 56% (33/59)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 59 | 444.0s | 518.0s | 44% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Integration & e2e tests | 59 | 394.0s | 472.0s |
| E2E smoke (chromium) | 58 | 382.0s | 444.0s |
| Frontend tests (1/3) | 58 | 287.0s | 318.0s |
| Frontend tests (3/3) | 58 | 293.0s | 316.0s |
| Frontend tests (2/3) | 58 | 286.0s | 312.0s |
| Build, lint, unit tests | 59 | 184.0s | 202.0s |
| Storybook build | 59 | 48.0s | 57.0s |
| Frontend coverage merge | 59 | 46.0s | 55.0s |
| Bundle size delta | 59 | 36.0s | 48.0s |
| Dependency vulnerability scan | 59 | 38.0s | 47.0s |
| Test timings & budgets | 59 | 10.0s | 14.0s |
| Detect changed areas | 59 | 7.0s | 8.0s |
| Nightly quality (merge queue) | 59 | 0.0s | 0.0s |
| Route sweeps (chromium-sweeps) | 59 | 0.0s | 0.0s |
| Frontend tests (${{ matrix.shard }}/3) | 1 | 0.0s | 0.0s |
| E2E smoke (${{ matrix.browser }}) | 1 | -1.0s | -1.0s |
