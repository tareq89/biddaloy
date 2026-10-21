// Dark-mode "flash of wrong theme" prevention (see the comment in index.html).
// An external file because the production CSP is `script-src 'self'`, which
// blocks inline scripts. Keep in sync with `ui/src/theme/theme-storage.ts`.
(function () {
  try {
    var stored = localStorage.getItem('biddaloy:theme');
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) {
      document.documentElement.dataset.theme = 'dark';
      document.querySelector('meta[name="theme-color"]').setAttribute('content', '#1e293b');
    }
  } catch (e) {}
})();
