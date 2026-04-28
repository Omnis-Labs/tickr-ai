// Scheduler — single source of truth for the ws-server's recurring loops.
//
// Every cron-style task (Pyth scan, evaluator, order tracker, thesis monitor,
// signal generator) shares the same shape:
//   - first kickoff some seconds after boot
//   - run on a fixed interval afterwards
//   - skip the next tick if the previous one is still busy
//   - swallow errors so one bad tick doesn't kill the loop
//   - clean teardown on SIGTERM
//
// Before this file each loop hand-rolled all five concerns (~30 lines × 4 = 120
// lines of boilerplate). Now they're a single `register({ name, intervalMs,
// handler })` call.

export interface ScheduledTask {
  name: string;
  intervalMs: number;
  /** First-run delay after boot. Defaults to intervalMs/4 if omitted. */
  kickoffMs?: number;
  /** When true, the task is registered but not started. Used to gate by
   *  DEMO_MODE without scattering `if` checks in the call sites. */
  enabled?: boolean;
  /** Per-tick body. Throwing is fine — the scheduler logs and continues. */
  handler: () => Promise<void>;
}

export interface SchedulerHandle {
  stop: () => void;
}

export function registerTask(task: ScheduledTask): SchedulerHandle {
  if (task.enabled === false) {
    console.log(`[sched] ${task.name} disabled`);
    return { stop: () => {} };
  }

  let busy = false;
  let stopped = false;

  async function tick(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      await task.handler();
    } catch (err) {
      console.warn(`[${task.name}] tick failed`, err);
    } finally {
      busy = false;
    }
  }

  const kickoffMs = task.kickoffMs ?? Math.max(5_000, task.intervalMs / 4);
  const kickoffHandle = setTimeout(() => void tick(), kickoffMs);
  const intervalHandle = setInterval(() => void tick(), task.intervalMs);
  console.log(
    `[sched] ${task.name} every ${formatInterval(task.intervalMs)} (first run in ${formatInterval(kickoffMs)})`,
  );

  return {
    stop: () => {
      stopped = true;
      clearTimeout(kickoffHandle);
      clearInterval(intervalHandle);
    },
  };
}

function formatInterval(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(0)}min`;
  return `${(ms / 1000).toFixed(0)}s`;
}

/** Aggregator so index.ts can stop everything in one call on shutdown. */
export class TaskGroup {
  private tasks: SchedulerHandle[] = [];
  add(handle: SchedulerHandle): void {
    this.tasks.push(handle);
  }
  stopAll(): void {
    for (const h of this.tasks) h.stop();
    this.tasks = [];
  }
}
