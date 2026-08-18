import type { Language } from '../store/settingsStore';

/**
 * resumeSession's failure messages come straight from the daemon's own
 * resume-happy-session RPC handler (happy-cli) — it distinguishes a few
 * different unresumable states, each fixable (or not) in a different way.
 * Surface each with a specific, actionable explanation instead of the raw
 * protocol string.
 */
export function explainResumeError(raw: string, language: Language): string {
  if (/not available/i.test(raw)) {
    return language === 'ja'
      ? `そのマシンではResumeがまだ使えません — daemonがResumeハンドラを登録するには、そのマシン自身にローカルのHappy Agent Auth（~/.happy/agent.key）が必要です。（${raw}）`
      : `Resume isn't set up on that machine yet — it needs its own local Happy Agent Auth (~/.happy/agent.key) before it can register a resume handler. (${raw})`;
  }
  if (/not tracked by this daemon/i.test(raw)) {
    return language === 'ja'
      ? `このセッションはdaemon自身が起動したものではないため再開できません — 再開できるのはdaemonが起動したセッションだけです（例：ここでの「新規セッション」経由）。ターミナルで直接\`happy\`と実行したセッションや、起動元のdaemonが再起動した後のセッションは対象外です。（${raw}）`
      : `That session can't be resumed because the daemon never spawned it — resume only works for a session the daemon itself started (e.g. via "new session" here), not one launched by running \`happy\` directly in a terminal, and not after the daemon that spawned it has restarted. (${raw})`;
  }
  return raw;
}
