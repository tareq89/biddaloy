## CI timing trend

Over the trailing 55 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 58% (32/55)

### Wall time

| n | Median | p90 |
|---:|---:|---:|
| 55 | 737.0s | 813.0s |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Frontend tests | 55 | 705.0s | 757.0s |
| E2E (chromium 1/3) | 52 | 454.0s | 488.0s |
| E2E (chromium 2/3) | 52 | 408.0s | 457.0s |
| E2E (chromium 3/3) | 52 | 411.0s | 448.0s |
| Integration & e2e tests | 55 | 363.0s | 434.0s |
| Lighthouse (3G budgets) | 55 | 0.0s | 312.0s |
| Build, lint, unit tests | 55 | 201.0s | 239.0s |
| Storybook build | 55 | 70.0s | 95.0s |
| Dependency vulnerability scan | 55 | 63.0s | 92.0s |
| Bundle size delta | 55 | 61.0s | 89.0s |
| Test timings & budgets | 55 | 10.0s | 14.0s |
| Detect changed areas | 55 | 7.0s | 8.0s |
| E2E (${{ matrix.browser }} ${{ matrix.shard }}/3) | 3 | -1.0s | 0.0s |
