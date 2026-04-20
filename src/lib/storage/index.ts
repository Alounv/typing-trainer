/**
 * `storage` lib — public API surface.
 *
 * Low-level IndexedDB access. Only domain modules (`session/persistence`,
 * `settings/profile`, `settings/data-transfer`, and the loaders) should
 * reach into this lib — the ESLint boundary rules enforce that. UI goes
 * through the domain.
 */
export * from './service';
export * from './db';
