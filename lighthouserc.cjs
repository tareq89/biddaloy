// Budgets measured against a mid-range Android on 3G — the actual device
// profile of a school administrator in Dhaka. See #149 for the reasoning;
// raising any number here is a deliberate decision, same rule as the
// bundle ceiling in check-route-chunks.mjs.
//
// The numeric budgets (4000 ms LCP / 0.1 CLS / 600 ms TBT) are starting
// points for this 3G profile — tighten against recorded main-run numbers
// once there is headroom.
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      puppeteerScript: './scripts/lighthouse-auth.cjs',
      url: [
        'http://localhost:5174/login',
        'http://localhost:5174/fees/dues',
        // The guardian portal landing, measured as parent@biddaloy.test (see
        // lighthouse-auth.cjs). It is here because it is the page a webfont
        // swap is most likely to shift — [8.13.2] added the two self-hosted
        // subsets, and this is where the 0.1 CLS budget has to prove it.
        'http://localhost:5174/portal',
        // STUDENT_DETAIL_URL is appended at runtime by the CI step —
        // it contains a seeded student's real id.
      ],
      settings: {
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 2 },
        // Explicit 3G, not Lighthouse's slow-4G default (1.6 Mbps / 150 ms).
        throttling: {
          rttMs: 400, // 3G RTT
          throughputKbps: 700, // 3G downlink
          cpuSlowdownMultiplier: 4,
        },
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.8 }],
        // 100, not 90: the Lighthouse a11y audit is a shallow check;
        // anything under perfect on a shallow check means something
        // obvious is broken.
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 4000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        // INP is a field-only metric; TBT is its lab proxy.
        'total-blocking-time': ['error', { maxNumericValue: 600 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
