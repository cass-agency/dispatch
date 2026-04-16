// ═══════════════════════════════════════════════════════════════
// Payouts — persistent payment queue via pay_outbox table.
// Every outbound payment (revenue share, refund, seed) goes
// through enqueuePayout → immediate best-effort send → retries
// via 30s reconciler. Never lose a share.
// ═══════════════════════════════════════════════════════════════

import { pay } from "./locus";
import * as db from "./db";

export async function enqueuePayout(row: {
  toAddress: string;
  amount: number;
  memo: string;
  reason: "revenue_share" | "refund" | "seed";
  relatedId?: string;
}): Promise<{ sent: boolean; txHash?: string }> {
  const { id, deduped } = await db.insertOutbox({
    toAddress: row.toAddress,
    amount: row.amount,
    memo: row.memo,
    reason: row.reason,
    relatedId: row.relatedId,
  });

  if (deduped) {
    console.log(`[payouts] deduped: ${row.reason} for ${row.relatedId}`);
    return { sent: false };
  }

  // Best-effort immediate send
  try {
    const result = await pay(row.toAddress, row.amount, row.memo);
    const txHash = (result as Record<string, unknown>)?.tx_hash as string | undefined;
    if (id > 0) await db.updateOutboxSent(id, txHash ?? "immediate");
    console.log(`[payouts] sent $${row.amount.toFixed(3)} → ${row.toAddress.slice(0, 10)}… (${row.reason})`);
    return { sent: true, txHash };
  } catch (e) {
    const msg = (e as Error).message;
    if (id > 0) await db.updateOutboxFailed(id, msg);
    console.error(`[payouts] immediate send failed: ${msg} — queued for retry`);
    return { sent: false };
  }
}

export async function drainOnce(): Promise<{ sent: number; failed: number }> {
  const rows = await db.listOutboxPending(10);
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.id || row.id < 0) continue;
    try {
      const result = await pay(row.toAddress, row.amount, row.memo);
      const txHash = (result as Record<string, unknown>)?.tx_hash as string | undefined;
      await db.updateOutboxSent(row.id, txHash ?? "reconciled");
      sent++;
    } catch (e) {
      await db.updateOutboxFailed(row.id, (e as Error).message);
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[payouts] reconciler: ${sent} sent, ${failed} failed`);
  }
  return { sent, failed };
}

let _reconciler: NodeJS.Timeout | null = null;

export function startReconciler(intervalMs = 30_000): void {
  if (_reconciler) return;
  _reconciler = setInterval(() => {
    drainOnce().catch((e) => console.error("[payouts] reconciler error:", e));
  }, intervalMs);
  console.log(`[payouts] reconciler started (${intervalMs / 1000}s interval)`);
}
