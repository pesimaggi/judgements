/**
 * Per-stage time budgets.
 *
 * The well makes between two and five network calls per question, and any one
 * of them can hang. Without a budget the failure mode is the worst one
 * available: the reader watches a bucket go down a well until their browser
 * gives up, and no error is ever reported because nothing ever failed.
 *
 * Two shapes, because the stages differ in what a failure means. Planning,
 * reranking and verification are *improvements* — losing one costs quality and
 * the question is still answerable, so they degrade. Retrieval and the answer
 * are the feature, so they fail loudly and the route says so.
 */

export class AskTimeout extends Error {
  constructor(public readonly stage: string, public readonly ms: number) {
    super(`The ${stage} stage did not finish within ${ms}ms.`);
    this.name = "AskTimeout";
  }
}

/**
 * Rejects with `AskTimeout` if the promise has not settled in time.
 *
 * The underlying work is not cancelled — a fetch already in flight to a model
 * API cannot be recalled — so this bounds how long *we* wait, not how long the
 * provider takes. The timer is cleared either way so a fast call does not hold
 * the process open for the length of its budget.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AskTimeout(stage, ms)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * The same budget, but a stage that is allowed to be lost.
 *
 * Returns the fallback on a timeout *and* on any other failure, because the
 * caller's handling of both is identical: carry on without this stage's
 * contribution. What went wrong is logged, and reported through `onFailure` so
 * the metrics line can record that the stage did not run.
 */
export async function withTimeoutOr<T>(
  work: () => Promise<T>,
  ms: number,
  stage: string,
  fallback: T,
  onFailure?: (error: unknown) => void
): Promise<T> {
  try {
    return await withTimeout(work(), ms, stage);
  } catch (e) {
    console.error(`Ask: ${stage} failed, continuing without it:`, e);
    onFailure?.(e);
    return fallback;
  }
}
