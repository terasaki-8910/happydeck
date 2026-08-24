/**
 * An error whose human-facing summary and raw technical detail are kept
 * apart.
 *
 * Previously the two were concatenated into one string and rendered as a
 * single line, which meant a failure from a remote shell command dumped
 * things like base64's entire usage text into the UI — the actionable
 * sentence buried in noise the user can do nothing with. Splitting them
 * lets the summary stay short while the detail is still one click away
 * (and still goes to the debug log in full either way).
 */
export class DetailedError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'DetailedError';
    this.detail = detail?.trim() || undefined;
  }
}

/** Pulls the summary/detail pair back out of anything thrown. */
export function splitError(error: unknown): { message: string; detail?: string } {
  if (error instanceof DetailedError) return { message: error.message, detail: error.detail };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}
