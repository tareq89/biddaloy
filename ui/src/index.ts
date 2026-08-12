/**
 * Root barrel for `@biddaloy/ui`.
 *
 * Prefer the subpath exports (`@biddaloy/ui/components`, `/hooks`, `/utils`,
 * …) in application code — they keep import lines honest about what a module
 * actually depends on, and let a bundler drop the rest.
 */
export * from './components/index';
export * from './shells/index';
export * from './hooks/index';
export * from './utils/index';
export * from './i18n/index';
export * from './api/index';
