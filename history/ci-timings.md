## CI timing trend

Over the trailing 49 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 96% (47/49)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 49 | 1248.0s | 2300.0s | 4% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| E2E cockpit | 49 | 1090.0s | 1136.0s |
| E2E smoke (chromium 4/4) | 47 | 831.0s | 1038.0s |
| E2E smoke (chromium 3/4) | 47 | 697.0s | 808.0s |
| E2E smoke (chromium 2/4) | 47 | 638.0s | 797.0s |
| Server e2e (1/2) | 41 | 585.0s | 711.0s |
| Server e2e (2/2) | 41 | 546.0s | 703.0s |
| E2E smoke (chromium 1/4) | 47 | 522.0s | 624.0s |
| Demo-seed specs | 49 | 472.0s | 611.0s |
| Integration tests (1/3) | 41 | 401.0s | 584.0s |
| Integration tests (3/3) | 41 | 438.0s | 569.0s |
| Integration tests (2/3) | 41 | 444.0s | 550.0s |
| Frontend tests (5/6) | 47 | 403.0s | 545.0s |
| Frontend tests (1/6) | 47 | 394.0s | 541.0s |
| Frontend tests (4/6) | 47 | 380.0s | 526.0s |
| Frontend tests (6/6) | 47 | 425.0s | 499.0s |
| Frontend tests (2/6) | 47 | 375.0s | 496.0s |
| Frontend tests (3/6) | 47 | 395.0s | 469.0s |
| Build, lint, unit tests | 49 | 202.0s | 466.0s |
| E2E PWA | 49 | 326.0s | 386.0s |
| Dependency vulnerability scan | 49 | 235.0s | 317.0s |
| Infra config tests | 49 | 211.0s | 278.0s |
| Landing build | 49 | 80.0s | 150.0s |
| User guide checks | 49 | 71.0s | 136.0s |
| Site build and test | 49 | 72.0s | 129.0s |
| Storybook build | 49 | 90.0s | 122.0s |
| Frontend coverage merge | 49 | 66.0s | 89.0s |
| Bundle size delta | 49 | 0.0s | 75.0s |
| Test timings & budgets | 49 | 22.0s | 28.0s |
| Detect changed areas | 49 | 12.0s | 17.0s |
| Nightly quality (merge queue) | 49 | 0.0s | 0.0s |
| Route sweeps (chromium-sweeps) | 49 | 0.0s | 0.0s |
| Integration tests (${{ matrix.shard }}/3) | 8 | -1.0s | 0.0s |
| Server e2e (${{ matrix.shard }}/2) | 8 | -1.0s | 0.0s |
| Frontend tests (${{ matrix.shard }}/6) | 2 | -1.0s | -1.0s |
| E2E smoke (${{ matrix.browser }} ${{ matrix.shard }}/4) | 2 | -1.0s | -1.0s |
