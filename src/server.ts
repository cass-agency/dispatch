import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import axios from "axios";
import { runPipeline, PipelineResult } from "./pipeline";
import { pay } from "./locus";

dotenv.config();

// ============================================================
// Dispatch Express Server — port 8080
// ============================================================

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 8080;

// Marketplace constants
const DISPATCH_WALLET = "0x70e04a5576a6065923c081de413feb34cbe1bedf";
const REQUEST_FEE = 0.50;   // USDC charged to requester to commission a video
const VIEW_PRICE = 0.05;    // USDC charged to viewer per watch
const REQUESTER_SHARE = 0.40; // 40% of view revenue goes to requester

interface VideoRecord {
  filename: string;
  headline: string;
  cost: number;
  payments: PipelineResult["payments"];
  createdAt: string;
  topic: string;
  requesterAddress?: string;
  viewPrice: number;
  viewCount: number;
  totalRevenue: number;
}

// In-memory store — last 20 videos (array for history, Map for O(1) id lookup)
const videoHistory: VideoRecord[] = [];
const videoById = new Map<string, VideoRecord>();

// In-memory jobs map
const jobs = new Map<
  string,
  {
    status: "running" | "done" | "error";
    result?: PipelineResult;
    error?: string;
    topic: string;
    startedAt: string;
  }
>();

// ────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", version: "0.2.0" });
});

app.get("/", (_req: Request, res: Response) => {
  const latest = videoHistory[videoHistory.length - 1];

  const historyRows = [...videoHistory]
    .reverse()
    .map(
      (v) => `
      <tr>
        <td>${v.createdAt}</td>
        <td>${escHtml(v.headline)}</td>
        <td>${escHtml(v.topic)}</td>
        <td>$${v.cost.toFixed(4)}</td>
        <td>${v.viewCount}</td>
        <td>$${(v.totalRevenue).toFixed(4)}</td>
        <td><a href="/video/${encodeURIComponent(v.filename)}" target="_blank">&#9654; Watch ($${VIEW_PRICE.toFixed(2)})</a></td>
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }
    header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-bottom: 1px solid #2d3748; padding: 24px 40px; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.5px; color: #fff; }
    header .badge { background: #3182ce; color: #fff; font-size: 0.65rem; padding: 2px 8px; border-radius: 9999px; font-weight: 700; text-transform: uppercase; }
    .container { max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
    .hero { background: linear-gradient(135deg, #1e3a5f 0%, #1a1a2e 100%); border: 1px solid #2d3748; border-radius: 16px; padding: 32px; margin-bottom: 32px; }
    .hero h2 { font-size: 1.25rem; color: #90cdf4; margin-bottom: 8px; }
    .hero .headline { font-size: 1.6rem; font-weight: 700; line-height: 1.3; margin-bottom: 16px; }
    .hero .meta { font-size: 0.85rem; color: #718096; }
    .marketplace-box { background: linear-gradient(135deg, #1a2e1a 0%, #1a1a2e 100%); border: 1px solid #2d4a2d; border-radius: 16px; padding: 28px 32px; margin-bottom: 32px; }
    .marketplace-box h2 { font-size: 1.15rem; color: #68d391; margin-bottom: 12px; }
    .marketplace-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 16px; }
    .marketplace-card { background: #1a1a2e; border: 1px solid #2d3748; border-radius: 10px; padding: 18px; }
    .marketplace-card h3 { font-size: 0.95rem; color: #f6e05e; margin-bottom: 8px; }
    .marketplace-card p { font-size: 0.82rem; color: #a0aec0; line-height: 1.5; }
    .marketplace-card .amount { font-size: 1.1rem; font-weight: 700; color: #68d391; margin-top: 8px; }
    .generate-form { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .generate-form input { flex: 1; min-width: 260px; background: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 8px; padding: 12px 16px; font-size: 1rem; outline: none; }
    .generate-form input:focus { border-color: #3182ce; }
    .generate-form button { background: #3182ce; color: #fff; border: none; border-radius: 8px; padding: 12px 28px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .generate-form button:hover { background: #2b6cb0; }
    .generate-form button:disabled { background: #4a5568; cursor: not-allowed; }
    .request-form { background: #1a1a2e; border: 1px solid #2d3748; border-radius: 10px; padding: 20px; margin-bottom: 32px; }
    .request-form h3 { color: #90cdf4; margin-bottom: 14px; font-size: 1rem; }
    .request-form .field { margin-bottom: 12px; }
    .request-form label { display: block; font-size: 0.8rem; color: #a0aec0; margin-bottom: 4px; }
    .request-form input { width: 100%; background: #0f0f1a; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 6px; padding: 10px 14px; font-size: 0.9rem; outline: none; }
    .request-form input:focus { border-color: #68d391; }
    .request-form button { background: #276749; color: #fff; border: none; border-radius: 8px; padding: 10px 24px; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
    .request-form button:hover { background: #2f855a; }
    .pipeline-steps { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 40px; }
    .step { background: #1a1a2e; border: 1px solid #2d3748; border-radius: 10px; padding: 16px; text-align: center; }
    .step .icon { font-size: 1.8rem; margin-bottom: 8px; }
    .step .label { font-size: 0.8rem; color: #a0aec0; }
    .step .cost { font-size: 0.75rem; color: #68d391; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #1a1a2e; border: 1px solid #2d3748; border-radius: 10px; overflow: hidden; }
    thead { background: #16213e; }
    th, td { padding: 12px 16px; text-align: left; font-size: 0.875rem; border-bottom: 1px solid #2d3748; }
    th { color: #90cdf4; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
    tr:last-child td { border-bottom: none; }
    a { color: #63b3ed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    #status { background: #1a2035; border: 1px solid #2d3748; border-radius: 10px; padding: 20px; margin-top: 20px; font-family: monospace; font-size: 0.875rem; color: #68d391; white-space: pre-wrap; max-height: 220px; overflow-y: auto; display: none; }
    #reqStatus { background: #1a2035; border: 1px solid #2d3748; border-radius: 10px; padding: 16px; margin-top: 12px; font-family: monospace; font-size: 0.85rem; color: #68d391; white-space: pre-wrap; display: none; }
    .section-title { font-size: 1.1rem; font-weight: 700; color: #90cdf4; margin-bottom: 16px; }
  </style>
</head>
<body>
<header>
  <div>
    <h1>&#128225; Dispatch</h1>
    <p style="color:#718096;font-size:0.85rem;margin-top:4px;">Autonomous AI News Video Network — powered by Locus</p>
  </div>
  <span class="badge">Live</span>
</header>
<div class="container">
  ${
    latest
      ? `<div class="hero">
    <h2>Latest Broadcast</h2>
    <div class="headline">${escHtml(latest.headline)}</div>
    <div class="meta">Topic: ${escHtml(latest.topic)} &nbsp;&middot;&nbsp; Cost: $${latest.cost.toFixed(4)} USDC &nbsp;&middot;&nbsp; ${latest.createdAt}</div>
    <div style="margin-top:16px;"><a href="/video/${encodeURIComponent(latest.filename)}">&#9654; Watch Video</a></div>
  </div>`
      : `<div class="hero"><h2>No videos yet</h2><p style="color:#718096;margin-top:8px;">Commission your first AI news video below.</p></div>`
  }

  <div class="marketplace-box">
    <h2>&#127916; Dispatch Marketplace</h2>
    <p style="color:#a0aec0;font-size:0.9rem;line-height:1.6;">Dispatch is a pay-to-request, pay-to-watch AI news video marketplace. Commission a video on any topic and earn 40% of every view it receives — forever. Viewers pay a small USDC fee to watch, and revenue flows directly on-chain via Locus agent payments.</p>
    <div class="marketplace-grid">
      <div class="marketplace-card">
        <h3>&#128176; Commission a Video</h3>
        <p>Submit any news topic and a $${REQUEST_FEE.toFixed(2)} USDC request fee. Dispatch's AI pipeline (researcher, scriptwriter, visual, voice, music agents) produces a broadcast-ready video.</p>
        <div class="amount">$${REQUEST_FEE.toFixed(2)} USDC to commission</div>
      </div>
      <div class="marketplace-card">
        <h3>&#127757; Earn Revenue Share</h3>
        <p>As the video's requester, you earn <strong>40%</strong> of every $${VIEW_PRICE.toFixed(2)} USDC view fee — automatically paid to your wallet via Locus each time someone watches your video.</p>
        <div class="amount">40% of $${VIEW_PRICE.toFixed(2)}/view = $${(VIEW_PRICE * REQUESTER_SHARE).toFixed(3)}/view</div>
      </div>
      <div class="marketplace-card">
        <h3>&#128250; Pay to Watch</h3>
        <p>Access any video in the archive for just $${VIEW_PRICE.toFixed(2)} USDC. Your payment is split: 40% to the requester who commissioned it, 60% to Dispatch to fund ongoing agent infrastructure.</p>
        <div class="amount">$${VIEW_PRICE.toFixed(2)} USDC per view</div>
      </div>
    </div>
  </div>

  <div class="section-title">Commission a New Video</div>
  <div class="request-form">
    <h3>Request a topic — pay $${REQUEST_FEE.toFixed(2)} USDC, earn revenue share</h3>
    <div class="field">
      <label>Topic</label>
      <input id="reqTopic" type="text" placeholder="e.g. AI agent economy breakthroughs" value="AI agent economy breakthroughs" />
    </div>
    <div class="field">
      <label>Your Wallet Address (receives 40% of view revenue)</label>
      <input id="reqAddress" type="text" placeholder="0x..." />
    </div>
    <div class="field">
      <label>Your Locus API Key (used to charge $${REQUEST_FEE.toFixed(2)} commission fee)</label>
      <input id="reqApiKey" type="password" placeholder="locus_..." />
    </div>
    <button onclick="requestVideo()">&#128176; Pay & Commission ($${REQUEST_FEE.toFixed(2)} USDC)</button>
    <div id="reqStatus"></div>
  </div>

  <div class="section-title">Quick Generate (no fee)</div>
  <div class="generate-form">
    <input id="topicInput" type="text" placeholder="Topic (e.g. AI agent economy breakthroughs)" value="AI agent economy breakthroughs" />
    <button id="generateBtn" onclick="generate()">&#128640; Generate</button>
  </div>
  <div id="status"></div>

  <div class="section-title" style="margin-top:40px;">Pipeline Agents</div>
  <div class="pipeline-steps">
    <div class="step"><div class="icon">&#128205;</div><div class="label">Researcher</div><div class="cost">$0.09</div></div>
    <div class="step"><div class="icon">&#9998;&#65039;</div><div class="label">Scriptwriter</div><div class="cost">$0.01</div></div>
    <div class="step"><div class="icon">&#127912;</div><div class="label">Visual</div><div class="cost">$0.08</div></div>
    <div class="step"><div class="icon">&#127916;</div><div class="label">Editor</div><div class="cost">$0.00</div></div>
    <div class="step"><div class="icon">&#127897;&#65039;</div><div class="label">Voice</div><div class="cost">$0.02</div></div>
    <div class="step"><div class="icon">&#127925;</div><div class="label">Music</div><div class="cost">$0.10</div></div>
  </div>

  ${
    videoHistory.length > 0
      ? `<div class="section-title">Video Archive</div>
  <table>
    <thead><tr><th>Created</th><th>Headline</th><th>Topic</th><th>Cost</th><th>Views</th><th>Revenue</th><th>Watch</th></tr></thead>
    <tbody>${historyRows}</tbody>
  </table>`
      : ""
  }
</div>
<script>
async function requestVideo() {
  const topic = document.getElementById('reqTopic').value || 'AI agent economy breakthroughs';
  const requesterAddress = document.getElementById('reqAddress').value.trim();
  const locusApiKey = document.getElementById('reqApiKey').value.trim();
  const statusEl = document.getElementById('reqStatus');
  statusEl.style.display = 'block';
  if (!requesterAddress) { statusEl.textContent = 'Please enter your wallet address.'; return; }
  if (!locusApiKey) { statusEl.textContent = 'Please enter your Locus API key.'; return; }
  statusEl.textContent = 'Charging commission fee...';
  try {
    const res = await fetch('/request', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ topic, requesterAddress, locusApiKey })
    });
    const data = await res.json();
    if (data.error) { statusEl.textContent = 'Error: ' + data.error; return; }
    statusEl.textContent = 'Commission paid! Job started: ' + data.jobId + '\nProcessing';
    const jobId = data.jobId;
    const poll = async () => {
      const pollRes = await fetch('/api/jobs/' + jobId);
      const job = await pollRes.json();
      if (job.status === 'running') { statusEl.textContent += '.'; setTimeout(poll, 3000); }
      else if (job.status === 'done') {
        statusEl.textContent += '\n\nDone! ' + job.headline + '\nVideo: ' + job.videoUrl;
        setTimeout(() => location.reload(), 2000);
      } else { statusEl.textContent += '\nError: ' + job.error; }
    };
    setTimeout(poll, 3000);
  } catch(e) { statusEl.textContent = 'Network error: ' + e.message; }
}

async function generate() {
  const btn = document.getElementById('generateBtn');
  const statusEl = document.getElementById('status');
  const topic = document.getElementById('topicInput').value || 'AI agent economy breakthroughs';
  btn.disabled = true;
  btn.textContent = 'Starting...';
  statusEl.style.display = 'block';
  statusEl.textContent = 'Submitting job...\n';
  try {
    const res = await fetch('/generate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({topic})
    });
    const data = await res.json();
    if (data.error) {
      statusEl.textContent += '\nError: ' + data.error;
      btn.disabled = false; btn.textContent = 'Generate'; return;
    }
    const jobId = data.jobId;
    statusEl.textContent += 'Job started: ' + jobId + '\nProcessing';
    btn.textContent = 'Generating...';
    const poll = async () => {
      try {
        const pollRes = await fetch('/api/jobs/' + jobId);
        const job = await pollRes.json();
        if (job.status === 'running') { statusEl.textContent += '.'; setTimeout(poll, 3000); }
        else if (job.status === 'done') {
          statusEl.textContent += '\n\nDone! Headline: ' + job.headline;
          statusEl.textContent += '\nCost: $' + job.cost.toFixed(4) + ' USDC';
          if (job.videoUrl) statusEl.textContent += '\nVideo: ' + job.videoUrl;
          btn.disabled = false; btn.textContent = 'Generate';
          setTimeout(() => location.reload(), 2000);
        } else {
          statusEl.textContent += '\nError: ' + job.error;
          btn.disabled = false; btn.textContent = 'Generate';
        }
      } catch(e) { statusEl.textContent += '\nPoll error: ' + e.message; btn.disabled = false; btn.textContent = 'Generate'; }
    };
    setTimeout(poll, 3000);
  } catch(e) {
    statusEl.textContent += '\nNetwork error: ' + e.message;
    btn.disabled = false; btn.textContent = 'Generate';
  }
}
</script>
</body>
</html>`;

  res.send(html);
});

// ── POST /request — pay to commission a video ────────────────
app.post("/request", async (req: Request, res: Response) => {
  const { topic, requesterAddress, locusApiKey } = req.body ?? {};
  if (!topic) { res.status(400).json({ error: "topic is required" }); return; }
  if (!requesterAddress) { res.status(400).json({ error: "requesterAddress is required" }); return; }
  if (!locusApiKey) { res.status(400).json({ error: "locusApiKey is required" }); return; }

  // Charge REQUEST_FEE from requester to Dispatch wallet using their API key
  try {
    await pay(DISPATCH_WALLET, REQUEST_FEE, `Dispatch commission: ${topic}`, locusApiKey);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Server] Commission fee payment failed: ${msg}`);
    res.status(402).json({ error: `Commission payment failed: ${msg}` });
    return;
  }

  const jobId = Date.now().toString(36);
  const startedAt = new Date().toISOString();
  console.log(`\n[Server] POST /request — topic: "${topic}" requester: ${requesterAddress} jobId: ${jobId}`);

  jobs.set(jobId, { status: "running", topic, startedAt });

  runPipeline(topic, { requesterAddress })
    .then((result) => {
      jobs.set(jobId, { status: "done", result, topic, startedAt });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Server] Pipeline error for job ${jobId}:`, message);
      jobs.set(jobId, { status: "error", error: message, topic, startedAt });
    });

  res.json({ jobId, status: "running", fee: REQUEST_FEE });
});

// ── GET /videos — list all generated videos ──────────────────
app.get("/videos", (_req: Request, res: Response) => {
  const list = [...videoHistory].reverse().map((v) => ({
    id: v.filename.replace(/\.mp4$/, ""),
    filename: v.filename,
    headline: v.headline,
    topic: v.topic,
    cost: v.cost,
    createdAt: v.createdAt,
    requesterAddress: v.requesterAddress ?? null,
    viewPrice: v.viewPrice,
    viewCount: v.viewCount,
    totalRevenue: v.totalRevenue,
    videoUrl: `/video/${encodeURIComponent(v.filename)}`,
  }));
  res.json({ videos: list });
});

// ── POST /videos/:id/watch — pay to watch, revenue share ─────
app.post("/videos/:id/watch", async (req: Request, res: Response) => {
  const videoId = req.params.id;
  const { locusApiKey } = req.body ?? {};
  if (!locusApiKey) { res.status(400).json({ error: "locusApiKey is required" }); return; }

  const record = videoById.get(videoId);
  if (!record) { res.status(404).json({ error: "Video not found" }); return; }

  // Charge viewer VIEW_PRICE → Dispatch wallet using their API key
  try {
    await pay(DISPATCH_WALLET, VIEW_PRICE, `Dispatch view: ${videoId}`, locusApiKey);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(402).json({ error: `View payment failed: ${msg}` });
    return;
  }

  // Send 40% revenue share to requester using the main Dispatch API key
  if (record.requesterAddress) {
    const share = parseFloat((VIEW_PRICE * REQUESTER_SHARE).toFixed(6));
    try {
      await pay(record.requesterAddress, share, `Dispatch view revenue share: ${videoId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log but don't fail the request — viewer already paid
      console.error(`[Server] Revenue share payment failed for ${videoId}: ${msg}`);
    }
  }

  record.viewCount += 1;
  record.totalRevenue += VIEW_PRICE;

  const videoUrl = `/video/${encodeURIComponent(record.filename)}`;
  res.json({ videoUrl, viewCount: record.viewCount });
});

app.post("/generate", async (req: Request, res: Response) => {
  const topic: string = req.body?.topic || "AI agent economy breakthroughs";
  const jobId = Date.now().toString(36);
  const startedAt = new Date().toISOString();

  console.log(`\n[Server] POST /generate — topic: "${topic}" — jobId: ${jobId}`);

  jobs.set(jobId, { status: "running", topic, startedAt });

  runPipeline(topic)
    .then((result) => {
      jobs.set(jobId, { status: "done", result, topic, startedAt });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Server] Pipeline error for job ${jobId}:`, message);
      jobs.set(jobId, { status: "error", error: message, topic, startedAt });
    });

  res.json({ jobId, status: "running" });
});

app.get("/api/jobs/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status === "running") {
    res.json({ status: "running", topic: job.topic, startedAt: job.startedAt });
    return;
  }

  if (job.status === "error") {
    res.json({ status: "error", error: job.error, topic: job.topic, startedAt: job.startedAt });
    return;
  }

  // done — push to history and return full result
  const result = job.result!;
  const filename = path.basename(result.videoPath);
  const videoId = filename.replace(/\.mp4$/, "");
  const alreadyRecorded = videoById.has(videoId);
  if (!alreadyRecorded) {
    const record: VideoRecord = {
      filename,
      headline: result.headline,
      cost: result.totalCost,
      payments: result.payments,
      createdAt: new Date().toISOString(),
      topic: job.topic,
      requesterAddress: result.requesterAddress,
      viewPrice: VIEW_PRICE,
      viewCount: 0,
      totalRevenue: 0,
    };
    videoHistory.push(record);
    videoById.set(videoId, record);
    if (videoHistory.length > 20) {
      const removed = videoHistory.shift();
      if (removed) videoById.delete(removed.filename.replace(/\.mp4$/, ""));
    }
  }

  const videoUrl = `/video/${encodeURIComponent(filename)}`;
  res.json({
    status: "done",
    videoUrl,
    cost: result.totalCost,
    payments: result.payments,
    headline: result.headline,
    topic: job.topic,
    startedAt: job.startedAt,
  });
});

app.get("/video/:filename", (req: Request, res: Response) => {
  const filename = req.params.filename;
  // Sanitise — only allow safe filenames
  if (!/^[\w\-\.]+\.mp4$/.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = `/tmp/${filename}`;
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.sendFile(filePath);
});

// ────────────────────────────────────────────────────────────
// Start
// ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nDispatch server running on http://localhost:${PORT}`);
  console.log(`   DEMO_MODE=${process.env.DEMO_MODE ?? "false"}`);
  console.log(`   LOCUS_API_KEY=${process.env.LOCUS_API_KEY ? "set" : "NOT SET"}\n`);
});

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
