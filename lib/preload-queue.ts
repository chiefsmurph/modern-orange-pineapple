// A small image preload queue for product pages.
//
// - Background work runs in plan order, at most `concurrency` at a time, and
//   only while started (the page starts it once its first photo is showing).
// - request(key) is for what the visitor just picked: it jumps the queue and
//   starts at once. Every other download in flight (background work, or an
//   earlier pick the visitor has already moved on from) is cancelled and put
//   back at the front of the plan, and nothing else starts until it lands.
// - Every key loads once; a failed one can be retried by a later request.
// - abort() cancels everything (the page unmounts).
// The actual loading is injected (`run`), so the logic is testable without a browser.

export type LoadStatus = "idle" | "loading" | "loaded" | "failed";

export type PreloadQueue<T> = {
  /** Replace the background order (keys already loaded or loading are skipped). */
  setPlan(keys: string[]): void;
  /** Let background jobs run (until pause/abort). */
  start(): void;
  pause(): void;
  /** Load this now, ahead of everything; resolves with the loaded value. */
  request(key: string): Promise<T>;
  status(key: string): LoadStatus;
  value(key: string): T | undefined;
  abort(): void;
  /** For tests and the console. */
  inFlight(): number;
};

export function createPreloadQueue<T>({
  concurrency,
  run,
}: {
  concurrency: number;
  /** Load one key. `urgent` = the visitor is waiting for it. Must honour `signal`. */
  run: (key: string, urgent: boolean, signal: AbortSignal) => Promise<T>;
}): PreloadQueue<T> {
  const state = new Map<string, { status: LoadStatus; value?: T; promise?: Promise<T> }>();
  /** Downloads in flight, so a new request can pre-empt them. */
  const inflight = new Map<string, AbortController>();
  let plan: string[] = [];
  let running = 0;
  let urgentRunning = 0;
  let started = false;
  let aborted = false;
  const controller = new AbortController();

  const statusOf = (key: string): LoadStatus => state.get(key)?.status ?? "idle";

  const launch = (key: string, urgent: boolean): Promise<T> => {
    running++;
    if (urgent) urgentRunning++;
    // each job aborts with the queue, and background jobs also on pre-emption
    const job = new AbortController();
    const stop = () => job.abort();
    controller.signal.addEventListener("abort", stop, { once: true });
    inflight.set(key, job);
    const promise = run(key, urgent, job.signal).then(
      (value) => {
        state.set(key, { status: "loaded", value, promise });
        return value;
      },
      (err) => {
        // pre-empted work goes back to "idle" (it's re-queued); real failures stay failed
        state.set(key, { status: job.signal.aborted && !aborted ? "idle" : "failed" });
        throw err;
      }
    );
    state.set(key, { status: "loading", promise });
    promise
      .catch(() => undefined)
      .finally(() => {
        running--;
        if (urgent) urgentRunning--;
        inflight.delete(key);
        controller.signal.removeEventListener("abort", stop);
        pump();
      });
    return promise;
  };

  /** Cancel every download but `key`; they go back to the front of the plan. */
  const preemptAllBut = (key: string) => {
    const others = Array.from(inflight.keys()).filter((k) => k !== key);
    for (const k of others) inflight.get(k)!.abort();
    plan = [...others, ...plan.filter((k) => !others.includes(k))];
  };

  const pump = () => {
    if (!started || aborted) return;
    while (urgentRunning === 0 && running < concurrency) {
      const next = plan.find((k) => statusOf(k) === "idle");
      if (!next) return;
      plan = plan.filter((k) => k !== next);
      void launch(next, false).catch(() => undefined);
    }
  };

  return {
    setPlan(keys) {
      const seen = new Set<string>();
      plan = keys.filter((k) => !seen.has(k) && (seen.add(k), true));
      pump();
    },
    start() {
      started = true;
      pump();
    },
    pause() {
      started = false;
    },
    request(key) {
      if (aborted) return Promise.reject(new Error("aborted"));
      const s = state.get(key);
      if (s?.status === "loaded") return Promise.resolve(s.value as T);
      preemptAllBut(key);
      if (s?.status === "loading" && s.promise) {
        // Already on its way: hold other starts until it lands.
        urgentRunning++;
        s.promise.catch(() => undefined).finally(() => {
          urgentRunning--;
          pump();
        });
        return s.promise;
      }
      plan = plan.filter((k) => k !== key);
      return launch(key, true);
    },
    status: statusOf,
    value: (key) => state.get(key)?.value,
    abort() {
      aborted = true;
      plan = [];
      controller.abort();
    },
    inFlight: () => running,
  };
}
