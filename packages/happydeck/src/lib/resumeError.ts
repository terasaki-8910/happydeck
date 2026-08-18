/**
 * resumeSession's failure messages come straight from the daemon's own
 * resume-happy-session RPC handler (happy-cli) — it distinguishes a few
 * different unresumable states, each fixable (or not) in a different way.
 * Surface each with a specific, actionable explanation instead of the raw
 * protocol string.
 */
export function explainResumeError(raw: string): string {
  if (/not available/i.test(raw)) {
    return `Resume isn't set up on that machine yet — it needs its own local Happy Agent Auth (~/.happy/agent.key) before it can register a resume handler. (${raw})`;
  }
  if (/not tracked by this daemon/i.test(raw)) {
    return `That session can't be resumed because the daemon never spawned it — resume only works for a session the daemon itself started (e.g. via "new session" here), not one launched by running \`happy\` directly in a terminal, and not after the daemon that spawned it has restarted. (${raw})`;
  }
  return raw;
}
