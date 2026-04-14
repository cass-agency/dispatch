import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { runPipeline, PipelineResult } from "./pipeline";

dotenv.config();

// ============================================================
// Dispatch Express Server — port 8080
// ============================================================

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 8080;

interface VideoRecord {
  filename: string;
  headline: string;
  cost: number;
  payments: PipelineResult["payments"];
  createdAt: string;
  topic: string;
}

// In-memory store — last 5 videos
const videoHistory: VideoRecord[] = [];

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
  res.json({ status: "ok", version: "0.1.0" });
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
        <td><a href="/video/${encodeURIComponent(v.filename)}" target="_blank">▶ Watch</a></td>
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
    .generate-form { display: flex; gap: 12px; margin-bottom: 40px; flex-wrap: wrap; }
    .generate-form input { flex: 1; min-width: 260px; background: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 8px; padding: 12px 16px; font-size: 1rem; outline: none; }
    .generate-form input:focus { border-color: #3182ce; }
    .generate-form button { background: #3182ce; color: #fff; border: none; border-radius: 8px; padding: 12px 28px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .generate-form button:hover { background: #2b6cb0; }
    .generate-form button:disabled { background: #4a5568; cursor: not-allowed; }
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
    .section-title { font-size: 1.1rem; font-weight: 700; color: #90cdf4; margin-bottom: 16px; }
  </style>
</head>
<body>
<header>
  <div>
    <h1>📡 Dispatch</h1>
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
    <div class="meta">Topic: ${escHtml(latest.topic)} &nbsp;·&nbsp; Cost: $${latest.cost.toFixed(4)} USDC &nbsp;·&nbsp; ${latest.createdAt}</div>
    <div style="margin-top:16px;"><a href="/video/${encodeURIComponent(latest.filename)}">▶ Watch Video</a></div>
  </div>`
      : `<div class="hero"><h2>No videos yet</h2><p style="color:#718096;margin-top:8px;">Generate your first AI news video below.</p></div>`
  }

  <div class="section-title">Generate New Video</div>
  <div class="generate-form">
    <input id="topicInput" type="text" placeholder="Topic (e.g. AI agent economy breakthroughs)" value="AI agent economy breakthroughs" />
    <button id="generateBtn" onclick="generate()">🚀 Generate</button>
  </div>
  <div id="status"></div>

  <div class="section-title" style="margin-top:40px;">Pipeline Agents</div>
  <div class="pipeline-steps">
    <div class="step"><div class="icon">📍</div><div class="label">Researcher</div><div class="cost">$0.09</div></div>
    <div class="step"><div class="icon">✍️</div><div class="label">Scriptwriter</div><div class="cost">$0.01</div></div>
    <div class="step"><div class="icon">🎨</div><div class="label">Visual</div><div class="cost">$0.08</div></div>
    <div class="step"><div class="icon">🎬</div><div class="label">Editor</div><div class="cost">$0.00</div></div>
    <div class="step"><div class="icon">🎙️</div><div class="label">Voice</div><div class="cost">$0.02</div></div>
    <div class="step"><div class="icon">🎵</div><div class="label">Music</div><div class="cost">$0.10</div></div>
  </div>

  ${
    videoHistory.length > 0
      ? `<div class="section-title">Video History</div>
  <table>
    <thead><tr><th>Created</th><th>Headline</th><th>Topic</th><th>Cost</th><th>Watch</th></tr></thead>
    <tbody>${historyRows}</tbody>
  </table>`
      : ""
  }
</div>
<script>
async function generate() {
  const btn = document.getElementById('generateBtn');
  const statusEl = document.getElementById('status');
  const topic = document.getElementById('topicInput').value || 'AI agent economy breakthroughs';
  btn.disabled = true;
  btn.textContent = '⏳ Starting...';
  statusEl.style.display = 'block';
  statusEl.textContent = '🚀 Submitting job...\n';
  try {
    const res = await fetch('/generate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({topic})
    });
    const data = await res.json();
    if (data.error) {
      statusEl.textContent += '\n❌ Error: ' + data.error;
      btn.disabled = false;
      btn.textContent = '🚀 Generate';
      return;
    }
    const jobId = data.jobId;
    statusEl.textContent += '✅ Job started: ' + jobId + '\n⏳ Processing';
    btn.textContent = '⏳ Generating...';
    // Poll every 3 seconds
    const poll = async () => {
      try {
        const pollRes = await fetch('/api/jobs/' + jobId);
        const job = await pollRes.json();
        if (job.status === 'running') {
          statusEl.textContent += '.';
          setTimeout(poll, 3000);
        } else if (job.status === 'done') {
          statusEl.textContent += '\n\n✅ Done! Headline: ' + job.headline;
          statusEl.textContent += '\n💰 Total cost: $' + job.cost.toFixed(4) + ' USDC';
          if (job.videoUrl) statusEl.textContent += '\n📹 Video: ' + job.videoUrl;
          btn.disabled = false;
          btn.textContent = '🚀 Generate';
          setTimeout(() => location.reload(), 2000);
        } else {
          statusEl.textContent += '\n\n❌ Error: ' + job.error;
          btn.disabled = false;
          btn.textContent = '🚀 Generate';
        }
      } catch(e) {
        statusEl.textContent += '\n❌ Poll error: ' + e.message;
        btn.disabled = false;
        btn.textContent = '🚀 Generate';
      }
    };
    setTimeout(poll, 3000);
  } catch(e) {
    statusEl.textContent += '\n❌ Network error: ' + e.message;
    btn.disabled = false;
    btn.textContent = '🚀 Generate';
  }
}
</script>
</body>
</html>`;

  res.send(html);
});

app.post("/generate", async (req: Request, res: Response) => {
  const topic: string = req.body?.topic || "AI agent economy breakthroughs";
  const jobId = Date.now().toString(36);
  const startedAt = new Date().toISOString();

  console.log(`\n📍 [Server] POST /generate — topic: "${topic}" — jobId: ${jobId}`);

  jobs.set(jobId, { status: "running", topic, startedAt });

  runPipeline(topic)
    .then((result) => {
      jobs.set(jobId, { status: "done", result, topic, startedAt });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ [Server] Pipeline error for job ${jobId}:`, message);
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
  const alreadyRecorded = videoHistory.some((v) => v.filename === filename);
  if (!alreadyRecorded) {
    videoHistory.push({
      filename,
      headline: result.headline,
      cost: result.totalCost,
      payments: result.payments,
      createdAt: new Date().toISOString(),
      topic: job.topic,
    });
    if (videoHistory.length > 5) videoHistory.shift();
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
  console.log(`\n📡 Dispatch server running on http://localhost:${PORT}`);
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
