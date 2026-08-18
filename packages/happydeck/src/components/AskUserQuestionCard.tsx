import { useState } from 'react';
import { useT } from '../lib/i18n';

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestionQuestion {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

interface AskUserQuestionCardProps {
  questions: AskUserQuestionQuestion[];
  busy: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}

/**
 * Claude Code's AskUserQuestion tool call arrives as an ordinary pending
 * permission request (agentState.requests) — the CLI routes it through the
 * exact same canUseTool/approval mechanism as any other tool, just never
 * auto-approved (confirmed against happy-cli's permissionHandler.ts). The
 * answer is sent back as `updatedInput: { answers }` on the SAME
 * sessionAllow('permission', ...) RPC an ordinary allow already uses —
 * `{ [question]: "chosen label(s), comma-joined" }`, matching the
 * reference happy-app's own AskUserQuestionView. No new protocol surface
 * needed, only this rendering + the answers payload.
 */
export function AskUserQuestionCard({ questions, busy, onSubmit }: AskUserQuestionCardProps) {
  const t = useT();
  const [selections, setSelections] = useState<Map<number, Set<number>>>(new Map());

  const toggle = (qIndex: number, oIndex: number, multiSelect: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(qIndex));
      if (multiSelect) {
        if (current.has(oIndex)) current.delete(oIndex);
        else current.add(oIndex);
      } else {
        current.clear();
        current.add(oIndex);
      }
      next.set(qIndex, current);
      return next;
    });
  };

  const allAnswered = questions.every((_, qIndex) => (selections.get(qIndex)?.size ?? 0) > 0);

  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((question, qIndex) => {
      const selected = selections.get(qIndex);
      if (!selected || selected.size === 0) return;
      answers[question.question] = Array.from(selected)
        .map((oIndex) => question.options[oIndex]?.label)
        .filter(Boolean)
        .join(', ');
    });
    onSubmit(answers);
  };

  return (
    <div className="ask-question-card">
      {questions.map((question, qIndex) => {
        const selected = selections.get(qIndex) ?? new Set<number>();
        return (
          <div key={question.question} className="ask-question">
            <span className="ask-question-header">{question.header}</span>
            <p className="ask-question-text">{question.question}</p>
            <div className="ask-question-options">
              {question.options.map((option, oIndex) => (
                <button
                  type="button"
                  key={option.label}
                  className={`ask-question-option ${selected.has(oIndex) ? 'ask-question-option-selected' : ''}`}
                  disabled={busy}
                  onClick={() => toggle(qIndex, oIndex, Boolean(question.multiSelect))}
                >
                  <span className={`ask-question-marker ${question.multiSelect ? 'ask-question-marker-checkbox' : 'ask-question-marker-radio'}`}>
                    {selected.has(oIndex) && <span className="ask-question-marker-dot" />}
                  </span>
                  <span className="ask-question-option-body">
                    <span className="ask-question-option-label">{option.label}</span>
                    {option.description && <span className="ask-question-option-description">{option.description}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <button type="button" className="ask-question-submit" disabled={!allAnswered || busy} onClick={submit}>
        {t('submitAnswer')}
      </button>
    </div>
  );
}
