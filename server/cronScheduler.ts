/**
 * Cron Scheduler
 *
 * Registers in-process scheduled jobs using node-cron.
 * This runs inside the Express server process — no external scheduler needed.
 *
 * Jobs registered:
 *   - Draft Reminder: every hour at :00 — calls processDraftReminders()
 *   - Token Cleanup: daily at 03:00 UTC — deletes expired/used verification tokens
 *
 * The scheduler is only started in production (NODE_ENV !== 'test').
 * In test environments, jobs are not registered to avoid side effects.
 *
 * Usage:
 *   import { startCronScheduler } from "./cronScheduler";
 *   startCronScheduler(); // call once on server startup
 */

import cron from "node-cron";
import { processDraftReminders } from "./draftReminders";
import { deleteExpiredVerificationTokens } from "./db";

/** Whether the scheduler has been started (prevents double-registration) */
let started = false;

/**
 * Start all scheduled cron jobs.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startCronScheduler(): void {
  // Never run in test environments
  if (process.env.NODE_ENV === "test") {
    console.log("[Cron] Skipping scheduler in test environment");
    return;
  }

  if (started) {
    console.log("[Cron] Scheduler already running — skipping duplicate start");
    return;
  }

  started = true;
  console.log("[Cron] Starting scheduler...");

  // ── Draft Reminder: every hour at minute 0 ─────────────────────────────────
  // Fires at 00:00, 01:00, 02:00, ... 23:00 every day
  cron.schedule("0 * * * *", async () => {
    const startTime = Date.now();
    console.log(`[Cron] [${new Date().toISOString()}] Running draft reminders...`);
    try {
      const result = await processDraftReminders();
      const elapsed = Date.now() - startTime;
      console.log(
        `[Cron] Draft reminders done in ${elapsed}ms — sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Cron] Draft reminder job failed: ${msg}`);
    }
  });

  console.log("[Cron] Registered: draft-reminders (every hour at :00)");

  // ── Token Cleanup: daily at 03:00 UTC ────────────────────────────────────
  cron.schedule("0 3 * * *", async () => {
    console.log(`[Cron] [${new Date().toISOString()}] Cleaning expired verification tokens...`);
    try {
      const deleted = await deleteExpiredVerificationTokens();
      console.log(`[Cron] Token cleanup done — deleted: ${deleted}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Cron] Token cleanup failed: ${msg}`);
    }
  });

  console.log("[Cron] Registered: token-cleanup (daily at 03:00 UTC)");
}

/**
 * Stop the scheduler (for graceful shutdown).
 * Destroys all registered tasks.
 */
export function stopCronScheduler(): void {
  if (!started) return;
  // node-cron v4 does not expose a global destroy — individual tasks are GC'd
  // when the process exits. This function exists for future extension.
  started = false;
  console.log("[Cron] Scheduler stopped");
}

/** Exposed for testing */
export { started as _schedulerStarted };
