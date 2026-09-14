/** Automatic today syncs are deliberately limited to one request per hour. */
export const BISUITE_AUTO_FETCH_COOLDOWN_MS = 60 * 60 * 1000;

type ActiveFetch<T> = {
  startDate: string | undefined;
  endDate: string | undefined;
  promise: Promise<T>;
};

export type BisuiteFetchCoordinationResult<T> =
  | { kind: "completed"; result: T }
  | { kind: "skipped"; status: "fresh" | "busy" };

export class BisuiteFetchCoordinator<T> {
  private readonly inFlight = new Map<string, ActiveFetch<T>>();
  private readonly lastTodayFetchAt = new Map<string, number>();

  constructor(
    private readonly cooldownMs = BISUITE_AUTO_FETCH_COOLDOWN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async run(input: {
    orgId: string;
    startDate?: string;
    endDate?: string;
    automatic: boolean;
    todayRange: boolean;
    fetch: () => Promise<T>;
  }): Promise<BisuiteFetchCoordinationResult<T>> {
    const { orgId, startDate, endDate, automatic, todayRange, fetch } = input;
    const lastFetchAt = this.lastTodayFetchAt.get(orgId);
    if (
      automatic
      && !this.inFlight.has(orgId)
      && lastFetchAt !== undefined
      && this.now() - lastFetchAt < this.cooldownMs
    ) {
      return { kind: "skipped", status: "fresh" };
    }

    let activeFetch = this.inFlight.get(orgId);
    const sameRange = activeFetch?.startDate === startDate && activeFetch?.endDate === endDate;
    if (automatic && activeFetch && !sameRange) {
      return { kind: "skipped", status: "busy" };
    }
    if (activeFetch && !sameRange) {
      try {
        await activeFetch.promise;
      } catch {
        // A manual request may start even if the preceding sync failed.
      }
      activeFetch = undefined;
    }

    let fetchPromise = activeFetch?.promise;
    if (!fetchPromise) {
      fetchPromise = fetch();
      this.inFlight.set(orgId, { startDate, endDate, promise: fetchPromise });
    }

    try {
      const result = await fetchPromise;
      if (todayRange) this.lastTodayFetchAt.set(orgId, this.now());
      return { kind: "completed", result };
    } finally {
      if (this.inFlight.get(orgId)?.promise === fetchPromise) {
        this.inFlight.delete(orgId);
      }
    }
  }
}