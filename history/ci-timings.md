## CI timing trend

Over the trailing 36 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 94% (34/36)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 36 | 1167.0s | 1922.0s | 6% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Integration & e2e tests | 36 | 987.0s | 1900.0s |
| E2E smoke (chromium) | 35 | 935.0s | 1126.0s |
| Frontend tests (3/3) | 35 | 699.0s | 776.0s |
| Frontend tests (2/3) | 35 | 692.0s | 753.0s |
| Frontend tests (1/3) | 35 | 716.0s | 753.0s |
| Build, lint, unit tests | 36 | 244.0s | 303.0s |
| Infra config tests | 36 | 0.0s | 97.0s |
| Dependency vulnerability scan | 36 | 43.0s | 63.0s |
| Storybook build | 36 | 51.0s | 63.0s |
| Frontend coverage merge | 36 | 52.0s | 63.0s |
| Bundle size delta | 36 | 0.0s | 49.0s |
| Test timings & budgets | 36 | 11.0s | 15.0s |
| Detect changed areas | 36 | 8.0s | 9.0s |
| Route sweeps (chromium-sweeps) | 36 | -1.0s | 0.0s |
| Nightly quality (merge queue) | 36 | -1.0s | 0.0s |
| E2E smoke (${{ matrix.browser }}) | 1 | -1.0s | -1.0s |
| Frontend tests (${{ matrix.shard }}/3) | 1 | -1.0s | -1.0s |
