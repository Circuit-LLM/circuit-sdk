// The decision gate — the heart of Verified Intents. The signer runs this before
// signing any trade. It proves the trade is the genuine output of the owner's committed
// rule on authenticated inputs — so a host that controls the agent still cannot get a
// trade signed that the inputs + rule don't justify.

import {
  verifyEvidence,
  evidenceBacks,
  type Evidence,
  type VerifyEvidenceOpts,
} from './evidence.ts';
import { evaluateRule, sameIntent, type Intent, type Rule, type RuleInputs } from './rule.ts';

/** What the agent submits in place of a bare intent. */
export interface VerifiedIntent {
  intent: Intent;
  /** the rule id this trade claims to satisfy. */
  rule: string;
  /** the input values the rule consumed (must match the evidence). */
  inputs: RuleInputs;
  evidence: Evidence[];
}

export interface GateOptions extends VerifyEvidenceOpts {
  /** the owner-committed rule the signer looked up by VerifiedIntent.rule. */
  rule: Rule;
}

export interface GateResult {
  ok: boolean;
  /** verified | unknown-rule | evidence-* | input-mismatch | decision-unjustified */
  code: string;
}

/**
 * Decide whether to sign. Steps:
 *   1. the claimed rule must be the committed rule
 *   2. every evidence item: trusted signer/notary + valid signature/proof + fresh + not replayed
 *   3. every required input must be authenticated by some evidence (bind inputs ⇒ evidence)
 *   4. re-run the rule on the inputs; the result must equal the submitted intent
 * Any failure ⇒ { ok:false, code }. Only on full success ⇒ { ok:true, code:'verified' }.
 */
export function decisionGate(vi: VerifiedIntent, opts: GateOptions): GateResult {
  if (vi.rule !== opts.rule.id) return { ok: false, code: 'unknown-rule' };

  for (const ev of vi.evidence) {
    const r = verifyEvidence(ev, opts);
    if (!r.ok) return r;
  }

  for (const key of opts.rule.requires) {
    if (!evidenceBacks(vi.evidence, key, vi.inputs[key] as never)) {
      return { ok: false, code: 'input-mismatch' };
    }
  }

  const expected = evaluateRule(opts.rule, vi.inputs);
  if (!expected || !sameIntent(expected, vi.intent)) {
    return { ok: false, code: 'decision-unjustified' };
  }

  return { ok: true, code: 'verified' };
}
