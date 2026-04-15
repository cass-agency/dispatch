import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import axios from "axios";
import {
  runPipeline,
  PipelineResult,
  StepCallback,
  TokenCallback,
} from "./pipeline";
import {
  createCheckoutSession,
  getCheckoutSession,
  pay,
  getLocusBalance,
  getLocusTransactions,
} from "./locus";
import { renderHome } from "./ui";
import { getAllAgentModes } from "./agent-keys";
import * as db from "./db";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT ?? 8080;

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const COMMISSION_FEE = "0.50";
const WATCH_PRICE    = "0.05";
const REQUESTER_SHARE_PCT = 0.40;  // 40% of each view → commissioner

const AGENT_WALLETS: Record<string, { emoji: string; label: string; address: string }> = {
  researcher:   { emoji: "🔍", label: "Researcher",   address: "0x99ea943041e186b103a160e843e3e8ef47881c5c" },
  scriptwriter: { emoji: "✍️",  label: "Scriptwriter", address: "0x403760e3f06c126c687722897bf2d661cb8585a8" },
  visual:       { emoji: "🎨", label: "Visual",        address: "0x16ae9ba7ea3cbf57e632d5533ff01645fc901cdd" },
  voice:        { emoji: "🎙️", label: "Voice",         address: "0x8fe8c382e5cbbd590e9eca04cbdf6ae17de89ed5" },
  music:        { emoji: "🎵", label: "Music",         address: "0x053f33a2a7c03f6dd9000c9e1e956e9ea5833563" },
};

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_RPC = "https://mainnet.base.org";
const BASESCAN = "https://basescan.org";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface Commission {
  sessionId: string;        // our local ID — used in URLs & frontend
  locusSessionId: string;   // Locus checkout session ID — used for polling
  topic: string;
  requesterAddress: string;
  checkoutUrl: string;
  status: "pending_payment" | "generating" | "done" | "error" | "refund_needed";
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

interface WatchSession {
  sessionId: string;
  videoFilename: string;
  commissionSessionId: string;
  checkoutUrl: string;
  status: "pending_payment" | "paid" | "error";
  createdAt: string;
  paidAt?: string;
  watchToken?: string;
  revenueSent: boolean;
}

interface VideoRecord {
  filename: string;
  headline: string;
  cost: number;
  payments: PipelineResult["payments"];
  createdAt: string;
  topic: string;
  commissionSessionId?: string;
  requesterAddress?: string;
}

interface JobStep {
  name: string;
  status: "pending" | "running" | "done" | "error";
}

interface JobRecord {
  status: "running" | "done" | "error";
  result?: PipelineResult;
  error?: string;
  topic: string;
  startedAt: string;
  steps: JobStep[];
  logs: string[];
  streamListeners: Response[];
  tokenBuffer: Array<{ agent: string; token: string }>;
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

const STEP_NAMES = ["researcher", "scriptwriter", "visual", "voice", "music", "editor"];

const videoHistory: VideoRecord[] = [];
const jobs        = new Map<string, JobRecord>();
const commissions = new Map<string, Commission>();
const watchSessions = new Map<string, WatchSession>();
const watchTokens = new Map<string, string>(); // token → videoFilename

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getOnChainUSDCBalance(address: string): Promise<number> {
  try {
    const data =
      "0x70a08231" +
      address.toLowerCase().replace("0x", "").padStart(64, "0");
    const resp = await axios.post(
      BASE_RPC,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: USDC_CONTRACT, data }, "latest"],
      },
      { timeout: 10_000 }
    );
    const hex: string = resp.data?.result ?? "0x0";
    return parseInt(hex, 16) / 1_000_000;
  } catch {
    return 0;
  }
}

function closeJobStreams(job: JobRecord, status: string) {
  job.streamListeners.forEach((r) => {
    try {
      r.write(`data: ${JSON.stringify({ type: "done", status })}\n\n`);
      r.end();
    } catch {}
  });
  job.streamListeners = [];
}

// ─────────────────────────────────────────────────────────────
// Pipeline launcher
// ─────────────────────────────────────────────────────────────

function launchPipeline(commission: Commission) {
  const jobId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  commission.jobId = jobId;

  const job: JobRecord = {
    status: "running",
    topic: commission.topic,
    startedAt: new Date().toISOString(),
    steps: STEP_NAMES.map((name) => ({ name, status: "pending" as const })),
    logs: [],
    streamListeners: [],
    tokenBuffer: [],
  };
  jobs.set(jobId, job);

  const ts = () =>
    new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const onStep: StepCallback = (agent, phase, log) => {
    const step = job.steps.find((s) => s.name === agent);
    if (step) step.status = phase === "start" ? "running" : "done";
    job.logs.push(`[${ts()}] ${log}`);
    console.log(`  ↳ [${agent}/${phase}] ${log}`);
    // Broadcast step event so frontend card states update live
    const stepEvent = { type: "step", agent, phase, log };
    job.streamListeners.forEach((r) => {
      try { r.write(`data: ${JSON.stringify(stepEvent)}\n\n`); } catch {}
    });
  };

  const onToken: TokenCallback = (agent, token) => {
    const item = { agent, token };
    job.tokenBuffer.push(item);
    if (job.tokenBuffer.length > 20_000) job.tokenBuffer.shift();
    job.streamListeners.forEach((r) => {
      try {
        r.write(`data: ${JSON.stringify(item)}\n\n`);
      } catch {}
    });
  };

  runPipeline(commission.topic, onStep, onToken)
    .then(async (result) => {
      job.status = "done";
      job.result = result;
      closeJobStreams(job, "done");

      const filename = path.basename(result.videoPath);
      commission.videoFilename = filename;
      commission.headline = result.headline;
      commission.totalCost = result.totalCost;

      // Give commissioner a free watch token
      const token = makeToken();
      commission.watchToken = token;
      watchTokens.set(token, filename);

      // Record to history
      const alreadyRecorded = videoHistory.some((v) => v.filename === filename);
      const createdAt = new Date().toISOString();
      if (!alreadyRecorded) {
        videoHistory.push({
          filename,
          headline: result.headline,
          cost: result.totalCost,
          payments: result.payments,
          createdAt,
          topic: commission.topic,
          commissionSessionId: commission.sessionId,
          requesterAddress: commission.requesterAddress,
        });
        if (videoHistory.length > 50) videoHistory.shift();
      }

      commission.status = "done";

      // ── Persist to Postgres (video bytes + commission state + token) ──
      try {
        if (db.hasDb() && fs.existsSync(result.videoPath)) {
          const bytes = fs.readFileSync(result.videoPath);
          await db.insertVideo(
            {
              filename,
              headline: result.headline,
              topic: commission.topic,
              cost: result.totalCost,
              payments: result.payments,
              commissionSessionId: commission.sessionId,
              requesterAddress: commission.requesterAddress,
              contentLength: bytes.length,
              createdAt,
            },
            bytes
          );
          await db.insertWatchToken(token, filename);
          await db.upsertCommission({ ...commission });
          console.log(`💾 [DB] Video ${filename} persisted (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);
        }
      } catch (e) {
        console.error("[DB] persist failed:", (e as Error).message);
      }

      console.log(
        `✅ [Pipeline] Commission ${commission.sessionId} done — video: ${filename}`
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `❌ [Pipeline] Error for commission ${commission.sessionId}:`,
        message
      );
      job.status = "error";
      job.logs.push(`❌ Pipeline failed: ${message}`);
      closeJobStreams(job, "error");

      if (commission.retryCount < 1) {
        commission.retryCount++;
        console.log(
          `🔄 [Pipeline] Retrying commission ${commission.sessionId} (attempt ${commission.retryCount})...`
        );
        launchPipeline(commission);
      } else {
        commission.status = "refund_needed";
        console.error(
          `💸 [Refund needed] Commission ${commission.sessionId} — refund $${COMMISSION_FEE} to ${commission.payerAddress}`
        );
      }
      db.upsertCommission({ ...commission }).catch(() => {});
    });
}

// ─────────────────────────────────────────────────────────────
// Global checkout poller (runs every 5 s)
// ─────────────────────────────────────────────────────────────

setInterval(async () => {
  // ── Commissions ──
  for (const [, c] of commissions) {
    if (c.status !== "pending_payment") continue;
    try {
      const session = await getCheckoutSession(c.locusSessionId);
      if (session.status === "PAID") {
        console.log(
          `✅ [Poller] Commission ${c.sessionId} PAID — launching pipeline`
        );
        c.paidAt = session.paidAt ?? new Date().toISOString();
        c.payerAddress = session.payerAddress;
        c.paymentTxHash = session.paymentTxHash;
        c.status = "generating";
        db.upsertCommission({ ...c }).catch(() => {});
        launchPipeline(c);
      } else if (session.status === "EXPIRED" || session.status === "CANCELLED") {
        c.status = "error";
        db.upsertCommission({ ...c }).catch(() => {});
      }
    } catch (e) {
      console.error(`[Poller] Commission check error ${c.sessionId}:`, e);
    }
  }

  // ── Watch sessions ──
  for (const [, ws] of watchSessions) {
    if (ws.status !== "pending_payment") continue;
    try {
      const session = await getCheckoutSession(ws.sessionId);
      if (session.status === "PAID") {
        console.log(`✅ [Poller] Watch session ${ws.sessionId} PAID`);
        ws.status = "paid";
        ws.paidAt = session.paidAt ?? new Date().toISOString();

        const token = makeToken();
        ws.watchToken = token;
        watchTokens.set(token, ws.videoFilename);
        db.insertWatchToken(token, ws.videoFilename).catch(() => {});
        db.upsertWatchSession({ ...ws }).catch(() => {});

        // Revenue share → commissioner
        const videoRecord = videoHistory.find(
          (v) => v.filename === ws.videoFilename
        );
        if (videoRecord?.requesterAddress) {
          const shareAmount =
            Math.round(
              parseFloat(WATCH_PRICE) * REQUESTER_SHARE_PCT * 100
            ) / 100; // $0.02
          pay(
            videoRecord.requesterAddress,
            shareAmount,
            `Dispatch view revenue: ${videoRecord.headline ?? ws.videoFilename}`
          )
            .then(() => {
              ws.revenueSent = true;
              db.upsertWatchSession({ ...ws }).catch(() => {});
              console.log(
                `💸 [Revenue] Sent $${shareAmount} to ${videoRecord.requesterAddress}`
              );
            })
            .catch((e) =>
              console.error("[Revenue share] pay/send failed:", e)
            );
        }
      } else if (
        session.status === "EXPIRED" ||
        session.status === "CANCELLED"
      ) {
        ws.status = "error";
        db.upsertWatchSession({ ...ws }).catch(() => {});
      }
    } catch (e) {
      console.error(`[Poller] Watch session check error ${ws.sessionId}:`, e);
    }
  }
}, 5_000);

// ─────────────────────────────────────────────────────────────
// GET /  — main UI
// ─────────────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.send(
    renderHome({
      videoHistory: videoHistory.map((v) => ({
        filename: v.filename,
        headline: v.headline,
        topic: v.topic,
        cost: v.cost,
        createdAt: v.createdAt,
        commissionSessionId: v.commissionSessionId,
      })),
      agentWallets: AGENT_WALLETS,
    })
  );
});

// ─────────────────────────────────────────────────────────────
// POST /commission — create a new commission
// ─────────────────────────────────────────────────────────────

app.post("/commission", async (req: Request, res: Response) => {
  const { topic, requesterAddress } = req.body as {
    topic?: string;
    requesterAddress?: string;
  };

  if (!topic || !requesterAddress) {
    res.status(400).json({ error: "topic and requesterAddress are required" });
    return;
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  try {
    // Generate our local commission ID BEFORE calling Locus so we can embed it in successUrl
    const localId = crypto.randomBytes(8).toString("hex");

    const session = await createCheckoutSession({
      amount: COMMISSION_FEE,
      description: `Dispatch commission: ${topic.slice(0, 80)}`,
      metadata: { topic: topic.slice(0, 200), requesterAddress, localId },
      successUrl: `${baseUrl}/?commissionId=${localId}`,
      cancelUrl: `${baseUrl}/`,
    });

    const commission: Commission = {
      sessionId: localId,           // our local ID (used in URLs)
      locusSessionId: session.id,   // Locus session ID (used for polling)
      topic,
      requesterAddress,
      checkoutUrl: session.checkoutUrl,
      status: "pending_payment",
      createdAt: new Date().toISOString(),
      revenueSent: false,
      retryCount: 0,
    };

    // Indexed by local ID so frontend can GET /commission/:localId
    commissions.set(localId, commission);
    db.upsertCommission({ ...commission }).catch((e) =>
      console.error("[DB] commission upsert failed:", e.message)
    );

    console.log(
      `📋 [Commission] ${localId} — Locus session ${session.id} — topic: "${topic}"`
    );

    res.json({
      sessionId: localId,
      checkoutUrl: session.checkoutUrl,
      expiresAt: session.expiresAt,
      topic,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Commission] Creation failed:", message);
    res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /commission/:sessionId — poll commission status
// ─────────────────────────────────────────────────────────────

app.get("/commission/:sessionId", (req: Request, res: Response) => {
  const commission = commissions.get(req.params.sessionId);
  if (!commission) {
    res.status(404).json({ error: "Commission not found" });
    return;
  }

  const job = commission.jobId ? jobs.get(commission.jobId) : undefined;

  res.json({
    sessionId: req.params.sessionId,
    status: commission.status,
    topic: commission.topic,
    requesterAddress: commission.requesterAddress,
    checkoutUrl: commission.checkoutUrl,
    paidAt: commission.paidAt,
    payerAddress: commission.payerAddress,
    paymentTxHash: commission.paymentTxHash,
    jobId: commission.jobId,
    steps: job?.steps,
    logs: job?.logs?.slice(-20),
    videoFilename: commission.videoFilename,
    watchToken: commission.status === "done" ? commission.watchToken : undefined,
    headline: commission.headline,
    totalCost: commission.totalCost,
    revenueSent: commission.revenueSent,
    retryCount: commission.retryCount,
  });
});

// ─────────────────────────────────────────────────────────────
// POST /videos/:filename/watch — create a pay-to-watch session
// ─────────────────────────────────────────────────────────────

app.post("/videos/:filename/watch", async (req: Request, res: Response) => {
  const { filename } = req.params;
  const { commissionSessionId } = req.body as { commissionSessionId?: string };

  if (!/^[\w\-\.]+\.mp4$/.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const videoRecord = videoHistory.find((v) => v.filename === filename);
  const headline = videoRecord?.headline ?? filename;
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  try {
    const session = await createCheckoutSession({
      amount: WATCH_PRICE,
      description: `Dispatch — Watch: ${headline.slice(0, 80)}`,
      metadata: { filename, commissionSessionId: commissionSessionId ?? "" },
      successUrl: `${baseUrl}/`,   // user returns to homepage; frontend is polling
      cancelUrl: `${baseUrl}/`,
    });

    const watchSession: WatchSession = {
      sessionId: session.id,
      videoFilename: filename,
      commissionSessionId: commissionSessionId ?? "",
      checkoutUrl: session.checkoutUrl,
      status: "pending_payment",
      createdAt: new Date().toISOString(),
      revenueSent: false,
    };
    watchSessions.set(session.id, watchSession);
    db.upsertWatchSession({ ...watchSession }).catch((e) =>
      console.error("[DB] watch session upsert failed:", e.message)
    );

    console.log(
      `🎬 [Watch] Created session ${session.id} for ${filename}`
    );
    res.json({
      sessionId: session.id,
      checkoutUrl: session.checkoutUrl,
      expiresAt: session.expiresAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Watch] Session creation failed:", message);
    res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/watch/:sessionId — poll watch session
// ─────────────────────────────────────────────────────────────

app.get("/api/watch/:sessionId", (req: Request, res: Response) => {
  const ws = watchSessions.get(req.params.sessionId);
  if (!ws) {
    res.status(404).json({ error: "Watch session not found" });
    return;
  }
  const videoRecord = videoHistory.find((v) => v.filename === ws.videoFilename);
  res.json({
    sessionId: ws.sessionId,
    status: ws.status,
    videoFilename: ws.status === "paid" ? ws.videoFilename : undefined,
    watchToken: ws.status === "paid" ? ws.watchToken : undefined,
    headline: videoRecord?.headline,
    cost: videoRecord?.cost,
    paidAt: ws.paidAt,
    revenueSent: ws.revenueSent,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/balance — Dispatch + agent wallet balances
// ─────────────────────────────────────────────────────────────

app.get("/api/balance", async (_req: Request, res: Response) => {
  try {
    const [mainInfo, ...agentBalances] = await Promise.all([
      getLocusBalance(),
      ...Object.values(AGENT_WALLETS).map((w) =>
        getOnChainUSDCBalance(w.address)
      ),
    ]);

    const agents = Object.entries(AGENT_WALLETS).map(([, w], i) => ({
      label: w.label,
      emoji: w.emoji,
      address: w.address,
      balance: agentBalances[i],
    }));

    res.json({
      success: true,
      main: { balance: mainInfo.balance, address: mainInfo.address },
      agents,
      totalAgentEarnings: agents.reduce((s, a) => s + a.balance, 0),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/ledger — transaction history
// ─────────────────────────────────────────────────────────────

app.get("/api/ledger", async (_req: Request, res: Response) => {
  try {
    const transactions = await getLocusTransactions(20);
    res.json({ success: true, transactions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/jobs/:jobId/stream — SSE token stream
// ─────────────────────────────────────────────────────────────

app.get("/api/jobs/:jobId/stream", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // Replay buffered tokens
  job.tokenBuffer.forEach((item) => {
    try { res.write(`data: ${JSON.stringify(item)}\n\n`); } catch {}
  });
  job.streamListeners.push(res);
  req.on("close", () => {
    const idx = job.streamListeners.indexOf(res);
    if (idx > -1) job.streamListeners.splice(idx, 1);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/jobs/:jobId — poll job status
// ─────────────────────────────────────────────────────────────

app.get("/api/jobs/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "running") {
    res.json({
      status: "running",
      topic: job.topic,
      startedAt: job.startedAt,
      steps: job.steps,
      logs: job.logs,
    });
    return;
  }
  if (job.status === "error") {
    res.json({
      status: "error",
      error: job.error,
      topic: job.topic,
      startedAt: job.startedAt,
      steps: job.steps,
      logs: job.logs,
    });
    return;
  }
  const result = job.result!;
  const filename = path.basename(result.videoPath);
  res.json({
    status: "done",
    videoUrl: `/video/${encodeURIComponent(filename)}`,
    cost: result.totalCost,
    payments: result.payments,
    headline: result.headline,
    steps: job.steps,
    logs: job.logs,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /video/:filename — serve video (token checked)
// ─────────────────────────────────────────────────────────────

app.get("/video/:filename", async (req: Request, res: Response) => {
  const { filename } = req.params;
  const { token } = req.query as { token?: string };

  if (!/^[\w\-\.]+\.mp4$/.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  // Validate watch token (memory first, DB fallback)
  if (!token) {
    res.status(403).json({ error: "Valid watch token required" });
    return;
  }
  let tokenOk = watchTokens.get(token) === filename;
  if (!tokenOk && db.hasDb()) {
    try {
      const tokens = await db.listWatchTokens();
      const hit = tokens.find((t) => t.token === token && t.filename === filename);
      if (hit) {
        watchTokens.set(token, filename); // warm cache
        tokenOk = true;
      }
    } catch {}
  }
  if (!tokenOk) {
    res.status(403).json({ error: "Valid watch token required" });
    return;
  }

  const filePath = `/tmp/${filename}`;
  const diskOk = fs.existsSync(filePath);
  const range = req.headers.range;

  // Prefer local disk (faster); fall back to DB-backed MP4
  if (diskOk) {
    const fileSize = fs.statSync(filePath).size;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) { res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end(); return; }
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end(); return;
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Content-Type", "video/mp4");
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(fileSize));
      res.setHeader("Content-Type", "video/mp4");
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // DB-backed serving (after container restart)
  if (!db.hasDb()) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  try {
    const meta = await db.getVideoMeta(filename);
    if (!meta) {
      res.status(404).json({ error: "Video not found" });
      return;
    }
    const fileSize = meta.contentLength;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) { res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end(); return; }
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end(); return;
      }
      const chunk = await db.readVideoRange(filename, start, end);
      if (!chunk) { res.status(404).end(); return; }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(chunk.length));
      res.setHeader("Content-Type", "video/mp4");
      res.end(chunk);
    } else {
      const full = await db.readVideoRange(filename);
      if (!full) { res.status(404).end(); return; }
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(full.length));
      res.setHeader("Content-Type", "video/mp4");
      res.end(full);
    }
  } catch (e) {
    console.error("[video] DB read failed:", (e as Error).message);
    res.status(500).json({ error: "Video read failed" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", version: "0.3.0" });
});

// ─────────────────────────────────────────────────────────────
// GET /api/agent-modes — which agents are autonomous
// ─────────────────────────────────────────────────────────────

app.get("/api/agent-modes", (_req: Request, res: Response) => {
  const modes = getAllAgentModes();
  res.json({
    success: true,
    modes,
    autonomousCount: modes.filter((m) => m.autonomous).length,
    totalCount: modes.length,
  });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

async function bootstrap() {
  // Init DB schema + hydrate in-memory caches so user-facing URLs survive restart
  try {
    await db.initSchema();
    if (db.hasDb()) {
      const [vids, comms, wss, toks] = await Promise.all([
        db.listVideos(50),
        db.listCommissions(),
        db.listWatchSessions(),
        db.listWatchTokens(),
      ]);
      for (const v of vids) {
        videoHistory.push({
          filename: v.filename,
          headline: v.headline,
          topic: v.topic,
          cost: v.cost,
          payments: (v.payments as PipelineResult["payments"]) ?? [],
          createdAt: v.createdAt,
          commissionSessionId: v.commissionSessionId,
          requesterAddress: v.requesterAddress,
        });
      }
      for (const c of comms) {
        commissions.set(c.sessionId, {
          sessionId: c.sessionId,
          locusSessionId: c.locusSessionId,
          topic: c.topic,
          requesterAddress: c.requesterAddress,
          checkoutUrl: c.checkoutUrl,
          status: c.status as Commission["status"],
          createdAt: c.createdAt,
          paidAt: c.paidAt,
          payerAddress: c.payerAddress,
          paymentTxHash: c.paymentTxHash,
          jobId: c.jobId,
          videoFilename: c.videoFilename,
          watchToken: c.watchToken,
          revenueSent: c.revenueSent,
          retryCount: c.retryCount,
          headline: c.headline,
          totalCost: c.totalCost,
        });
      }
      for (const w of wss) {
        watchSessions.set(w.sessionId, {
          sessionId: w.sessionId,
          videoFilename: w.videoFilename,
          commissionSessionId: w.commissionSessionId ?? "",
          checkoutUrl: w.checkoutUrl,
          status: w.status as WatchSession["status"],
          createdAt: w.createdAt,
          paidAt: w.paidAt,
          watchToken: w.watchToken,
          revenueSent: w.revenueSent,
        });
      }
      for (const t of toks) watchTokens.set(t.token, t.filename);
      console.log(
        `💾 [DB] hydrated: ${vids.length} videos · ${comms.length} commissions · ${wss.length} watch sessions · ${toks.length} tokens`
      );
    }
  } catch (e) {
    console.error("[DB] bootstrap failed:", (e as Error).message);
    db.disable("bootstrap connection failed (VPC-locked RDS, expected for local dev)");
  }

  app.listen(PORT, () => {
    console.log(`\n📡 Dispatch server running on http://localhost:${PORT}`);
    console.log(`   LOCUS_API_KEY=${process.env.LOCUS_API_KEY ? "set ✓" : "NOT SET ✗"}`);
    console.log(`   DATABASE_URL=${db.hasDb() ? "set ✓" : "NOT SET ✗"}\n`);
  });
}

bootstrap();

// ─────────────────────────────────────────────────────────────
// HTML helper
// ─────────────────────────────────────────────────────────────

function buildTreasurySkeletonHtml(): string {
  const skeletonStyle =
    'style="background:rgba(0,0,0,0.3);border-radius:4px;color:transparent;animation:blink 2s ease-in-out infinite"';
  let html = `
    <div class="treasury-wallet treasury-main">
      <span class="tw-emoji">💼</span>
      <div class="tw-info">
        <div class="tw-label">Dispatch Main Wallet</div>
        <div class="tw-address" ${skeletonStyle}>loading…</div>
      </div>
      <div class="tw-balance loading">…</div>
    </div>`;
  for (const [, w] of Object.entries(AGENT_WALLETS)) {
    html += `
      <div class="treasury-wallet">
        <span class="tw-emoji">${w.emoji}</span>
        <div class="tw-info">
          <div class="tw-label">${w.label}</div>
          <div class="tw-address">${w.address.slice(0, 6)}…${w.address.slice(-4)}</div>
        </div>
        <div class="tw-balance loading">…</div>
      </div>`;
  }
  return html;
}
