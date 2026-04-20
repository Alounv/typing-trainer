/**
 * `core` lib — shared domain types (no runtime).
 *
 * Holds the shapes that multiple runtime libs reference: `SessionSummary`,
 * `SessionType`, `SessionConfig`, `UserSettings`, `Language`. Runtime libs
 * depend on `core` instead of on each other for type imports, which keeps
 * the value-level dependency graph a strict DAG.
 */
export * from './types';
