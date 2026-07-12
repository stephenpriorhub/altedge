/**
 * Claude models used by ShadowData. Budget-conscious split: a cheap model resolves
 * entity identifiers (mechanical extraction), a stronger model does thesis
 * synthesis (reasoning that must be defensible).
 */
export const RESOLVE_MODEL = "claude-haiku-4-5-20251001";
export const SYNTH_MODEL = "claude-sonnet-5";
