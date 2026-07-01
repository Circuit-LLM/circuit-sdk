// Decision rule — a tiny, safe, deterministic DSL the owner commits and the signer
// re-runs. No arbitrary code (safe to evaluate inside the signer), pure (reproducible),
// so client and signer always agree on what a given set of inputs justifies.

export type Comparable = number | string | boolean;
export type Op = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface Condition {
  input: string;
  op: Op;
  value: Comparable;
}

export interface RuleThen {
  kind: 'buy' | 'sell';
  /** the token mint — a literal, or read from an input. */
  token?: string;
  tokenInput?: string;
  /** SOL notional — a literal, or read from an input. */
  sizeSol?: number;
  sizeInput?: string;
}

export interface Rule {
  id: string;
  /** ALL conditions must hold for the rule to fire. */
  when: Condition[];
  then: RuleThen;
  /** inputs that MUST be evidence-backed (the gate enforces this). */
  requires: string[];
}

export type RuleInputs = Record<string, Comparable>;

/** The intent shape a rule produces (structurally compatible with @circuit-llm/agent's Intent). */
export interface Intent {
  kind: 'buy' | 'sell';
  token?: string;
  sizeSol?: number;
  amount?: number;
  maxSlippageBps?: number;
}

function cmp(a: Comparable | undefined, op: Op, b: Comparable): boolean {
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return typeof a === 'number' && typeof b === 'number' && a < b;
    case '<=':
      return typeof a === 'number' && typeof b === 'number' && a <= b;
    case '>':
      return typeof a === 'number' && typeof b === 'number' && a > b;
    case '>=':
      return typeof a === 'number' && typeof b === 'number' && a >= b;
    default:
      return false;
  }
}

/** Evaluate the rule against inputs. Returns the intent it justifies, or null. Pure. */
export function evaluateRule(rule: Rule, inputs: RuleInputs): Intent | null {
  for (const c of rule.when) {
    if (!cmp(inputs[c.input], c.op, c.value)) return null;
  }
  const t = rule.then;
  const token = t.token ?? (t.tokenInput != null ? String(inputs[t.tokenInput]) : undefined);
  const sizeSol = t.sizeSol ?? (t.sizeInput != null ? Number(inputs[t.sizeInput]) : undefined);
  const intent: Intent = { kind: t.kind };
  if (token != null) intent.token = token;
  if (sizeSol != null) intent.sizeSol = sizeSol;
  return intent;
}

/** Structural equality on the trade-relevant fields (kind/token/sizeSol). */
export function sameIntent(a: Intent, b: Intent): boolean {
  return a.kind === b.kind && (a.token ?? null) === (b.token ?? null) && (a.sizeSol ?? null) === (b.sizeSol ?? null);
}

/** Validate a rule's shape (use when accepting an owner-committed rule). */
export function normalizeRule(rule: Rule): Rule {
  if (!rule.id || typeof rule.id !== 'string') throw new Error('rule.id required');
  if (!Array.isArray(rule.when)) throw new Error('rule.when must be an array');
  if (!rule.then || (rule.then.kind !== 'buy' && rule.then.kind !== 'sell'))
    throw new Error('rule.then.kind must be buy|sell');
  return { ...rule, requires: Array.isArray(rule.requires) ? rule.requires : [] };
}
