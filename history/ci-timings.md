## CI timing trend

Over the trailing 59 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 66% (39/59)

### Wall time

| n | Median | p90 |
|---:|---:|---:|
| 59 | 469.0s | 824.0s |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Frontend tests | 59 | 428.0s | 647.0s |
| E2E (chromium 1/3) | 58 | 393.0s | 438.0s |
| E2E (chromium 3/3) | 58 | 360.0s | 389.0s |
| E2E (chromium 2/3) | 58 | 328.0s | 383.0s |
| Integration & e2e tests | 59 | 249.0s | 308.0s |
| Lighthouse (3G budgets) | 59 | 0.0s | 289.0s |
| Build, lint, unit tests | 59 | 158.0s | 189.0s |
| Storybook build | 59 | 62.0s | 96.0s |
| Dependency vulnerability scan | 59 | 53.0s | 85.0s |
| Bundle size delta | 59 | 60.0s | 83.0s |
| Test timings & budgets | 59 | 11.0s | 14.0s |
| Detect changed areas | 59 | 6.0s | 8.0s |
| E2E (${{ matrix.browser }} ${{ matrix.shard }}/3) | 1 | -1.0s | -1.0s |
