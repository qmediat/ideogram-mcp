/**
 * One budget per tool call: the deadline every HTTP attempt, retry sleep, poll and download of that call is judged
 * against, and the signal that aborts them all — the caller's own cancellation (the MCP SDK's `extra.signal`, sent when
 * the client times out or the user cancels) or this server's own limit. An MCP client gives up at 60 s by default; a
 * request still being (re)sent after that would create a billed job whose id reaches nobody, so the server's own limit
 * is 55 s and nothing of a call outlives it.
 */

export interface Clock {
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts (the timer is cleared: nothing of a cancelled call lingers). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((done) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        done();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        done();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

/** This server's limit on one tool call: the MCP client's default 60 s minus a margin. */
export const TOOL_CALL_MS = 55_000;

export interface CallBudget {
  /** The instant (on `clock`) after which nothing of this call may still run. */
  readonly deadline: number;
  /** Aborts every attempt of the call: the caller's cancellation, or this server's limit. */
  readonly signal: AbortSignal;
  readonly clock: Clock;
}

/** The budget of one tool call: `cancel` is the caller's signal when the transport gives one. */
export function toolCallBudget(clock: Clock, cancel?: AbortSignal, ms: number = TOOL_CALL_MS): CallBudget {
  const own = AbortSignal.timeout(ms);
  const signal = cancel === undefined ? own : AbortSignal.any([cancel, own]);
  return { deadline: clock.now() + ms, signal, clock };
}

/** A budget without a limit, for a caller outside a tool call (a script, a test of one request). */
export function openBudget(clock: Clock = SYSTEM_CLOCK): CallBudget {
  return { deadline: Number.POSITIVE_INFINITY, signal: new AbortController().signal, clock };
}

/** The same call, ending no later than `deadline` (a poll ends with the tool's wait, never after the call). */
export function boundedBy(budget: CallBudget, deadline: number): CallBudget {
  return deadline < budget.deadline ? { ...budget, deadline } : budget;
}

export function remainingMs(budget: CallBudget): number {
  return budget.deadline - budget.clock.now();
}

/** Sleeps `ms` on the budget's clock, or less: the budget's signal (the caller's cancellation, the call's own limit) ends
 * the sleep at once, so a cancelled call does not keep its handler waiting; a clock that cannot be woken (a test's) is
 * raced with the signal instead. */
export function sleepWithin(budget: CallBudget, ms: number): Promise<void> {
  if (budget.signal.aborted) return Promise.resolve();
  return new Promise((done) => {
    const onAbort = (): void => done();
    budget.signal.addEventListener("abort", onAbort, { once: true });
    void budget.clock.sleep(ms, budget.signal).then(() => {
      budget.signal.removeEventListener("abort", onAbort);
      done();
    });
  });
}
