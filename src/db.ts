// ═══════════════════════════════════════════════════════════════
// Dispatch persistence — Postgres
// Stores commissions, watch sessions, watch tokens, and full
// video bytes (bytea). Range-served via SQL SUBSTRING so MP4s
// survive container restarts and scrub correctly.
// ═══════════════════════════════════════════════════════════════

import { Pool } from "pg";

let _pool: Pool | null = null;
let _disabled = false;

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL && !_disabled;
}

/** Circuit-break: disable all DB I/O for the rest of the process. */
export function disable(reason: string): void {
  if (!_disabled) {
    _disabled = true;
    console.warn(`[db] disabled — ${reason}. Running in-memory only.`);
  }
}

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString: url,
    ssl: url.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : undefined,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  _pool.on("error", (err) => console.error("[db] pool error:", err));
  return _pool;
}

// ──────────────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS videos (
  filename              TEXT PRIMARY KEY,
  headline              TEXT NOT NULL,
  topic                 TEXT NOT NULL,
  cost                  NUMERIC NOT NULL,
  payments              JSONB NOT NULL,
  commission_session_id TEXT,
  requester_address     TEXT,
  content_length        INTEGER NOT NULL,
  data                  BYTEA NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commissions (
  session_id            TEXT PRIMARY KEY,
  locus_session_id      TEXT NOT NULL,
  topic                 TEXT NOT NULL,
  requester_address     TEXT NOT NULL,
  checkout_url          TEXT NOT NULL,
  status                TEXT NOT NULL,
  paid_at               TIMESTAMPTZ,
  payer_address         TEXT,
  payment_tx_hash       TEXT,
  job_id                TEXT,
  video_filename        TEXT,
  watch_token           TEXT,
  revenue_sent          BOOLEAN NOT NULL DEFAULT false,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  headline              TEXT,
  total_cost            NUMERIC,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commissions_locus_idx ON commissions (locus_session_id);

CREATE TABLE IF NOT EXISTS watch_sessions (
  session_id            TEXT PRIMARY KEY,
  video_filename        TEXT NOT NULL,
  commission_session_id TEXT,
  checkout_url          TEXT NOT NULL,
  status                TEXT NOT NULL,
  paid_at               TIMESTAMPTZ,
  watch_token           TEXT,
  revenue_sent          BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watch_tokens (
  token                 TEXT PRIMARY KEY,
  video_filename        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Idempotent migrations — run on every boot so tables made by an older schema
// gain any columns we've since added. (CREATE TABLE IF NOT EXISTS doesn't ADD
// columns to pre-existing tables.) Exhaustive: covers every column we SELECT
// or INSERT anywhere, with sane defaults so pre-existing rows stay valid.
const MIGRATIONS_SQL = `
-- videos
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS headline              TEXT NOT NULL DEFAULT '';
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS topic                 TEXT NOT NULL DEFAULT '';
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS cost                  NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS payments              JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS commission_session_id TEXT;
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS requester_address     TEXT;
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS content_length        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS data                  BYTEA;
ALTER TABLE videos          ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ NOT NULL DEFAULT now();

-- commissions
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS locus_session_id      TEXT NOT NULL DEFAULT '';
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS topic                 TEXT NOT NULL DEFAULT '';
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS requester_address     TEXT NOT NULL DEFAULT '';
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS checkout_url          TEXT NOT NULL DEFAULT '';
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS status                TEXT NOT NULL DEFAULT 'pending_payment';
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS paid_at               TIMESTAMPTZ;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS payer_address         TEXT;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS payment_tx_hash       TEXT;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS job_id                TEXT;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS video_filename        TEXT;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS watch_token           TEXT;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS revenue_sent          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS retry_count           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS headline              TEXT;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS total_cost            NUMERIC;
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE commissions     ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS commissions_locus_idx ON commissions (locus_session_id);

-- watch_sessions
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS video_filename        TEXT NOT NULL DEFAULT '';
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS commission_session_id TEXT;
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS checkout_url          TEXT NOT NULL DEFAULT '';
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS status                TEXT NOT NULL DEFAULT 'pending_payment';
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS paid_at               TIMESTAMPTZ;
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS watch_token           TEXT;
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS revenue_sent          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE watch_sessions  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT now();

-- watch_tokens
ALTER TABLE watch_tokens    ADD COLUMN IF NOT EXISTS video_filename        TEXT NOT NULL DEFAULT '';
ALTER TABLE watch_tokens    ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ NOT NULL DEFAULT now();
`;

export async function initSchema(): Promise<void> {
  if (!hasDb()) {
    console.warn("[db] DATABASE_URL not set — persistence disabled (in-memory only)");
    return;
  }
  const pool = getPool();
  await pool.query(SCHEMA_SQL);
  await pool.query(MIGRATIONS_SQL);
  console.log("[db] schema ready (migrations applied)");
}

// ──────────────────────────────────────────────────────────────
// Videos — bytes + metadata
// ──────────────────────────────────────────────────────────────

export interface VideoRow {
  filename: string;
  headline: string;
  topic: string;
  cost: number;
  payments: unknown;
  commissionSessionId?: string;
  requesterAddress?: string;
  contentLength: number;
  createdAt: string;
}

export async function insertVideo(v: VideoRow, data: Buffer): Promise<void> {
  if (!hasDb()) return;
  await getPool().query(
    `INSERT INTO videos
      (filename, headline, topic, cost, payments, commission_session_id, requester_address, content_length, data)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     ON CONFLICT (filename) DO NOTHING`,
    [
      v.filename,
      v.headline,
      v.topic,
      v.cost,
      JSON.stringify(v.payments ?? []),
      v.commissionSessionId ?? null,
      v.requesterAddress ?? null,
      v.contentLength,
      data,
    ]
  );
}

export async function listVideos(limit = 50): Promise<VideoRow[]> {
  if (!hasDb()) return [];
  const r = await getPool().query(
    `SELECT filename, headline, topic, cost::float8 AS cost, payments,
            commission_session_id, requester_address, content_length, created_at
     FROM videos
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  return r.rows.map((row) => ({
    filename: row.filename,
    headline: row.headline,
    topic: row.topic,
    cost: Number(row.cost),
    payments: row.payments,
    commissionSessionId: row.commission_session_id ?? undefined,
    requesterAddress: row.requester_address ?? undefined,
    contentLength: row.content_length,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

export async function getVideoMeta(filename: string): Promise<{ contentLength: number } | null> {
  if (!hasDb()) return null;
  const r = await getPool().query(
    `SELECT content_length FROM videos WHERE filename = $1`,
    [filename]
  );
  if (r.rowCount === 0) return null;
  return { contentLength: r.rows[0].content_length };
}

/**
 * Reads a byte range from the video's bytea column.
 * Uses Postgres SUBSTRING — 1-indexed, length in bytes.
 * Returns Buffer for the [start, end] inclusive range (or full body if start/end undefined).
 */
export async function readVideoRange(
  filename: string,
  start?: number,
  end?: number
): Promise<Buffer | null> {
  if (!hasDb()) return null;
  const pool = getPool();
  let sql: string;
  let params: unknown[];
  if (start !== undefined && end !== undefined) {
    sql = `SELECT SUBSTRING(data FROM $1 FOR $2) AS chunk FROM videos WHERE filename = $3`;
    params = [start + 1, end - start + 1, filename];
  } else {
    sql = `SELECT data AS chunk FROM videos WHERE filename = $1`;
    params = [filename];
  }
  const r = await pool.query(sql, params);
  if (r.rowCount === 0) return null;
  return r.rows[0].chunk as Buffer;
}

// ──────────────────────────────────────────────────────────────
// Commissions
// ──────────────────────────────────────────────────────────────

export interface CommissionRow {
  sessionId: string;
  locusSessionId: string;
  topic: string;
  requesterAddress: string;
  checkoutUrl: string;
  status: string;
  createdAt: string;
  paidAt?: string;
  payerAddress?: string;
  paymentTxHash?: string;
  jobId?: string;
  videoFilename?: string;
  watchToken?: string;
  revenueSent: boolean;
  retryCount: number;
  headline?: string;
  totalCost?: number;
}

export async function upsertCommission(c: CommissionRow): Promise<void> {
  if (!hasDb()) return;
  await getPool().query(
    `INSERT INTO commissions
      (session_id, locus_session_id, topic, requester_address, checkout_url, status,
       paid_at, payer_address, payment_tx_hash, job_id, video_filename, watch_token,
       revenue_sent, retry_count, headline, total_cost, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, COALESCE($17::timestamptz, now()), now())
     ON CONFLICT (session_id) DO UPDATE SET
       status          = EXCLUDED.status,
       paid_at         = EXCLUDED.paid_at,
       payer_address   = EXCLUDED.payer_address,
       payment_tx_hash = EXCLUDED.payment_tx_hash,
       job_id          = EXCLUDED.job_id,
       video_filename  = EXCLUDED.video_filename,
       watch_token     = EXCLUDED.watch_token,
       revenue_sent    = EXCLUDED.revenue_sent,
       retry_count     = EXCLUDED.retry_count,
       headline        = EXCLUDED.headline,
       total_cost      = EXCLUDED.total_cost,
       updated_at      = now()`,
    [
      c.sessionId, c.locusSessionId, c.topic, c.requesterAddress, c.checkoutUrl, c.status,
      c.paidAt ?? null, c.payerAddress ?? null, c.paymentTxHash ?? null, c.jobId ?? null,
      c.videoFilename ?? null, c.watchToken ?? null, c.revenueSent, c.retryCount,
      c.headline ?? null, c.totalCost ?? null, c.createdAt,
    ]
  );
}

export async function listCommissions(): Promise<CommissionRow[]> {
  if (!hasDb()) return [];
  const r = await getPool().query(
    `SELECT session_id, locus_session_id, topic, requester_address, checkout_url, status,
            paid_at, payer_address, payment_tx_hash, job_id, video_filename, watch_token,
            revenue_sent, retry_count, headline, total_cost::float8 AS total_cost, created_at
     FROM commissions ORDER BY created_at ASC`
  );
  return r.rows.map((row) => ({
    sessionId: row.session_id,
    locusSessionId: row.locus_session_id,
    topic: row.topic,
    requesterAddress: row.requester_address,
    checkoutUrl: row.checkout_url,
    status: row.status,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : undefined,
    payerAddress: row.payer_address ?? undefined,
    paymentTxHash: row.payment_tx_hash ?? undefined,
    jobId: row.job_id ?? undefined,
    videoFilename: row.video_filename ?? undefined,
    watchToken: row.watch_token ?? undefined,
    revenueSent: !!row.revenue_sent,
    retryCount: Number(row.retry_count ?? 0),
    headline: row.headline ?? undefined,
    totalCost: row.total_cost !== null ? Number(row.total_cost) : undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

// ──────────────────────────────────────────────────────────────
// Watch sessions
// ──────────────────────────────────────────────────────────────

export interface WatchSessionRow {
  sessionId: string;
  videoFilename: string;
  commissionSessionId?: string;
  checkoutUrl: string;
  status: string;
  createdAt: string;
  paidAt?: string;
  watchToken?: string;
  revenueSent: boolean;
}

export async function upsertWatchSession(w: WatchSessionRow): Promise<void> {
  if (!hasDb()) return;
  await getPool().query(
    `INSERT INTO watch_sessions
      (session_id, video_filename, commission_session_id, checkout_url, status,
       paid_at, watch_token, revenue_sent, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, now()), now())
     ON CONFLICT (session_id) DO UPDATE SET
       status       = EXCLUDED.status,
       paid_at      = EXCLUDED.paid_at,
       watch_token  = EXCLUDED.watch_token,
       revenue_sent = EXCLUDED.revenue_sent,
       updated_at   = now()`,
    [
      w.sessionId, w.videoFilename, w.commissionSessionId ?? null, w.checkoutUrl,
      w.status, w.paidAt ?? null, w.watchToken ?? null, w.revenueSent, w.createdAt,
    ]
  );
}

export async function listWatchSessions(): Promise<WatchSessionRow[]> {
  if (!hasDb()) return [];
  const r = await getPool().query(
    `SELECT session_id, video_filename, commission_session_id, checkout_url, status,
            paid_at, watch_token, revenue_sent, created_at
     FROM watch_sessions ORDER BY created_at ASC`
  );
  return r.rows.map((row) => ({
    sessionId: row.session_id,
    videoFilename: row.video_filename,
    commissionSessionId: row.commission_session_id ?? undefined,
    checkoutUrl: row.checkout_url,
    status: row.status,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : undefined,
    watchToken: row.watch_token ?? undefined,
    revenueSent: !!row.revenue_sent,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

// ──────────────────────────────────────────────────────────────
// Watch tokens
// ──────────────────────────────────────────────────────────────

export async function insertWatchToken(token: string, filename: string): Promise<void> {
  if (!hasDb()) return;
  await getPool().query(
    `INSERT INTO watch_tokens (token, video_filename) VALUES ($1, $2)
     ON CONFLICT (token) DO NOTHING`,
    [token, filename]
  );
}

export async function listWatchTokens(): Promise<Array<{ token: string; filename: string }>> {
  if (!hasDb()) return [];
  const r = await getPool().query(`SELECT token, video_filename FROM watch_tokens`);
  return r.rows.map((row) => ({ token: row.token, filename: row.video_filename }));
}
