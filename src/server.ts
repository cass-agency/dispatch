import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { runPipeline, PipelineResult, StepCallback, TokenCallback } from "./pipeline";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 8080;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface VideoRecord {
  filename: string;
  headline: string;
  cost: number;
  payments: PipelineResult["payments"];
  createdAt: string;
  topic: string;
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
  streamListeners: import('express').Response[];
  tokenBuffer: Array<{ agent: string; token: string }>;
}

// ────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────

const STEP_NAMES = ["researcher", "scriptwriter", "visual", "voice", "music", "editor"];

const videoHistory: VideoRecord[] = [];
const jobs = new Map<string, JobRecord>();

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
        <td style="color:#94a3b8">${v.createdAt.replace("T", " ").slice(0, 19)}</td>
        <td style="font-weight:600">${escHtml(v.headline)}</td>
        <td style="color:#94a3b8">${escHtml(v.topic)}</td>
        <td style="color:#22c55e;font-family:monospace">$${v.cost.toFixed(4)}</td>
        <td><a href="/video/${encodeURIComponent(v.filename)}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);padding:4px 10px;border-radius:6px;font-size:0.75rem;color:#60a5fa">▶ Watch</a></td>
      </tr>`
    )
    .join("");

  // Ticker items — recent headlines or defaults
  const tickerItems = videoHistory.length > 0
    ? videoHistory.map(v => `<span><span class="ticker-label">DISPATCH</span>${escHtml(v.headline)}</span>`).join(" &nbsp;·&nbsp; ")
    : `<span><span class="ticker-label">DISPATCH</span>Autonomous AI news generation — powered by Locus</span>
       <span><span class="ticker-label">LIVE</span>Six AI agents · Research → Script → Visuals → Voice → Music → Edit</span>
       <span><span class="ticker-label">NEW</span>Each agent earns real USDC on task completion</span>
       <span><span class="ticker-label">DISPATCH</span>Enter a topic to generate a broadcast</span>`;

  // Latest video block
  const latestVideoBlock = latest ? `
  <div class="video-wrapper" style="margin-top:0">
    <div class="video-header">
      <div class="now-playing-badge">Latest Broadcast</div>
      <div class="video-headline">${escHtml(latest.headline)}</div>
      <div class="video-meta">$${latest.cost.toFixed(4)} USDC &nbsp;·&nbsp; ${latest.createdAt.replace("T"," ").slice(0,19)}</div>
    </div>
    <video controls src="/video/${encodeURIComponent(latest.filename)}"></video>
    <div class="payment-breakdown">
      ${latest.payments.filter(p => p.amount > 0).map(p => `
        <div class="payment-item">
          <div class="payment-agent">${p.agent}</div>
          <div class="payment-amount">+$${p.amount.toFixed(2)}</div>
          <div class="payment-addr">${p.address.slice(0,6)}…${p.address.slice(-4)}</div>
        </div>`).join("")}
    </div>
  </div>` : `
  <div style="background:#0e0e1c;border:1px solid #1e1e3a;border-radius:16px;padding:48px;text-align:center;color:#475569">
    <div style="font-size:3rem;margin-bottom:16px">📡</div>
    <div style="font-size:1rem;font-weight:600;color:#64748b">No broadcasts yet</div>
    <div style="font-size:0.85rem;margin-top:8px">Generate your first AI news video above</div>
  </div>`;

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
      --red: #ef4444;
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
      padding: 0 40px;
      height: 68px;
      display: flex;
      align-items: center;
      gap: 20px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .on-air {
      display: flex; align-items: center; gap: 6px;
      background: rgba(239,68,68,0.12);
      border: 1px solid rgba(239,68,68,0.35);
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 0.65rem; font-weight: 800;
      color: #ef4444; letter-spacing: 0.15em;
      text-transform: uppercase; flex-shrink: 0;
    }
    .on-air-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #ef4444;
      animation: blink 1.4s ease-in-out infinite;
    }
    .logo { font-size: 1.45rem; font-weight: 900; letter-spacing: -0.5px; color: #fff; }
    .tagline { font-size: 0.7rem; color: var(--muted); margin-top: 2px; letter-spacing: 0.04em; text-transform: uppercase; }
    .locus-badge {
      margin-left: auto; display: flex; align-items: center; gap: 8px;
      font-size: 0.75rem; color: var(--muted);
    }
    .locus-badge strong { color: #60a5fa; font-weight: 700; }
    .locus-pill {
      background: rgba(96,165,250,0.1); border: 1px solid rgba(96,165,250,0.25);
      border-radius: 20px; padding: 4px 12px; font-size: 0.7rem; color: #60a5fa;
      letter-spacing: 0.04em;
    }

    /* ── Ticker ── */
    .ticker {
      background: #080816; border-bottom: 1px solid var(--border);
      height: 34px; overflow: hidden; display: flex; align-items: center;
    }
    .ticker-inner { overflow: hidden; flex: 1; }
    .ticker-track {
      display: inline-flex; gap: 60px; white-space: nowrap;
      padding: 0 40px; font-size: 0.72rem; color: #94a3b8;
      animation: ticker-scroll 40s linear infinite;
    }
    .ticker-label {
      display: inline-block;
      background: rgba(59,130,246,0.12); color: #60a5fa;
      font-size: 0.6rem; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.12em; padding: 1px 6px; border-radius: 2px;
      margin-right: 6px; vertical-align: middle;
    }

    /* ── Layout ── */
    .container { max-width: 1200px; margin: 0 auto; padding: 40px 24px; }

    /* ── Vision card ── */
    .vision-card {
      background: linear-gradient(135deg, rgba(59,130,246,0.06) 0%, var(--surface) 100%);
      border: 1px solid rgba(59,130,246,0.2);
      border-radius: 16px; padding: 32px 36px; margin-bottom: 40px;
      display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center;
    }
    .vision-title { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.3px; margin-bottom: 10px; }
    .vision-title span { color: #60a5fa; }
    .vision-desc { font-size: 0.9rem; color: #94a3b8; line-height: 1.65; max-width: 620px; }
    .vision-stats { display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; }
    .stat-item { text-align: right; }
    .stat-number { font-size: 1.6rem; font-weight: 900; color: #60a5fa; font-variant-numeric: tabular-nums; }
    .stat-label { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }

    /* ── Generate ── */
    .section-label {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.12em; color: var(--muted); margin-bottom: 12px;
    }
    .generate-form { display: flex; gap: 12px; flex-wrap: wrap; }
    .generate-form input {
      flex: 1; min-width: 280px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 14px 18px;
      font-size: 0.95rem; color: var(--text); outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .generate-form input:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
    }
    .btn-generate {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #fff; border: none; border-radius: 10px;
      padding: 14px 32px; font-size: 0.95rem; font-weight: 700;
      cursor: pointer; letter-spacing: 0.02em;
      transition: all 0.2s; white-space: nowrap;
      box-shadow: 0 2px 12px rgba(37,99,235,0.3);
    }
    .btn-generate:hover { background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%); transform: translateY(-1px); box-shadow: 0 6px 20px rgba(37,99,235,0.4); }
    .btn-generate:active { transform: translateY(0); }
    .btn-generate:disabled { background: #1e293b; color: #475569; cursor: not-allowed; transform: none; box-shadow: none; }

    /* ── Pipeline ── */
    .pipeline-section { margin-bottom: 40px; }
    .pipeline-scroll { overflow-x: auto; padding-bottom: 4px; }
    .pipeline-flow { display: flex; align-items: center; min-width: max-content; }

    .agent-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 16px 14px;
      width: 156px; flex-shrink: 0;
      transition: border-color 0.3s, box-shadow 0.3s;
      position: relative; cursor: default;
    }
    .agent-card.running {
      border-color: var(--blue);
      box-shadow: 0 0 0 1px var(--blue), 0 0 28px rgba(59,130,246,0.22);
      animation: card-glow 1.8s ease-in-out infinite;
    }
    .agent-card.done { border-color: rgba(34,197,94,0.45); }
    .agent-card.error { border-color: rgba(239,68,68,0.45); }

    .status-dot {
      position: absolute; top: 12px; right: 12px;
      width: 7px; height: 7px; border-radius: 50%;
      background: #334155; transition: background 0.3s;
    }
    .agent-card.running .status-dot { background: var(--blue); animation: dot-blink 0.9s ease-in-out infinite; }
    .agent-card.done .status-dot { background: var(--green); }
    .agent-card.error .status-dot { background: var(--red); }

    .agent-icon { font-size: 1.5rem; margin-bottom: 8px; display: block; }
    .agent-name { font-size: 0.82rem; font-weight: 700; color: var(--text); margin-bottom: 3px; }
    .agent-wallet { font-size: 0.6rem; color: #475569; font-family: 'Courier New', monospace; margin-bottom: 8px; letter-spacing: -0.02em; }
    .agent-earn { font-size: 0.72rem; font-weight: 600; color: var(--green); }
    .agent-earn.zero { color: #475569; }
    .agent-role { font-size: 0.62rem; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }

    .pipeline-connector {
      width: 28px; height: 2px;
      background: var(--border); flex-shrink: 0;
      position: relative; overflow: hidden;
    }
    .pipeline-connector.active::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, var(--blue), transparent);
      animation: flow-line 0.8s linear infinite;
    }

    /* ── Terminal ── */
    #log-terminal {
      background: #030308; border: 1px solid var(--border);
      border-radius: 12px; overflow: hidden; margin-top: 20px;
      display: none;
    }
    .terminal-bar {
      background: #0a0a18; padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 8px;
    }
    .term-dots { display: flex; gap: 5px; }
    .term-dot { width: 10px; height: 10px; border-radius: 50%; }
    .td-r { background: #ef4444; } .td-y { background: #f59e0b; } .td-g { background: #22c55e; }
    .term-title { font-size: 0.68rem; color: #475569; letter-spacing: 0.05em; text-transform: uppercase; margin-left: 4px; }
    .term-timer { margin-left: auto; font-size: 0.68rem; color: #475569; font-family: monospace; }
    .terminal-body {
      padding: 14px 18px; max-height: 220px; overflow-y: auto;
      font-family: 'Courier New', monospace; font-size: 0.78rem; line-height: 1.75;
    }
    .log-line { color: #4ade80; }
    .log-line.dim { color: #475569; }
    .log-line.err { color: #f87171; }
    .log-line .stext { word-break: break-word; }
    .stream-agent { color: #60a5fa; font-weight: 600; }

    /* ── Video section ── */
    .video-section { margin-bottom: 40px; }
    .video-wrapper {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 16px; overflow: hidden;
    }
    .video-header {
      padding: 16px 20px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .now-playing-badge {
      background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35);
      color: #ef4444; font-size: 0.62rem; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.12em;
      padding: 3px 8px; border-radius: 3px; flex-shrink: 0;
      animation: blink 2s ease-in-out infinite;
    }
    .video-headline { font-size: 1rem; font-weight: 700; flex: 1; min-width: 200px; }
    .video-meta { font-size: 0.75rem; color: var(--muted); flex-shrink: 0; }
    video { width: 100%; display: block; background: #000; max-height: 540px; }
    .payment-breakdown {
      padding: 16px 20px; border-top: 1px solid var(--border);
      display: flex; flex-wrap: wrap; gap: 20px; align-items: center;
    }
    .breakdown-label { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-right: 4px; }
    .payment-item { display: flex; flex-direction: column; gap: 1px; }
    .payment-agent { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .payment-amount { font-size: 0.875rem; font-weight: 700; color: var(--green); font-family: monospace; }
    .payment-addr { font-size: 0.58rem; color: #334155; font-family: monospace; }

    /* ── History ── */
    .history-section { margin-bottom: 40px; }
    .table-wrapper { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: rgba(30,30,58,0.6); }
    th, td { padding: 12px 16px; text-align: left; font-size: 0.8rem; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 700; text-transform: uppercase; font-size: 0.63rem; letter-spacing: 0.1em; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.015); }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 24px 40px; text-align: center;
      font-size: 0.72rem; color: #334155;
    }

    /* ── Keyframes ── */
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.35} }
    @keyframes ticker-scroll { from{transform:translateX(0)} to{transform:translateX(-50%)} }
    @keyframes card-glow {
      0%,100%{ box-shadow: 0 0 0 1px var(--blue), 0 0 28px rgba(59,130,246,0.22); }
      50%{ box-shadow: 0 0 0 1px var(--blue), 0 0 42px rgba(59,130,246,0.38); }
    }
    @keyframes dot-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
    @keyframes flow-line { from{transform:translateX(-100%)} to{transform:translateX(100%)} }
    @keyframes fade-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

    /* ── Responsive ── */
    @media(max-width:700px){
      header { padding: 0 16px; }
      .container { padding: 24px 16px; }
      .vision-card { grid-template-columns: 1fr; }
      .vision-stats { flex-direction: row; flex-wrap: wrap; }
      .stat-item { text-align: left; }
      .locus-badge span:not(.locus-pill) { display: none; }
    }
  </style>
</head>
<body>

<!-- ═══ HEADER ═══ -->
<header>
  <div class="on-air"><div class="on-air-dot"></div>ON AIR</div>
  <div>
    <div class="logo">📡 Dispatch</div>
    <div class="tagline">Autonomous AI News Video Network</div>
  </div>
  <div class="locus-badge">
    <span>Powered by</span>
    <strong>LOCUS</strong>
    <span>·</span>
    <span class="locus-pill">Hackathon 2026</span>
  </div>
</header>

<!-- ═══ TICKER ═══ -->
<div class="ticker">
  <div class="ticker-inner">
    <div class="ticker-track">
      ${tickerItems} &nbsp;&nbsp;&nbsp;&nbsp; ${tickerItems}
    </div>
  </div>
</div>

<div class="container">

  <!-- ═══ VISION ═══ -->
  <div class="vision-card">
    <div>
      <div class="vision-title">The world's first <span>autonomous AI</span> news network</div>
      <div class="vision-desc">
        Six specialist agents — each with a Locus smart wallet — collaborate end-to-end to produce original news broadcasts.
        A researcher finds stories, a scriptwriter crafts the narrative, a visual agent renders cinematic images,
        a voice agent narrates, a music agent composes the score, and an editor assembles the final video.
        Every agent earns real <strong style="color:#22c55e">USDC</strong> for their contribution via Locus Pay.
        No human in the loop. No central server of truth. Just agents doing work and getting paid.
      </div>
    </div>
    <div class="vision-stats">
      <div class="stat-item">
        <div class="stat-number">6</div>
        <div class="stat-label">AI Agents</div>
      </div>
      <div class="stat-item">
        <div class="stat-number" style="color:#22c55e">$0.33</div>
        <div class="stat-label">Avg. Agent Pay</div>
      </div>
      <div class="stat-item">
        <div class="stat-number">${videoHistory.length}</div>
        <div class="stat-label">Broadcasts</div>
      </div>
    </div>
  </div>

  <!-- ═══ GENERATE ═══ -->
  <section style="margin-bottom:40px">
    <div class="section-label">Commission a Broadcast</div>
    <div class="generate-form">
      <input id="topicInput" type="text"
        placeholder="Enter a news topic (e.g. AI agent economy, quantum computing, climate tech...)"
        value="AI agent economy breakthroughs" />
      <button class="btn-generate" id="generateBtn" onclick="generate()">🚀 Broadcast</button>
    </div>
  </section>

  <!-- ═══ PIPELINE ═══ -->
  <section class="pipeline-section">
    <div class="section-label">Live Agent Pipeline</div>
    <div class="pipeline-scroll">
      <div class="pipeline-flow" id="pipeline-flow">

        <div class="agent-card pending" data-agent="researcher">
          <div class="status-dot"></div>
          <span class="agent-icon">📍</span>
          <div class="agent-name">Researcher</div>
          <div class="agent-wallet">0xA865…FDF5</div>
          <div class="agent-earn zero">orchestrator</div>
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
    </div>

    <!-- Live terminal -->
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
  <section class="video-section" id="video-section" style="${latest ? "" : "display:none"}">
    <div class="section-label" style="margin-bottom:16px">Latest Broadcast</div>
    ${latestVideoBlock}
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
  Agents earn real USDC &nbsp;·&nbsp; Hackathon 2026
</footer>

<script>
  let pollTimer = null;
  let startTime = null;
  let timerInterval = null;
  let lastLogCount = 0;
  let activeEs = null;

  function startStreaming(jobId) {
    if (activeEs) { activeEs.close(); activeEs = null; }
    const termBody = document.getElementById('terminal-body');
    const agentLines = {}; // agent -> current text span

    const es = new EventSource('/api/jobs/' + jobId + '/stream');
    activeEs = es;

    const agentEmoji = { researcher: '📍', scriptwriter: '✍️', visual: '🎨', voice: '🎙️', music: '🎵', editor: '🎬' };

    es.onmessage = function(evt) {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'done') { es.close(); activeEs = null; return; }
        const { agent, token } = data;
        if (!agent || token === undefined) return;

        // On newlines in token, close current line
        if (token.includes('\\n') && agentLines[agent]) {
          delete agentLines[agent];
          return;
        }

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

    es.onerror = function() { es.close(); activeEs = null; };
    return es;
  }

  function generate() {
    const btn = document.getElementById('generateBtn');
    const topic = document.getElementById('topicInput').value.trim() || 'AI agent economy breakthroughs';

    btn.disabled = true;
    btn.textContent = '⏳ Generating...';

    // Reset pipeline cards
    document.querySelectorAll('.agent-card').forEach(c => { c.className = 'agent-card pending'; });
    document.querySelectorAll('.pipeline-connector').forEach(c => c.classList.remove('active'));

    // Show terminal
    const terminal = document.getElementById('log-terminal');
    const termBody = document.getElementById('terminal-body');
    terminal.style.display = 'block';
    termBody.innerHTML = '';
    lastLogCount = 0;
    addLog('🚀 Dispatching pipeline for topic: "' + topic + '"', 'dim');

    // Start timer
    startTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();

    // Submit job
    fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    })
    .then(r => r.json())
    .then(data => {
      if (data.error) { handleError(data.error); return; }
      addLog('✅ Job ID: ' + data.jobId + ' — pipeline initialised', 'dim');
      startStreaming(data.jobId);
      schedulePoll(data.jobId);
    })
    .catch(err => handleError('Network error: ' + err.message));
  }

  function schedulePoll(jobId) {
    pollTimer = setTimeout(() => pollJob(jobId), 2000);
  }

  function pollJob(jobId) {
    fetch('/api/jobs/' + jobId)
    .then(r => r.json())
    .then(job => {
      // Update agent cards and connectors
      if (job.steps) {
        const connectors = document.querySelectorAll('.pipeline-connector');
        job.steps.forEach((step, i) => {
          const card = document.querySelector('[data-agent="' + step.name + '"]');
          if (card) {
            card.className = 'agent-card ' + step.status;
          }
          if (i > 0 && step.status === 'running' && connectors[i-1]) {
            connectors[i-1].classList.add('active');
          }
          if (step.status === 'done' && connectors[i]) {
            connectors[i].classList.add('active');
          }
        });
      }

      // SSE handles terminal logs — only update step statuses via polling
      // (no addLog calls for job.logs here)

      if (job.status === 'running') {
        schedulePoll(jobId);
      } else if (job.status === 'done') {
        clearInterval(timerInterval);
        addLog('✅ Pipeline complete — total paid: $' + job.cost.toFixed(4) + ' USDC');
        showVideo(job.videoUrl, job.headline, job.cost, job.payments);
        const btn = document.getElementById('generateBtn');
        btn.disabled = false;
        btn.textContent = '🚀 Broadcast';
        setTimeout(() => location.reload(), 5000);
      } else {
        clearInterval(timerInterval);
        addLog('❌ Pipeline error: ' + job.error, 'err');
        const btn = document.getElementById('generateBtn');
        btn.disabled = false;
        btn.textContent = '🚀 Broadcast';
      }
    })
    .catch(() => {
      // retry silently on network hiccup
      schedulePoll(jobId);
    });
  }

  function showVideo(url, headline, cost, payments) {
    const section = document.getElementById('video-section');
    section.style.display = 'block';
    section.style.animation = 'fade-in 0.5s ease';

    const payHtml = payments
      ? payments.filter(p => p.amount > 0).map(p =>
          '<div class="payment-item">' +
          '<div class="payment-agent">' + p.agent + '</div>' +
          '<div class="payment-amount">+$' + p.amount.toFixed(2) + '</div>' +
          '<div class="payment-addr">' + p.address.slice(0,6) + '\\u2026' + p.address.slice(-4) + '</div>' +
          '</div>'
        ).join('') : '';

    section.innerHTML =
      '<div class="section-label" style="margin-bottom:16px">Latest Broadcast</div>' +
      '<div class="video-wrapper">' +
        '<div class="video-header">' +
          '<div class="now-playing-badge">Now Playing</div>' +
          '<div class="video-headline">' + escHtmlJs(headline) + '</div>' +
          '<div class="video-meta">$' + cost.toFixed(4) + ' USDC</div>' +
        '</div>' +
        '<video id="main-video" controls autoplay src="' + url + '"></video>' +
        '<div class="payment-breakdown">' +
          '<span class="breakdown-label">Agent payments →</span>' +
          payHtml +
        '</div>' +
      '</div>';

    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function addLog(msg, cls) {
    const body = document.getElementById('terminal-body');
    if (!body) return;
    const div = document.createElement('div');
    div.className = 'log-line' + (cls ? ' ' + cls : '');
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
    div.textContent = '[' + ts + '] ' + msg;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function handleError(msg) {
    addLog(msg, 'err');
    clearInterval(timerInterval);
    const btn = document.getElementById('generateBtn');
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Broadcast'; }
  }

  function updateTimer() {
    const el = document.getElementById('elapsed-timer');
    if (!el || !startTime) return;
    const s = Math.floor((Date.now() - startTime) / 1000);
    el.textContent = s < 60 ? s + 's elapsed' : Math.floor(s/60) + 'm ' + (s%60) + 's elapsed';
  }

  function escHtmlJs(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
</script>
</body>
</html>`;

  res.send(html);
});

// ────────────────────────────────────────────────────────────
// POST /generate — start a pipeline job
// ────────────────────────────────────────────────────────────

app.post("/generate", async (req: Request, res: Response) => {
  const topic: string = req.body?.topic || "AI agent economy breakthroughs";
  const jobId = Date.now().toString(36);
  const startedAt = new Date().toISOString();

  console.log(`\n📍 [Server] POST /generate — topic: "${topic}" — jobId: ${jobId}`);

  const job: JobRecord = {
    status: "running",
    topic,
    startedAt,
    steps: STEP_NAMES.map((name) => ({ name, status: "pending" })),
    logs: [],
    streamListeners: [],
    tokenBuffer: [],
  };
  jobs.set(jobId, job);

  // Step callback — updates job steps + logs in real time
  const onStep: StepCallback = (agent, phase, log) => {
    const step = job.steps.find((s) => s.name === agent);
    if (step) {
      step.status = phase === "start" ? "running" : "done";
    }
    const ts = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    job.logs.push(`[${ts}] ${log}`);
    console.log(`  ↳ [${agent}/${phase}] ${log}`);
  };

  const onToken: TokenCallback = (agent, token) => {
    const item = { agent, token };
    job.tokenBuffer.push(item);
    if (job.tokenBuffer.length > 20000) job.tokenBuffer.shift();
    job.streamListeners.forEach((res) => {
      try { res.write(`data: ${JSON.stringify(item)}\n\n`); } catch {}
    });
  };

  const closeStreams = (status: string) => {
    job.streamListeners.forEach((res) => {
      try { res.write(`data: ${JSON.stringify({ type: "done", status })}\n\n`); res.end(); } catch {}
    });
    job.streamListeners = [];
  };

  runPipeline(topic, onStep, onToken)
    .then((result) => {
      job.status = "done";
      job.result = result;
      closeStreams("done");
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ [Server] Pipeline error for job ${jobId}:`, message);
      job.status = "error";
      job.error = message;
      job.logs.push(`❌ Pipeline failed: ${message}`);
      closeStreams("error");
    });

  res.json({ jobId, status: "running" });
});

// ────────────────────────────────────────────────────────────
// GET /api/jobs/:jobId/stream — SSE token stream
// ────────────────────────────────────────────────────────────

app.get("/api/jobs/:jobId/stream", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // replay buffered tokens
  job.tokenBuffer.forEach((item) => {
    try { res.write(`data: ${JSON.stringify(item)}\n\n`); } catch {}
  });
  job.streamListeners.push(res);
  req.on("close", () => {
    const idx = job.streamListeners.indexOf(res);
    if (idx > -1) job.streamListeners.splice(idx, 1);
  });
});

// ────────────────────────────────────────────────────────────
// GET /api/jobs/:jobId — poll job status (includes step data)
// ────────────────────────────────────────────────────────────

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

  // done — record to history
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
    if (videoHistory.length > 10) videoHistory.shift();
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
    steps: job.steps,
    logs: job.logs,
  });
});

// ────────────────────────────────────────────────────────────
// GET /video/:filename — serve video file
// ────────────────────────────────────────────────────────────

app.get("/video/:filename", (req: Request, res: Response) => {
  const filename = req.params.filename;
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
