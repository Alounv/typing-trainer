/**
 * `settings` lib — public API surface.
 *
 * User-profile read/write/defaults and the export/import domain. The
 * `DataTransfer` Svelte component is reached via its file path. The
 * `UserSettings` and `Language` types live in `$lib/core` — see
 * [ARCHITECTURE.md](../../ARCHITECTURE.md).
 */
export * from './profile';
export * from './data-transfer';
export * from './defaults';
