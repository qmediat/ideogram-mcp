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

/** The reason a bounded budget's signal aborts with: the tool's wait ran out (not the call's limit, not a cancel). */
export class WaitEnded extends Error {
  constructor() {
    super("the wait ran out");
    this.name = "WaitEnded";
  }
}

/** Built only by the factories below: an attempt whose remaining budget is the shorter bound has no timer of its own and
 * ends through `signal`, so every budget's signal MUST abort at its deadline — the private constructor keeps a literal or
 * a spread from standing in for one. */
export class CallBudget {
  private constructor(
    /** The instant (on `clock`) after which nothing of this call may still run. */
    readonly deadline: number,
    /** Aborts every attempt of the call: the caller's cancellation, this server's limit, or (bounded) the tool's wait. */
    readonly signal: AbortSignal,
    readonly clock: Clock,
    /** What this budget's deadline is: the call's limit, or a wait inside it. */
    readonly bound: "call" | "wait",
    /** Releases what the budget holds (a bounded budget's timer); a no-op for a call's own budget. */
    readonly end: () => void,
  ) {}

  /** The budget of one tool call: `cancel` is the caller's signal when the transport gives one. */
  static ofToolCall(clock: Clock, cancel?: AbortSignal, ms: number = TOOL_CALL_MS): CallBudget {
    const own = AbortSignal.timeout(ms);
    const signal = cancel === undefined ? own : AbortSignal.any([cancel, own]);
    return new CallBudget(clock.now() + ms, signal, clock, "call", () => undefined);
  }

  /** A budget without a limit, for a caller outside a tool call (a script, a test of one request). */
  static open(clock: Clock): CallBudget {
    return new CallBudget(Number.POSITIVE_INFINITY, new AbortController().signal, clock, "call", () => undefined);
  }

  /** The same call, ending no later than `deadline` (a poll ends with the tool's wait, never after the call): the nearer
   * deadline gets a signal of its own with its own reason (WaitEnded), so a cut at it arrives through the signal like a cut
   * at the call's end — one timer per bound, never two timers for one instant. `end()` clears the timer. */
  boundedBy(deadline: number): CallBudget {
    if (deadline >= this.deadline) return this;
    const controller = new AbortController();
    // a referenced timer: the poll clears it in its finally, so nothing lingers — unref'd, a test awaiting the signal alone
    // had no live handle and Node 22 ended the event loop under it ("Promise resolution is still pending")
    const timer = setTimeout(() => controller.abort(new WaitEnded()), Math.max(1, Math.ceil(deadline - this.clock.now())));
    const signal = AbortSignal.any([this.signal, controller.signal]);
    return new CallBudget(deadline, signal, this.clock, "wait", () => clearTimeout(timer));
  }
}

/** The budget of one tool call: `cancel` is the caller's signal when the transport gives one. */
export function toolCallBudget(clock: Clock, cancel?: AbortSignal, ms: number = TOOL_CALL_MS): CallBudget {
  return CallBudget.ofToolCall(clock, cancel, ms);
}

/** A budget without a limit, for a caller outside a tool call (a script, a test of one request). */
export function openBudget(clock: Clock = SYSTEM_CLOCK): CallBudget {
  return CallBudget.open(clock);
}

/** The same call, ending no later than `deadline`: see CallBudget.boundedBy. */
export function boundedBy(budget: CallBudget, deadline: number): CallBudget {
  return budget.boundedBy(deadline);
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
    const wake = (): void => {
      budget.signal.removeEventListener("abort", onAbort);
      done();
    };
    budget.clock.sleep(ms, budget.signal).then(wake, wake); // a clock that fails still ends the sleep

  });
}
