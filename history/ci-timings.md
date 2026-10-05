## CI timing trend

Over the trailing 58 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 22% (13/58)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 58 | 664.0s | 716.0s | 78% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Integration & e2e tests | 58 | 613.0s | 686.0s |
| E2E smoke (chromium) | 55 | 565.0s | 616.0s |
| Frontend tests (3/3) | 55 | 381.0s | 410.0s |
| Frontend tests (2/3) | 55 | 366.0s | 398.0s |
| Frontend tests (1/3) | 55 | 368.0s | 389.0s |
| Build, lint, unit tests | 58 | 220.0s | 237.0s |
| Frontend coverage merge | 58 | 48.0s | 57.0s |
| Storybook build | 58 | 43.0s | 55.0s |
| Bundle size delta | 58 | 36.0s | 50.0s |
| Dependency vulnerability scan | 58 | 38.0s | 44.0s |
| Test timings & budgets | 58 | 11.0s | 13.0s |
| Detect changed areas | 58 | 7.0s | 8.0s |
| Nightly quality (merge queue) | 58 | 0.0s | 0.0s |
| Route sweeps (chromium-sweeps) | 58 | 0.0s | 0.0s |
| Frontend tests (${{ matrix.shard }}/3) | 3 | -1.0s | -1.0s |
| E2E smoke (${{ matrix.browser }}) | 3 | -1.0s | -1.0s |
