/**
 * Settings
 * Reads and writes the user profile.
 *
 * Applies defaults on load so every caller (settings page, session setup,
 * analytics, planner) sees the same factory-fresh shape, and is the
 * UI-facing boundary for anything profile-shaped — routes must not reach
 * into `support/storage` directly.
 */
export { getProfile, saveProfile, buildDefaultProfile, withDefaults } from './profile';
