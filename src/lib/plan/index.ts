/**
 * Plan
 * Resolves "what should the user do next?".
 *
 * Reads session history and bigram skill to pick a drill mode + target
 * bigrams, hands the config off to the session route, and tracks the plan
 * window (cooldown between regenerations). Does not run the drill itself
 * or score results — `session` owns the live interaction, `skill` owns
 * the per-bigram classification it reads from.
 */
export { computePlan } from './plan';
export type { PlanContext } from './plan';
export { startPlannedSession, startFreshPlan } from './plan-actions';
export { consumePlannedSession } from './planned';
export { resolveDrillMix } from './resolve-drill-mix';
export type { PlannedSession } from './types';
