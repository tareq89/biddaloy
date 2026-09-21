## CI timing trend

Over the trailing 57 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 23% (13/57)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 57 | 367.0s | 426.0s | 77% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| E2E smoke (chromium) | 51 | 342.0s | 368.0s |
| Integration & e2e tests | 57 | 298.0s | 331.0s |
| Frontend tests (3/3) | 51 | 228.0s | 241.0s |
| Frontend tests (1/3) | 51 | 217.0s | 234.0s |
| Frontend tests (2/3) | 51 | 212.0s | 229.0s |
| Build, lint, unit tests | 57 | 158.0s | 172.0s |
| Frontend coverage merge | 57 | 46.0s | 56.0s |
| Storybook build | 57 | 41.0s | 54.0s |
| Bundle size delta | 57 | 32.0s | 48.0s |
| Dependency vulnerability scan | 57 | 40.0s | 47.0s |
| Test timings & budgets | 57 | 10.0s | 14.0s |
| Detect changed areas | 57 | 7.0s | 8.0s |
| Nightly quality (merge queue) | 57 | 0.0s | 0.0s |
| Route sweeps (chromium-sweeps) | 57 | -1.0s | 0.0s |
| Frontend tests (${{ matrix.shard }}/3) | 6 | -1.0s | 0.0s |
| E2E smoke (${{ matrix.browser }}) | 6 | -1.0s | 0.0s |
