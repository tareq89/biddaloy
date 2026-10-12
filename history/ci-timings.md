## CI timing trend

Over the trailing 50 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 82% (41/50)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 50 | 841.0s | 1021.0s | 18% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Integration & e2e tests | 50 | 674.0s | 980.0s |
| E2E smoke (chromium) | 49 | 717.0s | 905.0s |
| Frontend tests (2/3) | 49 | 614.0s | 715.0s |
| Frontend tests (3/3) | 49 | 526.0s | 681.0s |
| Frontend tests (1/3) | 49 | 640.0s | 678.0s |
| Build, lint, unit tests | 50 | 256.0s | 297.0s |
| Frontend coverage merge | 50 | 53.0s | 62.0s |
| Storybook build | 50 | 50.0s | 60.0s |
| Bundle size delta | 50 | 0.0s | 51.0s |
| Dependency vulnerability scan | 50 | 40.0s | 47.0s |
| Test timings & budgets | 50 | 12.0s | 16.0s |
| Detect changed areas | 50 | 8.0s | 10.0s |
| Route sweeps (chromium-sweeps) | 50 | 0.0s | 0.0s |
| Nightly quality (merge queue) | 50 | 0.0s | 0.0s |
| Frontend tests (${{ matrix.shard }}/3) | 1 | 0.0s | 0.0s |
| E2E smoke (${{ matrix.browser }}) | 1 | 0.0s | 0.0s |
