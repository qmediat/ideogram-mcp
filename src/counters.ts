/**
 * What this process tolerated instead of failing loudly, counted since it started: `ideogram_operations` shows the
 * line, so a client can see that retries happened or that a response broke the contract.
 */
export interface Counters {
  /** Requests sent again after a 429, a failed connection or a failed GET. */
  retries: number;
  /** 2xx bodies the generated schema rejected (each also returned as a ContractMismatch outcome). */
  contractMismatches: number;
  /** Polls of a generation that failed; the generation id was returned as pending instead. */
  pollErrors: number;
  /** Images a response listed that could not be downloaded. */
  downloadFailures: number;
}

export const COUNTERS: Counters = { retries: 0, contractMismatches: 0, pollErrors: 0, downloadFailures: 0 };

export function countersLine(): string {
  const c = COUNTERS;
  return `since start: ${c.retries} retries, ${c.contractMismatches} contract mismatches, ${c.pollErrors} poll errors, ${c.downloadFailures} failed downloads`;
}
