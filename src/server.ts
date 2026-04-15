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
  researcher:   { emoji: "🔍", label: "Researcher",   address: "0xA865aEA68e7f6B611a69c34669e349C0aAe1FDF5" },
  scriptwriter: { emoji: "✍️",  label: "Scriptwriter", address: "0xA86e854Ef4cac10676E1c6f0f90e091b4b3f1598" },
  visual:       { emoji: "🎨", label: "Visual",        address: "0xF46F05E04e6e34621DF881B486AbE45eA3010617" },
  voice:        { emoji: "🎙️", label: "Voice",         address: "0x51fF2E55eF9687aCcC97b8dDa2983859104e56c8" },
  music:        { emoji: "🎵", label: "Music",         address: "0x60Be80b931836e60651B3Cb7800D5cAA7CE10a50" },
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
    .then((result) => {
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
      if (!alreadyRecorded) {
        videoHistory.push({
          filename,
          headline: result.headline,
          cost: result.totalCost,
          payments: result.payments,
          createdAt: new Date().toISOString(),
          topic: commission.topic,
          commissionSessionId: commission.sessionId,
          requesterAddress: commission.requesterAddress,
        });
        if (videoHistory.length > 10) videoHistory.shift();
      }

      commission.status = "done";
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
        launchPipeline(c);
      } else if (session.status === "EXPIRED" || session.status === "CANCELLED") {
        c.status = "error";
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
  // Ticker
  const tickerItems =
    videoHistory.length > 0
      ? videoHistory
          .map(
            (v) =>
              `<span><span class="ticker-label">DISPATCH</span>${escHtml(v.headline)}</span>`
          )
          .join(" &nbsp;·&nbsp; ")
      : `<span><span class="ticker-label">DISPATCH</span>Autonomous AI news generation — powered by Locus</span>
         <span><span class="ticker-label">LIVE</span>Six AI agents · Research → Script → Visuals → Voice → Music → Edit</span>
         <span><span class="ticker-label">ECONOMY</span>Agents earn real USDC · Commission a video · Earn from every view</span>`;

  // History rows
  const historyRows = [...videoHistory]
    .reverse()
    .map(
      (v) => `
      <tr>
        <td style="color:#94a3b8">${v.createdAt.replace("T", " ").slice(0, 19)}</td>
        <td style="font-weight:600">${escHtml(v.headline)}</td>
        <td style="color:#94a3b8">${escHtml(v.topic)}</td>
        <td style="color:#22c55e;font-family:monospace">$${v.cost.toFixed(4)}</td>
        <td>
          <button onclick="watchVideo('${escHtml(v.filename)}','${escHtml(v.commissionSessionId ?? '')}')"
                  class="watch-btn">▶ Watch — $0.05</button>
        </td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dispatch — Autonomous AI News Network</title>
  <style>
    :root {
      --bg: #06060f;
      --surface: #0e0e1c;
      --surface2: #12122a;
      --border: #1e1e3a;
      --blue: #3b82f6;
      --blue-dim: rgba(59,130,246,0.15);
      --blue-glow: rgba(59,130,246,0.3);
      --green: #22c55e;
      --green-dim: rgba(34,197,94,0.12);
      --red: #ef4444;
      --amber: #f59e0b;
      --text: #e2e8f0;
      --muted: #64748b;
      --accent: #60a5fa;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }

    /* ── Header ── */
    header {
      background: linear-gradient(180deg, #0c0c22 0%, #08081a 100%);
      border-bottom: 1px solid var(--border);
      padding: 0 40px; height: 68px;
      display: flex; align-items: center; gap: 20px;
      position: sticky; top: 0; z-index: 100;
    }
    .on-air { display:flex;align-items:center;gap:6px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:4px;padding:5px 10px;font-size:0.65rem;font-weight:800;color:#ef4444;letter-spacing:0.15em;text-transform:uppercase;flex-shrink:0; }
    .on-air-dot { width:7px;height:7px;border-radius:50%;background:#ef4444;animation:blink 1.4s ease-in-out infinite; }
    .logo { font-size:1.45rem;font-weight:900;letter-spacing:-0.5px;color:#fff; }
    .tagline { font-size:0.7rem;color:var(--muted);margin-top:2px;letter-spacing:0.04em;text-transform:uppercase; }
    .header-balance {
      margin-left: auto; display:flex;align-items:center;gap:16px;
    }
    .wallet-pill {
      display:flex;align-items:center;gap:6px;
      background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);
      border-radius:20px;padding:5px 12px;font-size:0.72rem;color:#4ade80;
    }
    .wallet-pill span { color:var(--muted); }
    .locus-pill { background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.25);border-radius:20px;padding:4px 12px;font-size:0.7rem;color:#60a5fa;letter-spacing:0.04em; }

    /* ── Ticker ── */
    .ticker { background:#080816;border-bottom:1px solid var(--border);height:34px;overflow:hidden;display:flex;align-items:center; }
    .ticker-inner { overflow:hidden;flex:1; }
    .ticker-track { display:inline-flex;gap:60px;white-space:nowrap;padding:0 40px;font-size:0.72rem;color:#94a3b8;animation:ticker-scroll 40s linear infinite; }
    .ticker-label { display:inline-block;background:rgba(59,130,246,0.12);color:#60a5fa;font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;padding:1px 6px;border-radius:2px;margin-right:6px;vertical-align:middle; }

    /* ── Layout ── */
    .container { max-width: 1200px; margin: 0 auto; padding: 40px 24px; }
    .section-label { font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);margin-bottom:16px; }

    /* ── Commission Card ── */
    .commission-card {
      background: linear-gradient(135deg, rgba(59,130,246,0.06) 0%, var(--surface) 100%);
      border: 1px solid var(--border); border-radius: 16px; padding: 32px;
      margin-bottom: 32px;
    }
    .commission-title {
      font-size:1.1rem;font-weight:800;letter-spacing:-0.3px;margin-bottom:4px;
    }
    .commission-subtitle { font-size:0.8rem;color:var(--muted);margin-bottom:28px; }

    .commission-fields { display:grid;gap:16px;margin-bottom:24px; }
    .field-label { font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:6px; }
    .field-note { font-weight:400;text-transform:none;color:#4ade80; }
    input[type=text] {
      width:100%;background:#080814;border:1px solid var(--border);
      border-radius:8px;padding:12px 14px;font-size:0.9rem;color:var(--text);
      outline:none;transition:border-color 0.15s;font-family:inherit;
    }
    input[type=text]:focus { border-color:rgba(59,130,246,0.5); }
    input[type=text]::placeholder { color:#334155; }

    .commission-breakdown {
      display:grid;grid-template-columns:1fr 1fr;gap:8px;
      background:rgba(0,0,0,0.25);border-radius:10px;padding:16px;margin-bottom:24px;
    }
    .cb-item { display:flex;flex-direction:column;gap:2px; }
    .cb-label { font-size:0.65rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted); }
    .cb-value { font-size:0.95rem;font-weight:700;color:var(--text); }
    .cb-value.highlight { color:#4ade80; }

    .commission-btn {
      width:100%;padding:14px 20px;
      background:linear-gradient(135deg,#2563eb,#1d4ed8);
      border:none;border-radius:10px;
      color:#fff;font-size:0.95rem;font-weight:700;
      cursor:pointer;transition:opacity 0.15s,transform 0.1s;
      letter-spacing:-0.2px;
    }
    .commission-btn:hover:not(:disabled) { opacity:0.9;transform:translateY(-1px); }
    .commission-btn:disabled { opacity:0.5;cursor:not-allowed;transform:none; }

    /* ── Pending payment state ── */
    .payment-pending {
      text-align:center;padding:8px 0;
    }
    .pending-badge {
      display:inline-block;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);
      color:#f59e0b;font-size:0.65rem;font-weight:800;letter-spacing:0.12em;
      text-transform:uppercase;padding:4px 10px;border-radius:4px;margin-bottom:16px;
    }
    .pending-topic { font-size:1.1rem;font-weight:700;margin-bottom:20px; }
    .checkout-btn {
      display:inline-flex;align-items:center;gap:8px;
      background:linear-gradient(135deg,#16a34a,#15803d);
      color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;
      font-size:0.95rem;font-weight:700;margin-bottom:16px;
      transition:opacity 0.15s;
    }
    .checkout-btn:hover { opacity:0.9; }
    .pending-note { font-size:0.8rem;color:var(--muted);margin-bottom:12px; }
    .pending-status-msg { font-size:0.78rem;color:#60a5fa;min-height:20px; }
    .paid-badge {
      display:inline-flex;align-items:center;gap:6px;
      background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);
      color:#4ade80;padding:4px 10px;border-radius:4px;font-size:0.7rem;font-weight:700;
    }
    .tx-link { font-size:0.72rem;color:#60a5fa;text-decoration:none;margin-left:8px; }
    .tx-link:hover { text-decoration:underline; }

    /* ── Refund needed state ── */
    .refund-banner {
      background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);
      border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:12px;
    }
    .refund-icon { font-size:1.4rem; }
    .refund-text { flex:1; }
    .refund-title { font-weight:700;color:#ef4444;margin-bottom:4px; }
    .refund-sub { font-size:0.8rem;color:var(--muted); }

    /* ── Treasury panel ── */
    .treasury-panel {
      background:var(--surface);border:1px solid var(--border);border-radius:16px;
      padding:24px;margin-bottom:32px;
    }
    .treasury-header { display:flex;align-items:center;gap:12px;margin-bottom:20px; }
    .treasury-title { font-size:0.9rem;font-weight:800;letter-spacing:-0.2px; }
    .treasury-refresh { font-size:0.7rem;color:var(--muted);margin-left:auto;cursor:pointer;text-decoration:underline; }
    .treasury-grid { display:grid;grid-template-columns:1fr 1fr;gap:12px; }
    .treasury-wallet {
      display:flex;align-items:center;gap:10px;
      background:rgba(0,0,0,0.2);border:1px solid var(--border);
      border-radius:8px;padding:12px 14px;
    }
    .tw-emoji { font-size:1.1rem;flex-shrink:0; }
    .tw-info { flex:1;min-width:0; }
    .tw-label { font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--muted);margin-bottom:2px; }
    .tw-address { font-size:0.65rem;color:#475569;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .tw-balance { font-size:0.95rem;font-weight:700;color:#4ade80;flex-shrink:0; }
    .tw-balance.loading { color:var(--muted); }
    .treasury-main {
      grid-column:1/-1;
      background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.2);
    }

    /* ── Agent pipeline ── */
    .pipeline-section {
      background:var(--surface);border:1px solid var(--border);border-radius:16px;
      padding:28px;margin-bottom:32px;
    }
    .pipeline-header { display:flex;align-items:center;gap:16px;margin-bottom:24px; }
    .pipeline-live-badge {
      display:flex;align-items:center;gap:6px;
      background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);
      color:#ef4444;font-size:0.65rem;font-weight:800;letter-spacing:0.12em;
      text-transform:uppercase;padding:4px 10px;border-radius:4px;
    }
    .pipeline-title { font-size:1rem;font-weight:700; }
    .pipeline-topic-tag { font-size:0.78rem;color:var(--muted);margin-left:auto;font-style:italic; }
    .agents-row { display:flex;align-items:center;gap:0;margin-bottom:20px;overflow-x:auto;padding-bottom:4px; }
    .agent-card {
      display:flex;flex-direction:column;align-items:center;gap:6px;
      background:var(--surface2);border:1px solid var(--border);
      border-radius:12px;padding:14px 16px;min-width:100px;flex-shrink:0;
      transition:border-color 0.3s,background 0.3s;position:relative;
    }
    .agent-card.running { border-color:rgba(245,158,11,0.6);background:rgba(245,158,11,0.05); }
    .agent-card.done    { border-color:rgba(34,197,94,0.5);background:rgba(34,197,94,0.04); }
    .agent-card.error   { border-color:rgba(239,68,68,0.5); }
    .status-dot { width:6px;height:6px;border-radius:50%;background:#1e293b;position:absolute;top:8px;right:8px;transition:background 0.3s; }
    .agent-card.running .status-dot { background:#f59e0b;animation:blink 1s ease-in-out infinite; }
    .agent-card.done    .status-dot { background:#22c55e; }
    .agent-icon { font-size:1.4rem; }
    .agent-name { font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em; }
    .agent-wallet { font-size:0.58rem;color:#334155;font-family:monospace; }
    .agent-earn { font-size:0.7rem;font-weight:600; }
    .agent-earn.zero { color:#334155; }
    .agent-earn:not(.zero) { color:#4ade80; }
    .agent-role { font-size:0.62rem;color:var(--muted);text-align:center; }
    .pipeline-connector { width:24px;height:2px;background:var(--border);flex-shrink:0;transition:background 0.3s; }
    .pipeline-connector.active { background:#22c55e; }

    /* ── Terminal ── */
    #log-terminal {
      background:#020209;border:1px solid #0f0f1e;border-radius:12px;overflow:hidden;
      display:none;margin-top:20px;
    }
    .terminal-bar {
      background:#0a0a18;border-bottom:1px solid #0f0f1e;
      padding:10px 16px;display:flex;align-items:center;gap:8px;
    }
    .term-dots { display:flex;gap:5px; }
    .term-dot { width:10px;height:10px;border-radius:50%; }
    .td-r{background:#ff5f56}.td-y{background:#ffbd2e}.td-g{background:#27c93f}
    .term-title { font-size:0.72rem;color:#475569;flex:1;text-align:center;font-family:monospace; }
    .term-timer { font-size:0.68rem;color:#334155;font-family:monospace; }
    .terminal-body { padding:12px 16px;min-height:80px;max-height:300px;overflow-y:auto;font-size:0.75rem;font-family:'Menlo','Monaco','Courier New',monospace; }
    .log-line { padding:1px 0;line-height:1.5; }
    .log-line.dim { color:#334155; }
    .log-line.err { color:#ef4444; }
    .stream-agent { color:#64748b;margin-right:4px; }

    /* ── Video section ── */
    .video-section { margin-bottom:32px; }
    .video-wrapper {
      background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;
    }
    .video-header { padding:20px 24px 16px;border-bottom:1px solid var(--border); }
    .now-playing-badge {
      display:inline-flex;align-items:center;gap:6px;
      background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);
      color:#ef4444;font-size:0.62rem;font-weight:800;letter-spacing:0.1em;
      text-transform:uppercase;padding:3px 8px;border-radius:4px;margin-bottom:10px;
    }
    .video-headline { font-size:1.15rem;font-weight:800;line-height:1.3;margin-bottom:6px; }
    .video-meta { font-size:0.75rem;color:var(--muted); }
    video { width:100%;display:block;background:#000; }
    .payment-breakdown {
      padding:16px 24px;border-top:1px solid var(--border);
      display:flex;align-items:center;gap:12px;flex-wrap:wrap;
    }
    .breakdown-label { font-size:0.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-right:4px; }
    .payment-item { display:flex;align-items:center;gap:6px; }
    .payment-agent { font-size:0.7rem;color:var(--muted); }
    .payment-amount { font-size:0.75rem;font-weight:700;color:#4ade80;font-family:monospace; }
    .payment-addr { font-size:0.62rem;color:#334155;font-family:monospace; }

    /* ── Pay-to-watch gate ── */
    .watch-gate {
      background:var(--surface);border:1px solid var(--border);border-radius:16px;
      padding:48px 32px;text-align:center;margin-bottom:32px;
    }
    .watch-gate-icon { font-size:2.5rem;margin-bottom:16px; }
    .watch-gate-headline { font-size:1.1rem;font-weight:800;margin-bottom:8px; }
    .watch-gate-meta { font-size:0.82rem;color:var(--muted);margin-bottom:24px; }
    .watch-btn-big {
      display:inline-flex;align-items:center;gap:8px;
      background:linear-gradient(135deg,#16a34a,#15803d);
      color:#fff;border:none;padding:14px 28px;border-radius:10px;
      font-size:0.95rem;font-weight:700;cursor:pointer;transition:opacity 0.15s;
    }
    .watch-btn-big:hover { opacity:0.9; }
    .watch-pending-msg { font-size:0.8rem;color:#60a5fa;margin-top:16px;min-height:20px; }

    /* ── History ── */
    .history-section { margin-bottom:32px; }
    .table-wrapper { overflow-x:auto; }
    table { width:100%;border-collapse:collapse;font-size:0.82rem; }
    th,td { padding:12px 16px;text-align:left;border-bottom:1px solid var(--border); }
    th { color:var(--muted);font-size:0.65rem;text-transform:uppercase;letter-spacing:0.08em;font-weight:700; }
    tr:hover td { background:rgba(255,255,255,0.02); }
    .watch-btn {
      background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);
      color:#60a5fa;padding:5px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;
      font-family:inherit;transition:background 0.15s;
    }
    .watch-btn:hover { background:rgba(59,130,246,0.2); }

    /* ── Footer ── */
    footer { border-top:1px solid var(--border);padding:24px 40px;font-size:0.75rem;color:var(--muted);text-align:center; }

    /* ── Animations ── */
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
    @keyframes ticker-scroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
    @keyframes spin { to{transform:rotate(360deg)} }
    .spin { animation:spin 1s linear infinite;display:inline-block; }
  </style>
</head>
<body>

<header>
  <div class="on-air"><div class="on-air-dot"></div>ON AIR</div>
  <div>
    <div class="logo">DISPATCH</div>
    <div class="tagline">Autonomous AI News Network</div>
  </div>
  <div class="header-balance">
    <div class="wallet-pill" id="header-balance">
      <span>Treasury</span> <strong id="header-bal-val">…</strong>
    </div>
    <div class="locus-pill">Powered by Locus</div>
  </div>
</header>

<div class="ticker">
  <div class="ticker-inner">
    <div class="ticker-track">
      ${tickerItems} &nbsp;·&nbsp; ${tickerItems}
    </div>
  </div>
</div>

<div class="container">

  <!-- ═══ COMMISSION SECTION ═══ -->
  <div class="section-label">Commission a Broadcast</div>
  <div class="commission-card" id="commission-card">

    <!-- Form state -->
    <div id="form-state">
      <div class="commission-title">Commission an AI-generated news broadcast</div>
      <div class="commission-subtitle">
        Six autonomous agents research, write, visualise, narrate, compose, and edit your video — all on-chain.
        You earn 40% of every view.
      </div>

      <div class="commission-fields">
        <div>
          <div class="field-label">Topic</div>
          <input type="text" id="topicInput" placeholder="e.g. AI agents reshaping global finance" />
        </div>
        <div>
          <div class="field-label">Your Locus wallet address <span class="field-note">— to receive 40% of view revenue</span></div>
          <input type="text" id="walletInput" placeholder="0x…" />
        </div>
      </div>

      <div class="commission-breakdown">
        <div class="cb-item">
          <div class="cb-label">Commission fee</div>
          <div class="cb-value">$0.50 USDC</div>
        </div>
        <div class="cb-item">
          <div class="cb-label">Agent payouts</div>
          <div class="cb-value">~$0.33 USDC</div>
        </div>
        <div class="cb-item">
          <div class="cb-label">Your revenue share</div>
          <div class="cb-value highlight">$0.02 / view (40%)</div>
        </div>
        <div class="cb-item">
          <div class="cb-label">Break-even</div>
          <div class="cb-value">25 views</div>
        </div>
      </div>

      <button class="commission-btn" id="commissionBtn" onclick="submitCommission()">
        💳 Pay &amp; Commission — Opens Locus Checkout
      </button>
    </div>

    <!-- Pending payment state -->
    <div id="pending-state" style="display:none">
      <div class="payment-pending">
        <div class="pending-badge">💳 Awaiting Payment</div>
        <div class="pending-topic" id="pending-topic-label"></div>
        <div style="margin-bottom:16px">
          <a id="checkout-link" href="#" target="_blank" class="checkout-btn">
            🔗 Open Locus Checkout — $0.50 USDC
          </a>
        </div>
        <div class="pending-note">Payment processed by Locus on Base. Return to this tab after paying — we'll detect it automatically.</div>
        <div class="pending-status-msg" id="pending-status-msg">Checking for payment…</div>
      </div>
    </div>

    <!-- Refund-needed state -->
    <div id="refund-state" style="display:none">
      <div class="refund-banner">
        <div class="refund-icon">⚠️</div>
        <div class="refund-text">
          <div class="refund-title">Pipeline failed — manual refund required</div>
          <div class="refund-sub" id="refund-details">Contact support to receive your $0.50 refund.</div>
        </div>
      </div>
    </div>

  </div><!-- /commission-card -->

  <!-- ═══ TREASURY PANEL ═══ -->
  <div class="section-label">Dispatch Treasury</div>
  <div class="treasury-panel" id="treasury-panel">
    <div class="treasury-header">
      <span style="font-size:1.1rem">💼</span>
      <div class="treasury-title">Live Agent Wallet Balances</div>
      <div class="treasury-refresh" onclick="loadBalances()">↻ Refresh</div>
    </div>
    <div class="treasury-grid" id="treasury-grid">
      ${buildTreasurySkeletonHtml()}
    </div>
  </div>

  <!-- ═══ PIPELINE SECTION ═══ -->
  <section class="pipeline-section" id="pipeline-section" style="display:none">
    <div class="pipeline-header">
      <div class="pipeline-live-badge"><div class="on-air-dot"></div> LIVE</div>
      <div class="pipeline-title">Agent Collaboration</div>
      <div class="pipeline-topic-tag" id="pipeline-topic-label"></div>
    </div>

    <div class="agents-row">
      <div class="agent-card pending" data-agent="researcher">
        <div class="status-dot"></div>
        <span class="agent-icon">🔍</span>
        <div class="agent-name">Researcher</div>
        <div class="agent-wallet">0xA865…FDF5</div>
        <div class="agent-earn zero">$0.00</div>
        <div class="agent-role">Tavily Search</div>
      </div>
      <div class="pipeline-connector"></div>
      <div class="agent-card pending" data-agent="scriptwriter">
        <div class="status-dot"></div>
        <span class="agent-icon">✍️</span>
        <div class="agent-name">Scriptwriter</div>
        <div class="agent-wallet">0xA86e…1598</div>
        <div class="agent-earn">earns $0.02</div>
        <div class="agent-role">Claude Haiku</div>
      </div>
      <div class="pipeline-connector"></div>
      <div class="agent-card pending" data-agent="visual">
        <div class="status-dot"></div>
        <span class="agent-icon">🎨</span>
        <div class="agent-name">Visual</div>
        <div class="agent-wallet">0xF46F…0617</div>
        <div class="agent-earn">earns $0.12</div>
        <div class="agent-role">fal.ai Flux</div>
      </div>
      <div class="pipeline-connector"></div>
      <div class="agent-card pending" data-agent="voice">
        <div class="status-dot"></div>
        <span class="agent-icon">🎙️</span>
        <div class="agent-name">Voice</div>
        <div class="agent-wallet">0x51fF…56c8</div>
        <div class="agent-earn">earns $0.04</div>
        <div class="agent-role">Deepgram TTS</div>
      </div>
      <div class="pipeline-connector"></div>
      <div class="agent-card pending" data-agent="music">
        <div class="status-dot"></div>
        <span class="agent-icon">🎵</span>
        <div class="agent-name">Music</div>
        <div class="agent-wallet">0x60Be…0a50</div>
        <div class="agent-earn">earns $0.15</div>
        <div class="agent-role">Suno AI</div>
      </div>
      <div class="pipeline-connector"></div>
      <div class="agent-card pending" data-agent="editor">
        <div class="status-dot"></div>
        <span class="agent-icon">🎬</span>
        <div class="agent-name">Editor</div>
        <div class="agent-wallet" style="color:#1e293b">on-chain assembly</div>
        <div class="agent-earn zero">free</div>
        <div class="agent-role">FFmpeg + Ken Burns</div>
      </div>
    </div>

    <div id="log-terminal">
      <div class="terminal-bar">
        <div class="term-dots">
          <div class="term-dot td-r"></div>
          <div class="term-dot td-y"></div>
          <div class="term-dot td-g"></div>
        </div>
        <span class="term-title">Pipeline Log</span>
        <span class="term-timer" id="elapsed-timer">0s elapsed</span>
      </div>
      <div class="terminal-body" id="terminal-body"></div>
    </div>
  </section>

  <!-- ═══ VIDEO SECTION ═══ -->
  <section class="video-section" id="video-section" style="display:none">
    <div class="section-label" style="margin-bottom:16px">Latest Broadcast</div>

    <!-- Watch gate (shown until paid) -->
    <div class="watch-gate" id="watch-gate">
      <div class="watch-gate-icon">🔒</div>
      <div class="watch-gate-headline" id="wg-headline">Broadcast ready</div>
      <div class="watch-gate-meta" id="wg-meta">Commission this video to watch free, or pay to view</div>
      <button class="watch-btn-big" id="wg-btn" onclick="watchCurrentVideo()">
        ▶ Watch — $0.05 USDC
      </button>
      <div class="watch-pending-msg" id="watch-pending-msg"></div>
    </div>

    <!-- Video player (shown after paid/commissioner) -->
    <div id="video-wrapper" style="display:none">
      <div class="video-wrapper">
        <div class="video-header">
          <div class="now-playing-badge">Latest Broadcast</div>
          <div class="video-headline" id="video-headline-text"></div>
          <div class="video-meta" id="video-meta-text"></div>
        </div>
        <video id="main-video" controls autoplay></video>
        <div class="payment-breakdown" id="payment-breakdown"></div>
      </div>
    </div>
  </section>

  <!-- ═══ HISTORY ═══ -->
  ${videoHistory.length > 1 ? `
  <section class="history-section">
    <div class="section-label" style="margin-bottom:16px">All Broadcasts (${videoHistory.length})</div>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Time</th><th>Headline</th><th>Topic</th><th>Cost (USDC)</th><th>Watch</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  </section>` : ""}

</div><!-- /container -->

<footer>
  Dispatch — Autonomous AI News Video Network &nbsp;·&nbsp;
  Built on <strong style="color:#60a5fa">Locus</strong> &nbsp;·&nbsp;
  Agents earn real USDC · Commissioners earn 40% of views &nbsp;·&nbsp; Hackathon 2026
</footer>

<script>
  // ── State ──
  let currentCommissionId  = null;
  let currentWatchFilename = null;
  let currentWatchCommId   = null;
  let currentWatchSessionId = null;
  let commissionPollTimer  = null;
  let watchPollTimer       = null;
  let sseConn              = null;
  let startTime            = null;
  let timerInterval        = null;

  const agentEmoji = { researcher:'🔍', scriptwriter:'✍️', visual:'🎨', voice:'🎙️', music:'🎵', editor:'🎬' };

  // ── Init ──
  window.addEventListener('DOMContentLoaded', () => {
    loadBalances();
    setInterval(loadBalances, 30_000);

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('commissionId');
    if (sessionId) {
      currentCommissionId = sessionId;
      showPendingState('Checking commission status…', '');
      startCommissionPoll(sessionId);
    }
  });

  // ── Treasury ──
  async function loadBalances() {
    try {
      const resp = await fetch('/api/balance');
      const data = await resp.json();
      if (!data.success) return;
      const { main, agents } = data;

      // Header
      document.getElementById('header-bal-val').textContent = '$' + main.balance.toFixed(2);

      // Grid
      const grid = document.getElementById('treasury-grid');
      let html = \`
        <div class="treasury-wallet treasury-main">
          <span class="tw-emoji">💼</span>
          <div class="tw-info">
            <div class="tw-label">Dispatch Main Wallet</div>
            <div class="tw-address"><a href="https://basescan.org/address/\${main.address}" target="_blank" style="color:#334155;text-decoration:none">\${main.address}</a></div>
          </div>
          <div class="tw-balance">$\${main.balance.toFixed(2)}</div>
        </div>
      \`;
      for (const a of agents) {
        html += \`
          <div class="treasury-wallet">
            <span class="tw-emoji">\${a.emoji}</span>
            <div class="tw-info">
              <div class="tw-label">\${a.label}</div>
              <div class="tw-address"><a href="https://basescan.org/address/\${a.address}" target="_blank" style="color:#334155;text-decoration:none">\${a.address.slice(0,6)}…\${a.address.slice(-4)}</a></div>
            </div>
            <div class="tw-balance \${a.balance < 0.01 ? 'loading' : ''}">$\${a.balance.toFixed(2)}</div>
          </div>
        \`;
      }
      grid.innerHTML = html;
    } catch(e) {
      console.error('Balance load failed:', e);
    }
  }

  // ── Commission flow ──
  async function submitCommission() {
    const topic  = document.getElementById('topicInput').value.trim();
    const wallet = document.getElementById('walletInput').value.trim();
    const btn    = document.getElementById('commissionBtn');

    if (!topic)  { alert('Please enter a topic'); return; }
    if (!wallet || !wallet.startsWith('0x') || wallet.length < 20) {
      alert('Please enter a valid Locus wallet address (starts with 0x)');
      return;
    }

    btn.disabled    = true;
    btn.textContent = '⏳ Creating checkout session…';

    try {
      const resp = await fetch('/commission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, requesterAddress: wallet })
      });
      const data = await resp.json();
      if (!data.sessionId) throw new Error(data.error || 'Commission creation failed');

      currentCommissionId = data.sessionId;

      // Update URL so page refresh resumes polling
      history.replaceState(null, '', '/?commissionId=' + data.sessionId);

      showPendingState(topic, data.checkoutUrl);
      window.open(data.checkoutUrl, '_blank');
      startCommissionPoll(data.sessionId);
    } catch(e) {
      alert('Error: ' + e.message);
      btn.disabled    = false;
      btn.textContent = '💳 Pay & Commission — Opens Locus Checkout';
    }
  }

  function showPendingState(topic, checkoutUrl) {
    document.getElementById('form-state').style.display    = 'none';
    document.getElementById('refund-state').style.display  = 'none';
    document.getElementById('pending-state').style.display = 'block';
    document.getElementById('pending-topic-label').textContent = '"' + topic + '"';
    if (checkoutUrl) document.getElementById('checkout-link').href = checkoutUrl;
    document.getElementById('pending-status-msg').textContent = 'Waiting for Locus payment confirmation…';
  }

  function startCommissionPoll(sessionId) {
    if (commissionPollTimer) clearInterval(commissionPollTimer);
    commissionPollTimer = setInterval(async () => {
      try {
        const resp = await fetch('/commission/' + sessionId);
        const data = await resp.json();
        handleCommissionStatus(data);
      } catch(e) {}
    }, 3000);
  }

  function handleCommissionStatus(data) {
    if (data.status === 'pending_payment') {
      document.getElementById('pending-status-msg').textContent = '🔄 Checking Locus checkout…';
    } else if (data.status === 'generating') {
      const msg = document.getElementById('pending-status-msg');
      if (msg) {
        msg.innerHTML = '<span class="paid-badge">✅ Payment confirmed</span>'
          + (data.paymentTxHash
            ? \` <a class="tx-link" href="https://basescan.org/tx/\${data.paymentTxHash}" target="_blank">view tx ↗</a>\`
            : '');
      }
      // Show pipeline after brief delay
      setTimeout(() => {
        document.getElementById('pending-state').style.display = 'none';
        showPipelineSection(data.topic, data.jobId);
      }, 800);
    } else if (data.status === 'done') {
      clearInterval(commissionPollTimer);
      if (sseConn) { sseConn.close(); sseConn = null; }
      clearInterval(timerInterval);
      document.getElementById('pipeline-section').style.display = 'none';
      showCommissionerVideo(data);
    } else if (data.status === 'refund_needed') {
      clearInterval(commissionPollTimer);
      document.getElementById('pending-state').style.display = 'none';
      document.getElementById('refund-state').style.display  = 'block';
      document.getElementById('refund-details').textContent  =
        'Pipeline failed twice. Contact us for a $0.50 refund. Session: ' + data.sessionId;
    }
  }

  // ── Pipeline visualization ──
  function showPipelineSection(topic, jobId) {
    document.getElementById('pipeline-section').style.display = 'block';
    document.getElementById('pipeline-topic-label').textContent = '"' + topic + '"';
    document.querySelectorAll('.agent-card').forEach(c => c.className = 'agent-card pending');
    document.querySelectorAll('.pipeline-connector').forEach(c => c.classList.remove('active'));
    const terminal = document.getElementById('log-terminal');
    const termBody = document.getElementById('terminal-body');
    terminal.style.display = 'block';
    termBody.innerHTML = '';
    addLog('🚀 Pipeline started — topic: "' + topic + '"', 'dim');

    startTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();

    if (jobId) startStreaming(jobId);
  }

  function startStreaming(jobId) {
    if (sseConn) { sseConn.close(); sseConn = null; }
    const termBody = document.getElementById('terminal-body');
    const agentLines = {};

    const es = new EventSource('/api/jobs/' + jobId + '/stream');
    sseConn = es;

    es.onmessage = function(evt) {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'done') { es.close(); sseConn = null; return; }
        if (data.type === 'step') {
          const { agent, phase } = data;
          const card = document.querySelector('[data-agent="' + agent + '"]');
          if (card) {
            card.className = 'agent-card ' + (phase === 'start' ? 'running' : 'done');
            // Activate connector before this agent
            const connectors = document.querySelectorAll('.pipeline-connector');
            const cards = document.querySelectorAll('.agent-card');
            const idx = Array.from(cards).indexOf(card);
            if (idx > 0 && phase === 'done') connectors[idx - 1]?.classList.add('active');
          }
          return;
        }
        const { agent, token } = data;
        if (!agent || token === undefined) return;

        if (token.includes('\\n') && agentLines[agent]) { delete agentLines[agent]; return; }
        if (!agentLines[agent]) {
          const row = document.createElement('div');
          row.className = 'log-line';
          row.innerHTML = '<span class="stream-agent">' + (agentEmoji[agent] || '🤖') + ' [' + agent + ']</span> <span class="stext" style="color:#4ade80"></span>';
          termBody.appendChild(row);
          agentLines[agent] = row.querySelector('.stext');
        }
        agentLines[agent].textContent += token;
        termBody.scrollTop = termBody.scrollHeight;
      } catch(e) {}
    };
    es.onerror = function() { es.close(); sseConn = null; };
  }

  function addLog(msg, cls) {
    const body = document.getElementById('terminal-body');
    if (!body) return;
    const div = document.createElement('div');
    div.className = 'log-line' + (cls ? ' ' + cls : '');
    const ts = new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
    div.textContent = '[' + ts + '] ' + msg;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function updateTimer() {
    const el = document.getElementById('elapsed-timer');
    if (!el || !startTime) return;
    const s = Math.floor((Date.now() - startTime) / 1000);
    el.textContent = s < 60 ? s + 's elapsed' : Math.floor(s/60) + 'm ' + (s%60) + 's elapsed';
  }

  // ── Video display ──
  function showCommissionerVideo(data) {
    currentWatchFilename = data.videoFilename;
    currentWatchCommId   = data.sessionId;

    const section = document.getElementById('video-section');
    section.style.display = 'block';

    // Commissioner gets free access
    if (data.watchToken) {
      playVideo(data.videoFilename, data.watchToken, data.headline, data.totalCost, data.payments);
    } else {
      // Show gate
      document.getElementById('watch-gate').style.display   = 'block';
      document.getElementById('video-wrapper').style.display = 'none';
      document.getElementById('wg-headline').textContent    = data.headline || 'Broadcast ready';
      document.getElementById('wg-meta').textContent        = 'Commission fee paid · Watch free or share the link';
      document.getElementById('wg-btn').textContent         = '▶ Watch — $0.05 USDC';
    }
    section.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function playVideo(filename, token, headline, cost, payments) {
    document.getElementById('watch-gate').style.display    = 'none';
    document.getElementById('video-wrapper').style.display = 'block';
    const vid = document.getElementById('main-video');
    vid.src = '/video/' + encodeURIComponent(filename) + '?token=' + token;
    document.getElementById('video-headline-text').textContent = headline || '';
    document.getElementById('video-meta-text').textContent = cost ? '$' + cost.toFixed(4) + ' USDC agent cost' : '';
    if (payments && payments.length) {
      const bp = document.getElementById('payment-breakdown');
      bp.innerHTML = '<span class="breakdown-label">Agent payments →</span>'
        + payments.filter(p => p.amount > 0).map(p =>
            '<div class="payment-item">'
            + '<span class="payment-agent">' + p.agent + '</span>'
            + '<span class="payment-amount">+$' + p.amount.toFixed(2) + '</span>'
            + '<span class="payment-addr">' + p.address.slice(0,6) + '…' + p.address.slice(-4) + '</span>'
            + '</div>'
          ).join('');
    }
  }

  // ── Pay-to-watch ──
  function watchCurrentVideo() {
    if (currentWatchFilename) watchVideo(currentWatchFilename, currentWatchCommId);
  }

  async function watchVideo(filename, commissionSessionId) {
    currentWatchFilename = filename;
    currentWatchCommId   = commissionSessionId;

    document.getElementById('video-section').style.display = 'block';
    document.getElementById('watch-gate').style.display    = 'block';
    document.getElementById('video-wrapper').style.display = 'none';

    const btn = document.getElementById('wg-btn');
    btn.disabled    = true;
    btn.textContent = '⏳ Creating checkout…';

    try {
      const resp = await fetch('/videos/' + encodeURIComponent(filename) + '/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commissionSessionId })
      });
      const data = await resp.json();
      if (!data.sessionId) throw new Error(data.error || 'Watch session creation failed');

      currentWatchSessionId = data.sessionId;
      window.open(data.checkoutUrl, '_blank');

      document.getElementById('watch-pending-msg').textContent = 'Complete $0.05 payment on Locus, then return here…';
      btn.textContent = '🔗 Reopen Checkout';
      btn.disabled    = false;
      btn.onclick     = function() { window.open(data.checkoutUrl, '_blank'); };

      startWatchPoll(data.sessionId, filename);
    } catch(e) {
      btn.disabled    = false;
      btn.textContent = '▶ Watch — $0.05 USDC';
      alert('Error: ' + e.message);
    }
  }

  function startWatchPoll(sessionId, filename) {
    if (watchPollTimer) clearInterval(watchPollTimer);
    watchPollTimer = setInterval(async () => {
      try {
        const resp = await fetch('/api/watch/' + sessionId);
        const data = await resp.json();
        if (data.status === 'paid' && data.watchToken) {
          clearInterval(watchPollTimer);
          document.getElementById('watch-pending-msg').textContent = '✅ Payment confirmed!';
          // Find video info from history if available
          setTimeout(() => playVideo(filename, data.watchToken, data.headline, data.cost, null), 500);
        } else if (data.status === 'error') {
          clearInterval(watchPollTimer);
          document.getElementById('watch-pending-msg').textContent = '❌ Payment failed or expired.';
          document.getElementById('wg-btn').textContent = '▶ Watch — $0.05 USDC';
          document.getElementById('wg-btn').onclick = function() { watchCurrentVideo(); };
        }
      } catch(e) {}
    }, 3000);
  }

  function escHtmlJs(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
</script>
</body>
</html>`;

  res.send(html);
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

app.get("/video/:filename", (req: Request, res: Response) => {
  const { filename } = req.params;
  const { token } = req.query as { token?: string };

  if (!/^[\w\-\.]+\.mp4$/.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  // Validate watch token
  if (!token || watchTokens.get(token) !== filename) {
    res.status(403).json({ error: "Valid watch token required" });
    return;
  }

  const filePath = `/tmp/${filename}`;
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.sendFile(filePath);
});

// ─────────────────────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", version: "0.3.0" });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n📡 Dispatch server running on http://localhost:${PORT}`);
  console.log(`   LOCUS_API_KEY=${process.env.LOCUS_API_KEY ? "set ✓" : "NOT SET ✗"}\n`);
});

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
