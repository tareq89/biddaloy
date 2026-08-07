import { Placeholder } from '@biddaloy/ui';

// Scaffolding placeholder, not a real page — wiring I18nProvider into this
// app's real entry point (main.tsx) is app-wide provider adoption, a later
// ticket's call (see ui/README.md's Testing section on why
// renderWithProviders's stack isn't the real app's yet). Real routes swap
// this whole component out; disabling per-line rather than leaving the
// rule off for the file so a genuine future violation here still gets
// caught.
export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <Placeholder>
        {/* eslint-disable-next-line boundary/no-hardcoded-jsx-text */}
        <h1 className="text-4xl font-bold">biddaloy Admin</h1>
        {/* eslint-disable-next-line boundary/no-hardcoded-jsx-text */}
        <p className="mt-4 text-lg text-neutral-600">Welcome to the admin console.</p>
      </Placeholder>
    </div>
  );
}
