// [50.13] Budget gate for the landing site (D21). Same device profile as lighthouserc.cjs
// (mid-range Android on 3G), but static pages: no login, much tighter numbers.
// Raising a number here is a deliberate decision, never a CI fix.
// Serve first: `npx --yes serve@14.2.4 landing/dist -l 4321`. Trailing slashes on purpose (trailingSlash: 'always').
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      url: [
        'http://localhost:4321/bn/',
        'http://localhost:4321/bn/pricing/',
        'http://localhost:4321/en/',
        'http://localhost:4321/bn/for/madrasa/',
      ],
      settings: {
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 2 },
        throttling: { rttMs: 400, throughputKbps: 700, cpuSlowdownMultiplier: 4 },
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.95 }],
        'categories:accessibility': ['error', { minScore: 1 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 1500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        // 50 KB of JavaScript per page, as downloaded.
        'resource-summary:script:size': ['error', { maxNumericValue: 51200 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci-landing' },
  },
};
