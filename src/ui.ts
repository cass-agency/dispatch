// ═══════════════════════════════════════════════════════════════
// Dispatch — UI renderer (neo-brutalist broadcast studio)
// ═══════════════════════════════════════════════════════════════

export interface AgentWalletMeta {
  emoji: string;
  label: string;
  address: string;
}

export interface VideoRow {
  filename: string;
  headline: string;
  topic: string;
  cost: number;
  createdAt: string;
  commissionSessionId?: string;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Monochrome agent icons (24x24, currentColor) ──
const AGENT_ICONS: Record<string, string> = {
  researcher: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg>`,
  scriptwriter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v5h6"/><path d="M7 13h10M7 17h7"/></svg>`,
  visual: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="9" cy="9" r="1.6"/><path d="m21 16-5-5-9 9"/></svg>`,
  voice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>`,
  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  editor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20"/><path d="m10 14 4 2-4 2z" fill="currentColor"/></svg>`,
};

interface AgentMeta {
  name: string;
  label: string;
  role: string;
  api: string;
  earn: string;
  color: string;
  addr: string;
}

const AGENT_ORDER: AgentMeta[] = [
  { name: "researcher",   label: "Researcher",   role: "Research",   api: "Tavily",    earn: "ORCHESTRATOR", color: "yellow", addr: "0xA865…FDF5" },
  { name: "scriptwriter", label: "Scriptwriter", role: "Writing",    api: "Claude",    earn: "$0.02",        color: "lime",   addr: "0xA86e…1598" },
  { name: "visual",       label: "Visual",       role: "Imagery",    api: "fal.ai",    earn: "$0.12",        color: "coral",  addr: "0xF46F…0617" },
  { name: "voice",        label: "Voice",        role: "Narration",  api: "Deepgram",  earn: "$0.04",        color: "sky",    addr: "0x51fF…56c8" },
  { name: "music",        label: "Music",        role: "Score",      api: "Suno",      earn: "$0.15",        color: "lavender", addr: "0x60Be…0a50" },
  { name: "editor",       label: "Editor",       role: "Assembly",   api: "FFmpeg",    earn: "FREE",         color: "paper",  addr: "on-chain" },
];

export interface RenderOpts {
  videoHistory: VideoRow[];
  agentWallets: Record<string, AgentWalletMeta>;
}

export function renderHome({ videoHistory, agentWallets }: RenderOpts): string {
  // Latest broadcast for the "Now Playing" hero panel
  const latest = videoHistory.length > 0 ? videoHistory[videoHistory.length - 1] : null;

  // Ticker items
  const tickerItemsHtml =
    videoHistory.length > 0
      ? videoHistory
          .map((v) => `<span class="ticker-item"><span class="ticker-tag">DISPATCH</span>${escHtml(v.headline)}</span>`)
          .join("")
      : `<span class="ticker-item"><span class="ticker-tag">LIVE</span>Six autonomous agents producing news on-chain</span>
         <span class="ticker-item"><span class="ticker-tag">ECONOMY</span>Agents earn real USDC · Commissioners earn 40% of views</span>
         <span class="ticker-item"><span class="ticker-tag">BASE</span>Settled on Base · paid via Locus</span>`;

  // Broadcast archive cards
  const archiveCards = [...videoHistory]
    .reverse()
    .slice(0, 9)
    .map((v, i) => {
      const colors = ["yellow", "lime", "coral", "sky", "lavender", "paper"];
      const color = colors[i % colors.length];
      const num = String(videoHistory.length - i).padStart(3, "0");
      const dateStr = v.createdAt.slice(0, 10);
      return `
      <article class="bcast-card bcast-card--${color}">
        <div class="bcast-card__top">
          <span class="bcast-num">NO. ${num}</span>
          <span class="bcast-date">${dateStr}</span>
        </div>
        <h3 class="bcast-headline">${escHtml(v.headline)}</h3>
        <div class="bcast-meta">
          <span class="bcast-topic">${escHtml(v.topic.slice(0, 60))}</span>
          <span class="bcast-cost">$${v.cost.toFixed(4)}</span>
        </div>
        <button class="bcast-watch" data-watch="${escHtml(v.filename)}" data-comm="${escHtml(v.commissionSessionId ?? "")}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          WATCH · $0.05
        </button>
      </article>`;
    })
    .join("");

  // Pipeline agent cards
  const pipelineCards = AGENT_ORDER
    .map((a, i) => `
      ${i > 0 ? `<div class="pipe-connector" data-connector="${i - 1}"><div class="pipe-line"></div><div class="pipe-arrow">▶</div></div>` : ""}
      <div class="pipe-card pipe-card--${a.color}" data-agent="${a.name}">
        <div class="pipe-card__head">
          <span class="pipe-num">${String(i + 1).padStart(2, "0")}</span>
          <div class="pipe-dot"></div>
        </div>
        <div class="pipe-icon">${AGENT_ICONS[a.name]}</div>
        <div class="pipe-label">${a.label}</div>
        <div class="pipe-role">${a.role}</div>
        <div class="pipe-api">${a.api}</div>
        <div class="pipe-earn">${a.earn}</div>
        <div class="pipe-autonomy pipe-autonomy--orch" data-autonomy-badge>
          <span class="pipe-autonomy__dot"></span>
          <span data-autonomy-label>PENDING</span>
        </div>
      </div>`)
    .join("");

  // Treasury wallet cards (agents)
  const treasuryWallets = Object.entries(agentWallets)
    .map(([key, w]) => `
      <div class="wallet-card" data-wallet="${w.address}">
        <div class="wallet-card__top">
          <div class="wallet-icon">${AGENT_ICONS[key] ?? ""}</div>
          <a class="wallet-link" href="https://basescan.org/address/${w.address}" target="_blank" rel="noopener">
            ${w.address.slice(0, 6)}…${w.address.slice(-4)}
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>
          </a>
        </div>
        <div class="wallet-label">${w.label}</div>
        <div class="wallet-balance" data-balance>$—</div>
        <div class="wallet-autonomy wallet-autonomy--orch" data-wallet-autonomy data-agent-name="${key}">
          <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>
          <span data-wallet-autonomy-label>ORCHESTRATOR</span>
        </div>
      </div>`)
    .join("");

  // How-it-works strip
  const howSteps = [
    { n: "01", title: "Commission", body: "User pays $0.50 USDC via Locus Checkout. Funds land in Dispatch treasury." },
    { n: "02", title: "Research",   body: "Tavily searches live news. Claude drafts an editorial brief." },
    { n: "03", title: "Produce",    body: "Four agents run in sequence — script, visuals, voice, music — each paid in USDC." },
    { n: "04", title: "Publish",    body: "Editor assembles with Ken Burns motion & audio mix. Broadcast goes live." },
    { n: "05", title: "Earn",       body: "Each $0.05 view sends $0.02 back to the commissioner's wallet on-chain. Forever." },
  ];
  const howStepsHtml = howSteps.map((s) => `
    <div class="how-step">
      <div class="how-num">${s.n}</div>
      <div class="how-title-sm">${s.title}</div>
      <p class="how-body">${s.body}</p>
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Dispatch — Autonomous AI News Network</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Archivo+Black&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  /* ═══════════════════════════════════════════════════════════════
     Design tokens
     ═══════════════════════════════════════════════════════════════ */
  :root {
    /* Core surfaces */
    --ink: #0A0A0C;
    --ink-2: #131317;
    --ink-3: #1C1C22;
    --paper: #F5F1E8;
    --paper-2: #EFE8D4;
    --white: #FFFFFF;
    --off-white: #FAFAF7;

    /* Accents — saturated broadcast palette */
    --yellow: #FDE047;
    --lime: #BEF264;
    --coral: #FB7185;
    --sky: #93C5FD;
    --lavender: #C4B5FD;
    --red: #EF4444;

    /* Text */
    --text: #F5F1E8;
    --text-dim: #A3A3A0;
    --text-low: #6B6B68;
    --text-inverse: #0A0A0C;

    /* Shadows (neo-brutalist: hard, offset, no blur) */
    --sh-white-sm: 4px 4px 0 rgba(255,255,255,0.18);
    --sh-white:    7px 7px 0 rgba(255,255,255,0.22);
    --sh-white-lg: 10px 10px 0 rgba(255,255,255,0.26);
    --sh-black-sm: 3px 3px 0 #000;
    --sh-black:    6px 6px 0 #000;
    --sh-black-lg: 9px 9px 0 #000;
    --sh-yellow:   6px 6px 0 var(--yellow);
    --sh-red:      5px 5px 0 var(--red);

    /* Borders */
    --bw: 2.5px;
    --bw-hair: 1.5px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--ink); color: var(--text); min-height: 100vh; }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  /* Background grain */
  body::before {
    content: ''; position: fixed; inset: 0; pointer-events: none; z-index: -1;
    background-image:
      linear-gradient(0deg, transparent 97%, rgba(255,255,255,0.025) 97%, rgba(255,255,255,0.025) 100%),
      linear-gradient(90deg, transparent 97%, rgba(255,255,255,0.025) 97%, rgba(255,255,255,0.025) 100%);
    background-size: 48px 48px;
    opacity: 0.6;
  }

  a { color: inherit; text-decoration: none; }
  button { font-family: inherit; cursor: pointer; }

  .display {
    font-family: 'Space Grotesk', 'Archivo Black', system-ui, sans-serif;
    font-weight: 700;
    letter-spacing: -0.035em;
  }
  .display-hv {
    font-family: 'Archivo Black', 'Space Grotesk', system-ui, sans-serif;
    font-weight: 900;
    letter-spacing: -0.04em;
  }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .kicker {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--text-dim);
  }

  /* ═══════════════════════════════════════════════════════════════
     Shared primitives
     ═══════════════════════════════════════════════════════════════ */

  /* Chunky neo-brutal card on dark background */
  .nb-card {
    background: var(--ink-2);
    border: var(--bw) solid var(--white);
    box-shadow: var(--sh-white);
    transition: transform .15s cubic-bezier(0.22, 1, 0.36, 1), box-shadow .15s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .nb-card--paper {
    background: var(--paper);
    color: var(--text-inverse);
    border-color: #000;
    box-shadow: var(--sh-yellow);
  }
  .nb-card--white {
    background: var(--white);
    color: var(--text-inverse);
    border-color: #000;
    box-shadow: var(--sh-black);
  }
  .nb-card--yellow {
    background: var(--yellow);
    color: var(--text-inverse);
    border-color: #000;
    box-shadow: var(--sh-black);
  }
  .nb-card--lime   { background: var(--lime);     color: var(--text-inverse); border-color: #000; box-shadow: var(--sh-black); }
  .nb-card--coral  { background: var(--coral);    color: var(--text-inverse); border-color: #000; box-shadow: var(--sh-black); }
  .nb-card--sky    { background: var(--sky);      color: var(--text-inverse); border-color: #000; box-shadow: var(--sh-black); }

  .nb-hover {
    cursor: pointer;
  }
  .nb-hover:hover {
    transform: translate(-3px, -3px);
    box-shadow: 10px 10px 0 rgba(255,255,255,0.28);
  }
  .nb-card--paper.nb-hover:hover,
  .nb-card--white.nb-hover:hover,
  .nb-card--yellow.nb-hover:hover,
  .nb-card--lime.nb-hover:hover,
  .nb-card--coral.nb-hover:hover,
  .nb-card--sky.nb-hover:hover {
    box-shadow: 9px 9px 0 #000;
  }

  /* Buttons */
  .nb-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    padding: 14px 22px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700; font-size: 14px;
    letter-spacing: 0.06em; text-transform: uppercase;
    border: var(--bw) solid #000;
    color: #000;
    background: var(--yellow);
    box-shadow: var(--sh-black);
    transition: transform .12s ease, box-shadow .12s ease;
    white-space: nowrap;
  }
  .nb-btn:hover:not(:disabled) {
    transform: translate(-2px, -2px);
    box-shadow: 8px 8px 0 #000;
  }
  .nb-btn:active:not(:disabled) {
    transform: translate(2px, 2px);
    box-shadow: 2px 2px 0 #000;
  }
  .nb-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .nb-btn--lime    { background: var(--lime); }
  .nb-btn--coral   { background: var(--coral); color: #000; }
  .nb-btn--white   { background: var(--white); }
  .nb-btn--ink     { background: var(--ink); color: var(--white); border-color: var(--white); box-shadow: var(--sh-white-sm); }
  .nb-btn--ink:hover:not(:disabled) { box-shadow: 6px 6px 0 rgba(255,255,255,0.3); }
  .nb-btn--ink:active:not(:disabled) { box-shadow: 1px 1px 0 rgba(255,255,255,0.2); }
  .nb-btn--ghost   { background: transparent; color: var(--white); border-color: var(--white); box-shadow: var(--sh-white-sm); }
  .nb-btn--ghost:hover:not(:disabled) { box-shadow: 6px 6px 0 rgba(255,255,255,0.3); background: rgba(255,255,255,0.04); }
  .nb-btn--ghost:active:not(:disabled) { box-shadow: 1px 1px 0 rgba(255,255,255,0.2); }

  .nb-btn--full { width: 100%; padding: 18px 22px; font-size: 15px; }

  /* Inputs — high contrast neo-brutal: WHITE bg, BLACK text, hard border */
  .nb-input {
    width: 100%;
    padding: 14px 16px;
    font-family: 'Inter', sans-serif;
    font-size: 15px; font-weight: 500;
    color: #000;
    background: #fff;
    border: var(--bw) solid #000;
    outline: none;
    transition: box-shadow .12s ease, transform .12s ease;
    box-shadow: var(--sh-black-sm);
  }
  .nb-input::placeholder { color: #888; font-weight: 400; }
  .nb-input:focus {
    box-shadow: 5px 5px 0 var(--yellow), 5px 5px 0 2.5px #000;
    transform: translate(-1px, -1px);
  }
  .nb-input.is-error {
    box-shadow: 5px 5px 0 var(--red), 5px 5px 0 2.5px #000;
    animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97);
  }

  /* Pill badges */
  .pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase;
    border: 1.5px solid #000;
  }
  .pill--yellow { background: var(--yellow); color: #000; }
  .pill--lime   { background: var(--lime);   color: #000; }
  .pill--coral  { background: var(--coral);  color: #000; }
  .pill--white  { background: var(--white);  color: #000; }
  .pill--red    { background: var(--red);    color: #000; border-color: #000; }
  .pill--ghost  { background: var(--ink-2);  color: var(--text); border-color: var(--white); }
  .pill .live-dot {
    width: 7px; height: 7px; background: #000; border-radius: 0;
    animation: blink 1.2s ease-in-out infinite;
  }
  .pill--red .live-dot { background: #000; }

  /* ═══════════════════════════════════════════════════════════════
     Animations
     ═══════════════════════════════════════════════════════════════ */
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
  @keyframes shake {
    10%, 90%  { transform: translate(-1px, 0); }
    20%, 80%  { transform: translate(2px, 0); }
    30%, 50%, 70% { transform: translate(-4px, 0); }
    40%, 60% { transform: translate(4px, 0); }
  }
  @keyframes pulseBg {
    0%, 100% { background-color: var(--yellow); }
    50% { background-color: #FACC15; }
  }
  @keyframes scroll-ticker {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pipeFlow { to { background-position: 40px 0; } }

  .reveal { opacity: 0; transform: translateY(10px); transition: opacity .5s cubic-bezier(0.22, 1, 0.36, 1), transform .5s cubic-bezier(0.22, 1, 0.36, 1); }
  .reveal.in { opacity: 1; transform: none; }

  /* ═══════════════════════════════════════════════════════════════
     Header
     ═══════════════════════════════════════════════════════════════ */
  .nav {
    position: sticky; top: 0; z-index: 100;
    background: var(--ink);
    border-bottom: var(--bw) solid var(--white);
    padding: 16px 32px;
    display: flex; align-items: center; gap: 24px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark {
    width: 38px; height: 38px;
    background: var(--yellow);
    border: 2.5px solid var(--white);
    display: grid; place-items: center;
    box-shadow: 3px 3px 0 var(--white);
  }
  .brand-mark-inner {
    font-family: 'Archivo Black', sans-serif;
    font-size: 22px; color: #000; letter-spacing: -0.05em;
  }
  .brand-text .brand-name {
    font-family: 'Archivo Black', sans-serif;
    font-size: 18px; letter-spacing: -0.03em;
    color: var(--white);
    line-height: 1;
  }
  .brand-text .brand-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 600;
    color: var(--text-dim); letter-spacing: 0.18em;
    text-transform: uppercase; margin-top: 3px;
  }
  .nav-links {
    display: none; align-items: center; gap: 28px;
    margin-left: 40px;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 13px; font-weight: 600;
    letter-spacing: 0.05em; text-transform: uppercase;
  }
  .nav-links a { color: var(--text-dim); }
  .nav-links a:hover { color: var(--yellow); }
  @media (min-width: 900px) { .nav-links { display: flex; } }
  .nav-actions { margin-left: auto; display: flex; align-items: center; gap: 12px; }
  .treasury-chip {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    background: var(--ink-2);
    border: 2px solid var(--white);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; font-weight: 600;
    color: var(--lime);
    box-shadow: var(--sh-white-sm);
  }
  .treasury-chip__label {
    font-size: 9.5px; color: var(--text-dim); letter-spacing: 0.12em; text-transform: uppercase;
  }

  /* ═══════════════════════════════════════════════════════════════
     Ticker
     ═══════════════════════════════════════════════════════════════ */
  .ticker {
    height: 40px; overflow: hidden;
    background: var(--yellow);
    border-bottom: var(--bw) solid #000;
    display: flex; align-items: center;
    position: relative;
  }
  .ticker::before {
    content: 'LIVE';
    position: absolute; left: 0; top: 0; bottom: 0;
    display: grid; place-items: center;
    padding: 0 16px;
    background: #000; color: var(--yellow);
    font-family: 'Archivo Black', sans-serif;
    font-size: 13px; letter-spacing: 0.12em;
    border-right: var(--bw) solid #000;
    z-index: 2;
  }
  .ticker-track {
    padding-left: 88px;
    display: inline-flex; white-space: nowrap;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px; font-weight: 600; color: #000;
    animation: scroll-ticker 52s linear infinite;
  }
  .ticker-item { display: inline-flex; align-items: center; gap: 12px; padding-right: 56px; }
  .ticker-tag {
    display: inline-block;
    padding: 2px 7px;
    background: #000; color: var(--yellow);
    font-size: 10px; letter-spacing: 0.15em; font-weight: 700;
  }

  /* ═══════════════════════════════════════════════════════════════
     Hero
     ═══════════════════════════════════════════════════════════════ */
  .hero {
    padding: 72px 32px 48px;
    max-width: 1400px; margin: 0 auto;
    display: grid; gap: 48px;
    grid-template-columns: 1fr;
  }
  @media (min-width: 1000px) { .hero { grid-template-columns: 1.6fr 1fr; } }

  .hero__kicker {
    display: inline-block;
    padding: 6px 12px;
    background: var(--yellow); color: #000;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase;
    border: 2px solid #000;
    box-shadow: 3px 3px 0 #000;
    margin-bottom: 28px;
  }
  .hero__title {
    font-family: 'Archivo Black', sans-serif;
    font-size: clamp(2.2rem, 6vw, 4.6rem);
    line-height: 0.95; letter-spacing: -0.045em;
    color: var(--white);
    margin-bottom: 20px;
  }
  .hero__title em {
    font-style: normal; display: inline-block;
    padding: 0 8px;
    background: var(--yellow); color: #000;
    transform: rotate(-1deg);
  }
  .hero__sub {
    font-size: 17px; line-height: 1.55;
    color: var(--text-dim);
    max-width: 580px;
    margin-bottom: 36px;
  }
  .hero__ctas { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 40px; }
  .hero__stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
    max-width: 520px;
  }
  .hero-stat {
    padding: 14px 16px;
    background: var(--ink-2);
    border: 2px solid var(--white);
    box-shadow: var(--sh-white-sm);
  }
  .hero-stat__val {
    font-family: 'Archivo Black', sans-serif;
    font-size: 22px; color: var(--white);
    letter-spacing: -0.02em;
  }
  .hero-stat__lbl {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; color: var(--text-dim);
    letter-spacing: 0.14em; text-transform: uppercase;
    margin-top: 4px;
  }

  /* ON AIR module (right rail) */
  .onair {
    background: var(--yellow);
    color: #000;
    border: 2.5px solid #000;
    box-shadow: 9px 9px 0 var(--white);
    padding: 28px 24px;
    position: relative;
    overflow: hidden;
  }
  .onair::before {
    content: ''; position: absolute; inset: 10px;
    border: 1.5px dashed #000;
    pointer-events: none;
  }
  .onair__head {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase;
  }
  .onair__light {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--red);
    border: 2px solid #000;
    box-shadow: 0 0 0 3px var(--yellow), 0 0 0 5px #000;
    animation: blink 1.1s ease-in-out infinite;
  }
  .onair__title {
    font-family: 'Archivo Black', sans-serif;
    font-size: 54px; line-height: 0.9; letter-spacing: -0.05em;
    margin: 8px 0 14px;
  }
  .onair__channel {
    display: flex; align-items: center; justify-content: space-between;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; font-weight: 700;
    padding-top: 14px;
    border-top: 2px solid #000;
  }
  .onair__latest {
    margin-top: 18px;
    padding: 14px;
    background: #fff;
    border: 2.5px solid #000;
    box-shadow: 4px 4px 0 #000;
  }
  .onair__latest-kicker {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: #000;
    margin-bottom: 6px;
    display: inline-block;
    padding: 2px 6px;
    background: var(--red);
    border: 1.5px solid #000;
  }
  .onair__latest-head {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700; font-size: 15px;
    line-height: 1.25; letter-spacing: -0.02em;
    color: #000;
  }

  /* ═══════════════════════════════════════════════════════════════
     Section scaffolding
     ═══════════════════════════════════════════════════════════════ */
  .sec {
    padding: 56px 32px;
    max-width: 1400px; margin: 0 auto;
  }
  .sec--tight { padding: 24px 32px 56px; }
  .sec-head {
    display: flex; align-items: flex-end; justify-content: space-between;
    margin-bottom: 28px; gap: 20px; flex-wrap: wrap;
  }
  .sec-head__l .kicker { margin-bottom: 10px; }
  .sec-head__title {
    font-family: 'Archivo Black', sans-serif;
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    letter-spacing: -0.035em; color: var(--white);
    line-height: 0.95;
  }
  .sec-head__sub {
    font-size: 14px; color: var(--text-dim);
    max-width: 480px; margin-top: 6px;
  }

  /* ═══════════════════════════════════════════════════════════════
     Commission panel
     ═══════════════════════════════════════════════════════════════ */
  .commission-grid {
    display: grid; gap: 24px;
    grid-template-columns: 1fr;
  }
  @media (min-width: 920px) {
    .commission-grid { grid-template-columns: 0.95fr 1.1fr; }
  }

  .comm-editorial {
    background: var(--paper);
    color: var(--text-inverse);
    border: 2.5px solid #000;
    box-shadow: var(--sh-yellow);
    padding: 32px 28px;
    position: relative;
  }
  .comm-editorial__kicker {
    display: inline-block;
    padding: 4px 10px;
    background: #000; color: var(--yellow);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase;
    margin-bottom: 14px;
  }
  .comm-editorial__title {
    font-family: 'Archivo Black', sans-serif;
    font-size: 32px; line-height: 0.95; letter-spacing: -0.035em;
    margin-bottom: 12px;
  }
  .comm-editorial__body {
    font-size: 14px; line-height: 1.55;
    color: #222;
    margin-bottom: 20px;
  }
  .comm-rules {
    display: grid; gap: 10px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 2.5px dashed #000;
  }
  .comm-rule {
    display: flex; align-items: flex-start; gap: 10px;
    font-size: 13.5px; font-weight: 500;
  }
  .comm-rule__n {
    flex-shrink: 0;
    width: 22px; height: 22px;
    background: #000; color: var(--yellow);
    display: grid; place-items: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 700;
  }

  .comm-form {
    background: var(--white);
    color: var(--text-inverse);
    border: 2.5px solid #000;
    box-shadow: var(--sh-black);
    padding: 30px 28px;
  }
  .comm-form__head {
    display: flex; align-items: center; gap: 14px;
    margin-bottom: 24px;
    padding-bottom: 18px;
    border-bottom: 2.5px solid #000;
  }
  .comm-form__num {
    width: 46px; height: 46px;
    background: var(--yellow);
    border: 2.5px solid #000;
    display: grid; place-items: center;
    font-family: 'Archivo Black', sans-serif;
    font-size: 22px;
    box-shadow: 3px 3px 0 #000;
  }
  .comm-form__title {
    font-family: 'Archivo Black', sans-serif;
    font-size: 22px; letter-spacing: -0.03em;
    line-height: 1.05;
  }
  .comm-form__sub {
    font-size: 12.5px; color: #555; margin-top: 3px;
    font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.06em;
  }

  .field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .field-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: #000;
    display: flex; align-items: center; gap: 8px;
  }
  .field-hint {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 600;
    letter-spacing: 0.08em;
    padding: 2px 7px;
    background: var(--lime); color: #000;
    border: 1.5px solid #000;
    text-transform: none;
  }

  .breakdown {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 0;
    margin: 20px 0;
    border: 2.5px solid #000;
  }
  @media (min-width: 640px) {
    .breakdown { grid-template-columns: repeat(4, 1fr); }
  }
  .breakdown > div {
    padding: 12px 14px;
    background: var(--paper);
    border-right: 2px solid #000;
    border-bottom: 2px solid #000;
  }
  .breakdown > div:last-child { border-right: 0; }
  @media (min-width: 640px) {
    .breakdown > div:nth-child(4) { border-right: 0; }
    .breakdown > div { border-bottom: 0; }
  }
  .breakdown > div:nth-child(2n) { background: var(--paper-2); }
  .breakdown-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: #333; margin-bottom: 5px;
  }
  .breakdown-value {
    font-family: 'Archivo Black', sans-serif;
    font-size: 20px; letter-spacing: -0.02em;
    color: #000;
  }
  .breakdown-value--accent {
    background: var(--lime); display: inline-block;
    padding: 2px 7px; border: 1.5px solid #000;
    font-size: 16px;
  }

  /* Pending + refund */
  .pending-box {
    padding: 28px 24px; text-align: center;
    background: var(--yellow); color: #000;
    border: 2.5px solid #000;
    box-shadow: var(--sh-black);
  }
  .refund-box {
    padding: 20px 22px;
    background: var(--coral); color: #000;
    border: 2.5px solid #000;
    box-shadow: var(--sh-black);
    display: flex; gap: 16px; align-items: flex-start;
  }

  /* ═══════════════════════════════════════════════════════════════
     Featured broadcast (hero panel)
     ═══════════════════════════════════════════════════════════════ */
  .featured {
    background: var(--white); color: #000;
    border: 2.5px solid #000;
    box-shadow: var(--sh-yellow);
    padding: 40px 32px;
    display: grid; gap: 32px;
    grid-template-columns: 1fr;
  }
  @media (min-width: 900px) {
    .featured { grid-template-columns: 1.2fr 1fr; align-items: center; }
  }
  .featured__poster {
    aspect-ratio: 16/9;
    background: #000;
    border: 2.5px solid #000;
    box-shadow: 6px 6px 0 var(--yellow);
    position: relative;
    display: grid; place-items: center;
    overflow: hidden;
  }
  .featured__poster-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(var(--yellow) 1px, transparent 1px),
      linear-gradient(90deg, var(--yellow) 1px, transparent 1px);
    background-size: 32px 32px;
    opacity: 0.15;
  }
  .featured__play {
    width: 84px; height: 84px;
    background: var(--yellow);
    border: 3px solid #000;
    display: grid; place-items: center;
    box-shadow: 5px 5px 0 #000;
    position: relative; z-index: 2;
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .featured__play:hover { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 #000; }
  .featured__kicker {
    display: inline-block;
    padding: 4px 10px;
    background: var(--red); color: #000;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase;
    margin-bottom: 14px;
    border: 2px solid #000;
  }
  .featured__headline {
    font-family: 'Archivo Black', sans-serif;
    font-size: clamp(1.6rem, 3vw, 2.4rem);
    letter-spacing: -0.035em; line-height: 1;
    margin-bottom: 16px;
  }
  .featured__meta {
    display: flex; gap: 18px; flex-wrap: wrap;
    margin-bottom: 24px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; font-weight: 500;
    color: #444;
  }
  .featured__meta strong { color: #000; font-weight: 700; }

  /* ═══════════════════════════════════════════════════════════════
     Broadcast archive grid
     ═══════════════════════════════════════════════════════════════ */
  .archive-grid {
    display: grid; gap: 20px;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
  .bcast-card {
    padding: 22px 22px 20px;
    border: 2.5px solid #000;
    box-shadow: var(--sh-black);
    transition: transform .15s ease, box-shadow .15s ease;
    cursor: default;
    display: flex; flex-direction: column; gap: 12px;
    min-height: 260px;
    color: #000;
  }
  .bcast-card:hover { transform: translate(-3px, -3px); box-shadow: 9px 9px 0 #000; }
  .bcast-card--yellow   { background: var(--yellow); }
  .bcast-card--lime     { background: var(--lime); }
  .bcast-card--coral    { background: var(--coral); }
  .bcast-card--sky      { background: var(--sky); }
  .bcast-card--lavender { background: var(--lavender); }
  .bcast-card--paper    { background: var(--paper); }
  .bcast-card__top {
    display: flex; justify-content: space-between; align-items: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase;
  }
  .bcast-num { padding: 3px 7px; background: #000; color: #fff; }
  .bcast-headline {
    font-family: 'Archivo Black', sans-serif;
    font-size: 18px; line-height: 1.1;
    letter-spacing: -0.025em;
    flex-grow: 1;
  }
  .bcast-meta {
    display: flex; justify-content: space-between; align-items: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px; font-weight: 600;
    padding-top: 10px;
    border-top: 1.5px dashed #000;
  }
  .bcast-topic { color: #333; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bcast-cost { font-weight: 700; }
  .bcast-watch {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    background: #000; color: #fff;
    border: 2px solid #000;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase;
    box-shadow: 3px 3px 0 rgba(0,0,0,0.4);
    transition: transform .1s ease;
  }
  .bcast-watch:hover { background: #fff; color: #000; transform: translate(-1px, -1px); }

  /* ═══════════════════════════════════════════════════════════════
     Pipeline (live)
     ═══════════════════════════════════════════════════════════════ */
  .pipeline-panel {
    background: var(--ink-2);
    border: 2.5px solid var(--white);
    box-shadow: var(--sh-white);
    padding: 28px;
  }
  .pipeline {
    display: flex; align-items: stretch; gap: 0;
    overflow-x: auto; padding: 4px 2px 14px;
  }
  .pipe-card {
    flex-shrink: 0; width: 150px;
    padding: 14px 14px 16px;
    border: 2.5px solid #000;
    box-shadow: 4px 4px 0 #fff;
    position: relative;
    display: flex; flex-direction: column; gap: 6px;
    transition: transform .25s ease, box-shadow .25s ease;
    color: #000;
  }
  .pipe-card--yellow   { background: var(--yellow); }
  .pipe-card--lime     { background: var(--lime); }
  .pipe-card--coral    { background: var(--coral); }
  .pipe-card--sky      { background: var(--sky); }
  .pipe-card--lavender { background: var(--lavender); }
  .pipe-card--paper    { background: var(--paper); }

  .pipe-card__head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 4px;
  }
  .pipe-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.12em;
    padding: 2px 5px;
    background: #000; color: #fff;
  }
  .pipe-dot {
    width: 10px; height: 10px;
    background: #000; opacity: 0.25;
    border: 1.5px solid #000;
  }
  .pipe-card.running .pipe-dot { background: var(--red); opacity: 1; animation: blink 0.9s ease-in-out infinite; }
  .pipe-card.done    .pipe-dot { background: #000; opacity: 1; }
  .pipe-icon { color: #000; margin: 4px 0; }
  .pipe-icon svg { width: 26px; height: 26px; }
  .pipe-label {
    font-family: 'Archivo Black', sans-serif;
    font-size: 15px; letter-spacing: -0.02em;
    line-height: 1;
  }
  .pipe-role {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 600; opacity: 0.8;
    letter-spacing: 0.1em; text-transform: uppercase;
  }
  .pipe-api {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px; font-weight: 700;
    padding: 2px 6px;
    background: rgba(0,0,0,0.1);
    border: 1.5px solid #000;
    align-self: flex-start;
  }
  .pipe-earn {
    font-family: 'Archivo Black', sans-serif;
    font-size: 13px; letter-spacing: 0.02em;
    margin-top: 4px;
  }
  .pipe-autonomy {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase;
    border: 1.5px solid #000;
    margin-top: 4px;
  }
  .pipe-autonomy--auto { background: #000; color: var(--lime); }
  .pipe-autonomy--orch { background: rgba(0,0,0,0.12); color: #000; }
  .pipe-autonomy__dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: currentColor;
  }
  .pipe-autonomy--auto .pipe-autonomy__dot { animation: blink 1.6s ease-in-out infinite; }

  .wallet-autonomy {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase;
    border: 1.5px solid currentColor;
    margin-top: 6px;
  }
  .wallet-autonomy--auto { color: var(--lime); }
  .wallet-autonomy--orch { color: var(--text-dim); }
  .pipe-card.running { transform: translate(-3px, -3px); box-shadow: 7px 7px 0 var(--yellow); }
  .pipe-card.done { opacity: 0.94; }

  .pipe-connector {
    flex-shrink: 0; width: 40px;
    align-self: center;
    display: flex; align-items: center; justify-content: center;
    margin: 0 -4px;
    position: relative; z-index: 0;
  }
  .pipe-line {
    flex: 1; height: 3px; background: #fff; opacity: 0.28;
  }
  .pipe-arrow {
    position: absolute;
    color: #fff; opacity: 0.35;
    font-size: 11px;
  }
  .pipe-connector.active .pipe-line {
    opacity: 1;
    background: repeating-linear-gradient(90deg, var(--yellow) 0 8px, #000 8px 16px);
    background-size: 40px 3px;
    animation: pipeFlow 0.8s linear infinite;
  }
  .pipe-connector.active .pipe-arrow { color: var(--yellow); opacity: 1; }

  /* Terminal */
  .terminal {
    background: #000;
    border: 2.5px solid var(--white);
    box-shadow: 4px 4px 0 var(--yellow);
    margin-top: 28px;
    overflow: hidden;
  }
  .term-head {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    background: var(--ink-2);
    border-bottom: 2px solid var(--white);
  }
  .term-head__title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.12em; text-transform: uppercase;
    flex: 1; text-align: center;
  }
  .term-head__timer {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 700;
    color: var(--yellow);
    padding: 2px 7px; background: #000;
    border: 1.5px solid var(--yellow);
  }
  .term-dots { display: flex; gap: 6px; }
  .term-dot { width: 11px; height: 11px; border: 1.5px solid #000; }
  .td-r { background: var(--red); }
  .td-y { background: var(--yellow); }
  .td-g { background: var(--lime); }
  .term-body {
    padding: 14px 16px;
    min-height: 180px; max-height: 360px;
    overflow-y: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px; line-height: 1.65;
    color: #ededed;
  }
  .log-line { padding: 0; }
  .log-line.dim { color: #7a7a75; }
  .log-line.err { color: var(--coral); }
  .stream-agent {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--yellow);
    margin-right: 8px; font-weight: 700;
  }
  .stream-agent svg { width: 11px; height: 11px; }

  /* ═══════════════════════════════════════════════════════════════
     Agent Council — chat stream with avatars & bubbles
     ═══════════════════════════════════════════════════════════════ */
  .council-panel {
    background: var(--paper); color: #000;
    border: 2.5px solid #000;
    box-shadow: 6px 6px 0 var(--yellow);
    overflow: hidden;
    margin-top: 20px;
  }
  .council-head {
    padding: 14px 20px;
    background: #000; color: var(--yellow);
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; flex-wrap: wrap;
    border-bottom: 2.5px solid #000;
  }
  .council-title {
    font-family: 'Archivo Black', sans-serif;
    font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase;
  }
  .council-badge {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 4px 9px;
    background: var(--yellow); color: #000;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase;
    border: 1.5px solid var(--yellow);
  }
  .council-badge .live-dot { background: #000; }

  /* Avatar strip */
  .council-avatars {
    padding: 14px 20px;
    background: var(--paper-2);
    border-bottom: 2.5px solid #000;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  }
  .avatar {
    width: 38px; height: 38px;
    border: 2.5px solid #000;
    display: grid; place-items: center;
    font-family: 'Archivo Black', sans-serif;
    font-size: 17px; color: #000;
    box-shadow: 3px 3px 0 #000;
    position: relative;
    transition: transform .15s ease;
  }
  .avatar.talking {
    transform: translate(-1px, -1px);
    animation: avatarPulse 1s ease-in-out infinite;
  }
  .avatar-yellow   { background: var(--yellow); }
  .avatar-lime     { background: var(--lime); }
  .avatar-coral    { background: var(--coral); }
  .avatar-sky      { background: var(--sky); }
  .avatar-lavender { background: var(--lavender); }
  .avatar-paper    { background: var(--paper); }
  .avatar-black    { background: #000; color: var(--yellow); }
  .avatar::after {
    content: ''; position: absolute;
    bottom: -3px; right: -3px;
    width: 10px; height: 10px;
    border: 2px solid #000;
    background: rgba(0,0,0,0.2);
  }
  .avatar.talking::after { background: var(--red); animation: blink 0.9s infinite; }

  @keyframes avatarPulse {
    0%, 100% { box-shadow: 3px 3px 0 #000; }
    50%      { box-shadow: 5px 5px 0 #000; }
  }

  /* Budget bar */
  .budget-bar {
    padding: 12px 20px;
    background: #fff;
    border-bottom: 2.5px solid #000;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px; font-weight: 700;
    color: #000;
    display: flex; gap: 14px; flex-wrap: wrap; align-items: center;
  }
  .budget-chip {
    padding: 3px 8px;
    background: var(--paper);
    border: 1.5px solid #000;
    box-shadow: 2px 2px 0 #000;
    font-size: 11px;
  }
  .budget-chip.live { background: var(--yellow); }

  /* Chat stream */
  .chat-stream {
    padding: 20px 20px 24px;
    min-height: 180px; max-height: 520px;
    overflow-y: auto;
    background: var(--paper);
    display: flex; flex-direction: column; gap: 14px;
  }
  .chat-empty {
    padding: 40px 20px; text-align: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; color: #666;
  }

  .chat-row {
    display: flex; gap: 12px; align-items: flex-start;
    animation: chatIn 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes chatIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }

  .chat-avatar {
    width: 34px; height: 34px; flex-shrink: 0;
    border: 2.5px solid #000;
    display: grid; place-items: center;
    font-family: 'Archivo Black', sans-serif;
    font-size: 15px; color: #000;
    box-shadow: 3px 3px 0 #000;
    margin-top: 2px;
  }
  .chat-body { flex: 1; min-width: 0; }
  .chat-meta {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .chat-name {
    font-family: 'Archivo Black', sans-serif;
    font-size: 11.5px; letter-spacing: 0.08em;
    text-transform: uppercase; color: #000;
  }
  .chat-role {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; color: #555;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  .chat-ts {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; color: #888;
  }
  .chat-estimate {
    padding: 1px 6px;
    background: #000; color: var(--lime);
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.08em;
    border: 1.5px solid #000;
  }
  .chat-bubble {
    padding: 11px 14px;
    font-size: 14px; line-height: 1.45;
    border: 2.5px solid #000;
    box-shadow: 4px 4px 0 #000;
    color: #000;
    font-weight: 500;
    position: relative;
    display: inline-block; max-width: 100%;
  }
  .chat-row:nth-child(odd) .chat-bubble  { transform: rotate(-0.4deg); }
  .chat-row:nth-child(even) .chat-bubble { transform: rotate(0.3deg); }
  .chat-bubble.bg-yellow   { background: var(--yellow); }
  .chat-bubble.bg-lime     { background: var(--lime); }
  .chat-bubble.bg-coral    { background: var(--coral); }
  .chat-bubble.bg-sky      { background: var(--sky); }
  .chat-bubble.bg-lavender { background: var(--lavender); }
  .chat-bubble.bg-paper    { background: #fff; }
  .chat-bubble.bg-black    { background: #000; color: var(--yellow); }
  .chat-bubble.kind-error {
    background: var(--coral);
    box-shadow: 4px 4px 0 var(--red);
  }
  .chat-bubble.kind-recovery {
    border-style: dashed;
  }
  .chat-bubble.kind-handoff {
    font-style: italic;
    font-weight: 400;
  }
  .chat-bubble.kind-status {
    background: var(--paper-2); color: #666;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; padding: 6px 12px;
    box-shadow: 2px 2px 0 #000;
  }
  .chat-bubble.kind-money {
    background: var(--yellow);
    color: #000;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    padding: 10px 14px 10px 14px;
    border-color: #000;
    box-shadow: 5px 5px 0 #000;
    display: inline-flex; align-items: center; gap: 10px;
    animation: coinIn 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .chat-bubble.kind-money .coin {
    display: inline-grid; place-items: center;
    width: 24px; height: 24px;
    background: #fde047;
    border: 2px solid #000;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #fde047, inset -3px -3px 0 rgba(0,0,0,0.15);
    font-family: 'Archivo Black', sans-serif;
    font-size: 12px;
    animation: coinSpin 0.7s ease-in-out;
  }
  .chat-bubble.kind-money .money-amt {
    font-family: 'Archivo Black', sans-serif;
    font-size: 16px;
    letter-spacing: -0.01em;
  }
  .chat-bubble.kind-money .money-arrow { opacity: 0.6; }
  .chat-bubble.kind-money .money-to {
    padding: 2px 7px;
    background: #000; color: var(--yellow);
    font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  @keyframes coinIn {
    0%   { opacity: 0; transform: translateX(-20px) rotate(-3deg); }
    100% { opacity: 1; transform: none; }
  }
  @keyframes coinSpin {
    0%   { transform: rotateY(0deg)   scale(1); }
    30%  { transform: rotateY(180deg) scale(1.2); }
    60%  { transform: rotateY(360deg) scale(1.1); }
    100% { transform: rotateY(540deg) scale(1); }
  }

  .typing-dots {
    display: inline-flex; gap: 4px;
  }
  .typing-dots span {
    width: 6px; height: 6px; background: #666;
    border-radius: 50%;
    animation: typing 1.2s ease-in-out infinite;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.15s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes typing {
    0%, 100% { opacity: 0.3; transform: translateY(0); }
    50%      { opacity: 1; transform: translateY(-3px); }
  }

  /* ═══════════════════════════════════════════════════════════════
     Video / Watch gate
     ═══════════════════════════════════════════════════════════════ */
  .video-shell {
    background: var(--white); color: #000;
    border: 2.5px solid #000;
    box-shadow: var(--sh-yellow);
    overflow: hidden;
  }
  .video-shell__head { padding: 22px 26px; border-bottom: 2.5px solid #000; }
  .video-headline {
    font-family: 'Archivo Black', sans-serif;
    font-size: 26px; letter-spacing: -0.03em;
    line-height: 1.05;
    margin-bottom: 6px;
  }
  .video-meta { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #555; }
  video { width: 100%; display: block; background: #000; }
  .payment-breakdown {
    padding: 16px 22px; border-top: 2.5px solid #000;
    display: flex; flex-wrap: wrap; gap: 10px;
    background: var(--paper);
  }
  .pay-item {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 5px 10px;
    background: var(--white); color: #000;
    border: 2px solid #000;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px; font-weight: 600;
  }
  .pay-item strong { color: #000; }
  .pay-amt { color: #14532d; font-weight: 700; }
  .pay-addr { color: #666; font-size: 10px; }

  .watch-gate {
    padding: 56px 32px; text-align: center;
    background: var(--lime); color: #000;
    border: 2.5px solid #000;
    box-shadow: var(--sh-black);
  }
  .watch-gate__lock {
    width: 76px; height: 76px; margin: 0 auto 18px;
    background: #000; color: var(--lime);
    border: 2.5px solid #000;
    box-shadow: 5px 5px 0 #fff;
    display: grid; place-items: center;
  }
  .watch-gate__lock svg { width: 34px; height: 34px; }
  .watch-gate__head {
    font-family: 'Archivo Black', sans-serif;
    font-size: 24px; letter-spacing: -0.03em;
    margin-bottom: 6px;
  }
  .watch-gate__sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px; color: #222; margin-bottom: 24px;
  }
  .watch-pending-msg {
    margin-top: 18px; min-height: 20px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; color: #222;
  }

  /* ═══════════════════════════════════════════════════════════════
     Treasury / Live economy
     ═══════════════════════════════════════════════════════════════ */
  .treasury-main {
    background: var(--yellow); color: #000;
    border: 2.5px solid #000;
    box-shadow: var(--sh-black-lg);
    padding: 28px 32px;
    display: grid; gap: 20px;
    grid-template-columns: 1fr;
    align-items: center;
    margin-bottom: 20px;
  }
  @media (min-width: 800px) { .treasury-main { grid-template-columns: auto 1fr auto; } }
  .treasury-main__icon {
    width: 60px; height: 60px;
    background: #000; color: var(--yellow);
    display: grid; place-items: center;
    border: 2.5px solid #000;
  }
  .treasury-main__icon svg { width: 28px; height: 28px; }
  .treasury-main__label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: #000;
  }
  .treasury-main__bal {
    font-family: 'Archivo Black', sans-serif;
    font-size: 44px; line-height: 1;
    letter-spacing: -0.035em;
    margin-top: 4px;
  }
  .treasury-main__addr {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; color: #000;
    margin-top: 4px;
  }
  .treasury-main__addr a { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
  .treasury-grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .wallet-card {
    background: var(--ink-2);
    border: 2.5px solid var(--white);
    box-shadow: var(--sh-white-sm);
    padding: 16px 18px;
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .wallet-card:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--yellow); }
  .wallet-card__top {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px;
  }
  .wallet-icon {
    width: 34px; height: 34px;
    background: var(--white); color: #000;
    display: grid; place-items: center;
    border: 2px solid var(--white);
  }
  .wallet-icon svg { width: 18px; height: 18px; }
  .wallet-link {
    display: inline-flex; align-items: center; gap: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px; color: var(--text-dim);
  }
  .wallet-link:hover { color: var(--yellow); }
  .wallet-label {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text-dim); margin-bottom: 3px;
  }
  .wallet-balance {
    font-family: 'Archivo Black', sans-serif;
    font-size: 22px; color: var(--lime);
    letter-spacing: -0.02em;
  }

  /* ═══════════════════════════════════════════════════════════════
     How it works
     ═══════════════════════════════════════════════════════════════ */
  .how-strip {
    background: var(--paper); color: #000;
    border-top: var(--bw) solid #000;
    border-bottom: var(--bw) solid #000;
  }
  .how-inner {
    max-width: 1400px; margin: 0 auto;
    padding: 56px 32px;
  }
  .how-title {
    font-family: 'Archivo Black', sans-serif;
    font-size: clamp(1.8rem, 4vw, 2.4rem);
    letter-spacing: -0.035em;
    margin-bottom: 32px;
  }
  .how-grid {
    display: grid; gap: 18px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .how-step {
    padding: 20px 22px;
    background: var(--white);
    border: 2.5px solid #000;
    box-shadow: 5px 5px 0 #000;
  }
  .how-num {
    font-family: 'Archivo Black', sans-serif;
    font-size: 34px; letter-spacing: -0.05em;
    color: var(--yellow);
    -webkit-text-stroke: 2px #000;
    line-height: 1; margin-bottom: 10px;
  }
  .how-title-sm {
    font-family: 'Archivo Black', sans-serif;
    font-size: 18px; letter-spacing: -0.025em;
    margin-bottom: 6px;
  }
  .how-body { font-size: 13.5px; color: #333; line-height: 1.55; }

  /* ═══════════════════════════════════════════════════════════════
     Footer
     ═══════════════════════════════════════════════════════════════ */
  footer.nb-foot {
    background: #000; color: var(--text);
    border-top: var(--bw) solid var(--white);
    padding: 40px 32px 32px;
  }
  .foot-inner {
    max-width: 1400px; margin: 0 auto;
    display: grid; gap: 28px;
    grid-template-columns: 1fr;
  }
  @media (min-width: 720px) {
    .foot-inner { grid-template-columns: 2fr 1fr 1fr 1fr; }
  }
  .foot-brand { display: flex; gap: 14px; align-items: center; }
  .foot-col h4 {
    font-family: 'Archivo Black', sans-serif;
    font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--yellow);
    margin-bottom: 12px;
  }
  .foot-col a { display: block; font-size: 13px; color: var(--text-dim); padding: 3px 0; }
  .foot-col a:hover { color: var(--yellow); }
  .foot-legal {
    max-width: 1400px; margin: 32px auto 0;
    padding-top: 20px; border-top: 1.5px solid rgba(255,255,255,0.12);
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 14px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; color: var(--text-low);
    letter-spacing: 0.08em;
  }

  /* Utility */
  .hidden { display: none !important; }
  .animate-spin { animation: spin 1s linear infinite; }

  /* Scrollbars */
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-track { background: var(--ink); }
  ::-webkit-scrollbar-thumb { background: var(--ink-3); border: 2px solid var(--ink); }
  ::-webkit-scrollbar-thumb:hover { background: var(--yellow); }

  /* ═══════════════════════════════════════════════════════════════
     Mode selector (commission form)
     ═══════════════════════════════════════════════════════════════ */
  .mode-selector {
    display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    margin-bottom: 20px;
  }
  .mode-card {
    padding: 16px 18px;
    border: 2.5px solid #000;
    box-shadow: 4px 4px 0 #000;
    cursor: pointer;
    transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
    background: var(--paper);
    color: #000;
    position: relative;
  }
  .mode-card:hover {
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0 #000;
  }
  .mode-card.selected {
    background: var(--yellow);
    box-shadow: 6px 6px 0 #000;
    transform: translate(-2px, -2px);
  }
  .mode-card__title {
    font-family: 'Archivo Black', sans-serif;
    font-size: 14px; letter-spacing: -0.02em;
    line-height: 1.15;
    margin-bottom: 10px;
  }
  .mode-card__bullets {
    list-style: none; padding: 0; margin: 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px; font-weight: 600;
    letter-spacing: 0.04em;
    color: #333;
    display: flex; flex-direction: column; gap: 4px;
  }
  .mode-card__bullets li::before {
    content: '—';
    margin-right: 6px;
    font-weight: 700;
  }
  .mode-card__radio {
    position: absolute; top: 12px; right: 12px;
    width: 18px; height: 18px;
    border: 2.5px solid #000;
    background: #fff;
    display: grid; place-items: center;
  }
  .mode-card.selected .mode-card__radio::after {
    content: '';
    width: 10px; height: 10px;
    background: #000;
  }

  /* ═══════════════════════════════════════════════════════════════
     Exclusive success card
     ═══════════════════════════════════════════════════════════════ */
  .exclusive-card {
    background: var(--yellow);
    color: #000;
    border: 2.5px solid #000;
    box-shadow: var(--sh-black-lg);
    padding: 40px 32px;
    text-align: center;
  }
  .exclusive-card__kicker {
    display: inline-block;
    padding: 5px 12px;
    background: #000; color: var(--yellow);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.16em; text-transform: uppercase;
    margin-bottom: 18px;
    border: 2px solid #000;
  }
  .exclusive-card__headline {
    font-family: 'Archivo Black', sans-serif;
    font-size: 28px; letter-spacing: -0.03em;
    line-height: 1.05;
    margin-bottom: 10px;
  }
  .exclusive-card__sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px; color: #222;
    margin-bottom: 28px;
    max-width: 480px; margin-left: auto; margin-right: auto;
  }
  .exclusive-card__actions {
    display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;
  }

  /* ═══════════════════════════════════════════════════════════════
     Preview player overlay
     ═══════════════════════════════════════════════════════════════ */
  .preview-overlay {
    position: absolute; bottom: 0; left: 0; right: 0;
    padding: 14px 20px;
    background: rgba(0,0,0,0.88);
    color: var(--yellow);
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px; font-weight: 700;
    letter-spacing: 0.08em;
    text-align: center;
    border-top: 2.5px solid var(--yellow);
    z-index: 10;
    display: none;
  }
  .preview-overlay.visible { display: block; }
  .preview-wrapper { position: relative; }

  /* ═══════════════════════════════════════════════════════════════
     Payouts section
     ═══════════════════════════════════════════════════════════════ */
  .payouts-list {
    display: flex; flex-direction: column; gap: 12px;
  }
  .payout-row {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 14px 18px;
    background: var(--ink-2);
    border: 2.5px solid var(--white);
    box-shadow: var(--sh-white-sm);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; font-weight: 600;
    color: var(--text);
  }
  .payout-status {
    padding: 4px 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase;
    border: 2px solid #000;
    color: #000;
  }
  .payout-status--pending  { background: var(--yellow); }
  .payout-status--sent     { background: var(--lime); }
  .payout-status--failed   { background: var(--coral); }
  .payout-amount {
    font-family: 'Archivo Black', sans-serif;
    font-size: 16px; color: var(--lime);
    letter-spacing: -0.02em;
  }
  .payout-addr { color: var(--text-dim); font-size: 11px; }
  .payout-reason { color: var(--text-dim); font-size: 11px; flex: 1; }
  .payout-tx a {
    color: var(--yellow);
    text-decoration: underline;
    text-underline-offset: 3px;
    font-size: 11px;
  }
  .payout-empty {
    padding: 32px 20px; text-align: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; color: var(--text-dim);
  }
</style>
</head>
<body>

<!-- ═══ NAV ═══ -->
<header class="nav">
  <div class="brand">
    <div class="brand-mark"><span class="brand-mark-inner">D</span></div>
    <div class="brand-text">
      <div class="brand-name">DISPATCH</div>
      <div class="brand-sub">Autonomous News Network</div>
    </div>
  </div>
  <nav class="nav-links">
    <a href="#broadcasts">Broadcasts</a>
    <a href="#commission">Commission</a>
    <a href="#economy">Live Economy</a>
    <a href="#how">How It Works</a>
  </nav>
  <div class="nav-actions">
    <div class="treasury-chip">
      <span class="treasury-chip__label">TREASURY</span>
      <strong id="header-bal-val">$—</strong>
    </div>
    <a href="#commission" class="nb-btn"><span>Commission</span>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
    </a>
  </div>
</header>

<!-- ═══ TICKER ═══ -->
<div class="ticker">
  <div class="ticker-track">
    ${tickerItemsHtml}${tickerItemsHtml}
  </div>
</div>

<!-- ═══ HERO ═══ -->
<section class="hero">
  <div class="reveal">
    <div class="hero__kicker">PROGRAMMING · NO. ${String(videoHistory.length + 1).padStart(3, "0")}</div>
    <h1 class="hero__title">The first <em>autonomous</em> news network where six AI agents collaborate on-chain.</h1>
    <p class="hero__sub">Commission a 90-second broadcast on any topic. Six autonomous agents — research, script, visuals, voice, music, edit — each paid in real USDC for their work. You earn 40&#37; of every view. Forever.</p>
    <div class="hero__ctas">
      <a href="#commission" class="nb-btn">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20"/></svg>
        Commission a broadcast
      </a>
      <a href="#broadcasts" class="nb-btn nb-btn--ghost">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Watch latest
      </a>
    </div>
    <div class="hero__stats">
      <div class="hero-stat">
        <div class="hero-stat__val mono">${videoHistory.length}</div>
        <div class="hero-stat__lbl">Broadcasts aired</div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat__val mono">6</div>
        <div class="hero-stat__lbl">AI agents</div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat__val mono" id="autonomy-stat">—/5</div>
        <div class="hero-stat__lbl">Autonomous agents</div>
      </div>
    </div>
  </div>

  <!-- ON AIR module -->
  <aside class="onair reveal">
    <div class="onair__head">
      <div class="onair__light"></div>
      <span>ON AIR · STUDIO ONE</span>
    </div>
    <div class="onair__title">BROAD<br/>CAST.</div>
    <div class="onair__channel">
      <span>CH 001</span>
      <span id="onair-time">—</span>
      <span>FREQ 96.5</span>
    </div>
    ${latest ? `
    <div class="onair__latest">
      <span class="onair__latest-kicker">NOW PLAYING</span>
      <div class="onair__latest-head">${escHtml(latest.headline)}</div>
    </div>` : `
    <div class="onair__latest">
      <span class="onair__latest-kicker">STANDBY</span>
      <div class="onair__latest-head">First broadcast awaits commission.</div>
    </div>`}
  </aside>
</section>

${latest ? `
<!-- ═══ FEATURED BROADCAST ═══ -->
<section class="sec sec--tight" id="broadcasts">
  <div class="sec-head">
    <div class="sec-head__l">
      <div class="kicker">Featured Broadcast</div>
      <h2 class="sec-head__title">Latest from the newsroom.</h2>
    </div>
    <div class="pill pill--yellow"><span class="live-dot"></span>Just aired</div>
  </div>
  <article class="featured reveal">
    <div class="featured__poster">
      <div class="featured__poster-grid"></div>
      <button class="featured__play" data-watch="${escHtml(latest.filename)}" data-comm="${escHtml(latest.commissionSessionId ?? "")}" aria-label="Play latest broadcast">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="#000"><path d="M8 5v14l11-7z"/></svg>
      </button>
    </div>
    <div>
      <div class="featured__kicker">● LIVE FROM DISPATCH</div>
      <h3 class="featured__headline">${escHtml(latest.headline)}</h3>
      <div class="featured__meta">
        <span><strong>AIRED</strong> · ${latest.createdAt.slice(0, 10)}</span>
        <span><strong>TOPIC</strong> · ${escHtml(latest.topic.slice(0, 60))}</span>
        <span><strong>COST</strong> · $${latest.cost.toFixed(4)}</span>
      </div>
      <button class="nb-btn nb-btn--lime" data-watch="${escHtml(latest.filename)}" data-comm="${escHtml(latest.commissionSessionId ?? "")}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Watch · $0.05 USDC
      </button>
    </div>
  </article>
</section>` : ""}

${videoHistory.length > 0 ? `
<!-- ═══ ARCHIVE GRID ═══ -->
<section class="sec">
  <div class="sec-head">
    <div class="sec-head__l">
      <div class="kicker">Archive</div>
      <h2 class="sec-head__title">All broadcasts · ${videoHistory.length}</h2>
      <p class="sec-head__sub">Every Dispatch broadcast is permanently archived on Base. Each view sends USDC to its commissioner.</p>
    </div>
  </div>
  <div class="archive-grid reveal">
    ${archiveCards}
  </div>
</section>` : ""}

<!-- ═══ COMMISSION ═══ -->
<section class="sec" id="commission">
  <div class="sec-head">
    <div class="sec-head__l">
      <div class="kicker">Commission</div>
      <h2 class="sec-head__title">Order a broadcast.</h2>
      <p class="sec-head__sub">$0.50 gets six agents to produce a 90-second video on your topic. You earn $0.02 on every subsequent view.</p>
    </div>
    <div class="pill pill--lime"><span class="live-dot"></span>Accepting commissions</div>
  </div>

  <div class="commission-grid">

    <!-- Left: editorial rules -->
    <aside class="comm-editorial reveal">
      <div class="comm-editorial__kicker">EDITORIAL · TERMS</div>
      <h3 class="comm-editorial__title">What you're buying.</h3>
      <p class="comm-editorial__body">Six autonomous AI agents handle the entire production pipeline. You set the topic and pay the commissioning fee; everything else — research, scripting, imagery, narration, score, final edit — happens without human intervention.</p>
      <div class="comm-rules">
        <div class="comm-rule"><div class="comm-rule__n">1</div><span>Pay <strong>$0.50 USDC</strong> via Locus Checkout to open the commission.</span></div>
        <div class="comm-rule"><div class="comm-rule__n">2</div><span>Pipeline runs autonomously in 2–4 minutes. Watch it live.</span></div>
        <div class="comm-rule"><div class="comm-rule__n">3</div><span>Video airs on the network. You own the commissioner rights.</span></div>
        <div class="comm-rule"><div class="comm-rule__n">4</div><span>Every $0.05 view pays <strong>$0.02</strong> to your wallet. Instantly. Forever.</span></div>
        <div class="comm-rule"><div class="comm-rule__n">5</div><span>Break-even at 25 views — then everything is pure yield.</span></div>
      </div>
    </aside>

    <!-- Right: form / pending / refund -->
    <div class="comm-form reveal" id="commission-card">

      <!-- Form state -->
      <div id="form-state">
        <div class="comm-form__head">
          <div class="comm-form__num">01</div>
          <div>
            <div class="comm-form__title">New broadcast commission</div>
            <div class="comm-form__sub">COMPLETE → PAY → PRODUCE</div>
          </div>
        </div>

        <div class="mode-selector" id="mode-selector" data-mode="public">
          <div class="mode-card selected" data-mode-value="public" onclick="selectMode('public')">
            <div class="mode-card__radio"></div>
            <div class="mode-card__title">PUBLIC BROADCAST · $0.50</div>
            <ul class="mode-card__bullets">
              <li>Airs on the network</li>
              <li>Earn 40% of each view</li>
              <li>Break-even at 25 views</li>
            </ul>
          </div>
          <div class="mode-card" data-mode-value="exclusive" onclick="selectMode('exclusive')">
            <div class="mode-card__radio"></div>
            <div class="mode-card__title">EXCLUSIVE · $2.00</div>
            <ul class="mode-card__bullets">
              <li>Private — never airs</li>
              <li>Full MP4 download</li>
              <li>Use it anywhere</li>
            </ul>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="topicInput">Topic</label>
          <input class="nb-input" type="text" id="topicInput" placeholder="e.g. AI agents reshaping global finance" />
        </div>
        <div class="field">
          <label class="field-label" for="walletInput">
            Your Locus wallet
            <span class="field-hint">earn 40% of views</span>
          </label>
          <input class="nb-input mono" type="text" id="walletInput" placeholder="0x…" />
        </div>

        <div id="breakdown-public" class="breakdown">
          <div>
            <div class="breakdown-label">Commission</div>
            <div class="breakdown-value">$0.50</div>
          </div>
          <div>
            <div class="breakdown-label">Agent payouts</div>
            <div class="breakdown-value">~$0.33</div>
          </div>
          <div>
            <div class="breakdown-label">Your share</div>
            <div class="breakdown-value"><span class="breakdown-value--accent">$0.02 / view</span></div>
          </div>
          <div>
            <div class="breakdown-label">Break-even</div>
            <div class="breakdown-value">25 views</div>
          </div>
        </div>

        <div id="breakdown-exclusive" class="breakdown hidden" style="grid-template-columns:1fr 1fr">
          <div>
            <div class="breakdown-label">Commission</div>
            <div class="breakdown-value">$2.00</div>
          </div>
          <div>
            <div class="breakdown-label">You get</div>
            <div class="breakdown-value"><span class="breakdown-value--accent">FULL OWNERSHIP</span></div>
          </div>
        </div>

        <button class="nb-btn nb-btn--full" id="commissionBtn" onclick="submitCommission()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20M7 15h2"/></svg>
          <span id="commissionBtnLabel">PAY &amp; COMMISSION · OPEN LOCUS CHECKOUT</span>
        </button>
      </div>

      <!-- Pending -->
      <div id="pending-state" class="hidden">
        <div class="pending-box">
          <div class="pill pill--red" style="margin-bottom:14px"><span class="live-dot"></span>Awaiting Payment</div>
          <div style="font-family:'Archivo Black',sans-serif;font-size:24px;letter-spacing:-0.03em;margin-bottom:16px" id="pending-topic-label"></div>
          <a id="checkout-link" href="#" target="_blank" class="nb-btn nb-btn--lime" style="margin-bottom:18px">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20"/></svg>
            OPEN LOCUS CHECKOUT · $0.50
          </a>
          <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#333;min-height:20px" id="pending-status-msg">Waiting…</div>
        </div>
      </div>

      <!-- Refund -->
      <div id="refund-state" class="hidden">
        <div class="refund-box">
          <div style="flex-shrink:0">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <div>
            <div style="font-family:'Archivo Black',sans-serif;font-size:18px;margin-bottom:6px">Pipeline failed</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:12.5px" id="refund-details">Contact support for a $0.50 refund.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ═══ LIVE PIPELINE (shown only during active job) ═══ -->
<section class="sec hidden" id="pipeline-section">
  <div class="sec-head">
    <div class="sec-head__l">
      <div class="kicker">Production · Live</div>
      <h2 class="sec-head__title">Agents are working.</h2>
      <p class="sec-head__sub" id="pipeline-topic-label"></p>
    </div>
    <div class="pill pill--red"><span class="live-dot"></span>On Air</div>
  </div>
  <div class="pipeline-panel">
    <div class="pipeline">${pipelineCards}</div>

    <!-- COUNCIL CHAT -->
    <div class="council-panel">
      <div class="council-head">
        <div class="council-title">The Council</div>
        <div class="council-badge"><span class="live-dot"></span>Agents are talking</div>
      </div>
      <div class="council-avatars">
        <div class="avatar avatar-yellow"   data-avatar="researcher"   title="Researcher">R</div>
        <div class="avatar avatar-lime"     data-avatar="scriptwriter" title="Scriptwriter">S</div>
        <div class="avatar avatar-coral"    data-avatar="visual"       title="Visual">V</div>
        <div class="avatar avatar-sky"      data-avatar="voice"        title="Voice">V</div>
        <div class="avatar avatar-lavender" data-avatar="music"        title="Music">M</div>
        <div class="avatar avatar-paper"    data-avatar="editor"       title="Editor">E</div>
        <div style="flex:1"></div>
        <div class="avatar avatar-black"    data-avatar="orchestrator" title="Orchestrator">O</div>
      </div>
      <div class="budget-bar" id="budget-bar">
        <span>COMMISSION POOL · $0.50</span>
        <span class="budget-chip" id="budget-reserved">RESERVED · $0.00</span>
        <span class="budget-chip live" id="budget-margin">MARGIN · $0.50</span>
      </div>
      <div class="chat-stream" id="chat-stream">
        <div class="chat-empty">Waiting for the council to convene…</div>
      </div>
    </div>

    <div class="terminal">
      <div class="term-head">
        <div class="term-dots">
          <div class="term-dot td-r"></div>
          <div class="term-dot td-y"></div>
          <div class="term-dot td-g"></div>
        </div>
        <div class="term-head__title">pipeline@dispatch</div>
        <div class="term-head__timer" id="elapsed-timer">0S</div>
      </div>
      <div class="term-body" id="terminal-body"></div>
    </div>
  </div>
</section>

<!-- ═══ VIDEO SECTION (post-pipeline) ═══ -->
<section class="sec hidden" id="video-section">
  <div class="sec-head">
    <div class="sec-head__l">
      <div class="kicker">Your broadcast</div>
      <h2 class="sec-head__title">Now playing.</h2>
    </div>
  </div>

  <div class="watch-gate" id="watch-gate">
    <div class="watch-gate__lock">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    </div>
    <div class="watch-gate__head" id="wg-headline">Broadcast ready</div>
    <div class="watch-gate__sub" id="wg-meta">Unlock this broadcast with a one-time $0.05 payment</div>
    <button class="nb-btn" id="wg-btn" onclick="watchCurrentVideo()">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      WATCH · $0.05 USDC
    </button>
    <div class="watch-pending-msg" id="watch-pending-msg"></div>
  </div>

  <div id="video-wrapper" class="hidden">
    <div class="video-shell">
      <div class="video-shell__head">
        <div class="pill pill--red" style="margin-bottom:10px"><span class="live-dot"></span>Now playing</div>
        <div class="video-headline" id="video-headline-text"></div>
        <div class="video-meta" id="video-meta-text"></div>
      </div>
      <video id="main-video" controls autoplay playsinline></video>
      <div class="payment-breakdown" id="payment-breakdown"></div>
    </div>
  </div>
</section>

<!-- ═══ LIVE ECONOMY ═══ -->
<section class="sec" id="economy">
  <div class="sec-head">
    <div class="sec-head__l">
      <div class="kicker">Live Economy</div>
      <h2 class="sec-head__title">Agent treasury, on-chain.</h2>
      <p class="sec-head__sub">Every commission pays real USDC to five agent wallets on Base. Balances are live from the chain.</p>
    </div>
    <button class="nb-btn nb-btn--ghost" onclick="loadBalances()" style="padding:10px 14px;font-size:12px">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
      Refresh
    </button>
  </div>

  <div class="treasury-main reveal">
    <div class="treasury-main__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="1"/><path d="M3 10h18M16 14h2"/></svg>
    </div>
    <div>
      <div class="treasury-main__label">Dispatch Main Treasury</div>
      <div class="treasury-main__bal" id="main-balance">$—</div>
      <div class="treasury-main__addr" id="main-address">loading…</div>
    </div>
    <div class="pill pill--yellow"><span class="live-dot"></span>On chain</div>
  </div>

  <div class="treasury-grid reveal">
    ${treasuryWallets}
  </div>

  <div style="margin-top:32px" class="reveal">
    <div class="sec-head" style="padding:0;margin-bottom:18px">
      <div class="sec-head__l">
        <div class="kicker">Payouts</div>
        <h2 class="sec-head__title" style="font-size:clamp(1.2rem,3vw,1.8rem)">On-chain transfers.</h2>
        <p class="sec-head__sub">Agent payouts and commissioner royalties settled on Base.</p>
      </div>
    </div>
    <div class="payouts-list" id="payouts-list">
      <div class="payout-empty">Loading payouts...</div>
    </div>
  </div>
</section>

<!-- ═══ HOW IT WORKS ═══ -->
<section class="how-strip" id="how">
  <div class="how-inner">
    <div class="kicker" style="margin-bottom:8px">The flow</div>
    <h2 class="how-title">How Dispatch works.</h2>
    <div class="how-grid">${howStepsHtml}</div>
  </div>
</section>

<!-- ═══ FOOTER ═══ -->
<footer class="nb-foot">
  <div class="foot-inner">
    <div>
      <div class="foot-brand">
        <div class="brand-mark"><span class="brand-mark-inner">D</span></div>
        <div>
          <div style="font-family:'Archivo Black',sans-serif;font-size:20px">DISPATCH</div>
          <div class="brand-sub">Autonomous AI News Network</div>
        </div>
      </div>
      <p style="margin-top:16px; font-size:13px; color:var(--text-dim); max-width:360px">Six AI agents. One broadcast. Settled on Base. Built for the Locus Paygentic Hackathon, 2026.</p>
    </div>
    <div class="foot-col">
      <h4>Network</h4>
      <a href="#broadcasts">Broadcasts</a>
      <a href="#commission">Commission</a>
      <a href="#economy">Live Economy</a>
      <a href="#how">How It Works</a>
    </div>
    <div class="foot-col">
      <h4>Infrastructure</h4>
      <a href="https://buildwithlocus.com" target="_blank">BuildWithLocus</a>
      <a href="https://paywithlocus.com" target="_blank">PayWithLocus</a>
      <a href="https://basescan.org" target="_blank">BaseScan</a>
    </div>
    <div class="foot-col">
      <h4>Station</h4>
      <a href="#">Press Kit</a>
      <a href="#">Editorial</a>
      <a href="https://github.com/cass-agency/dispatch" target="_blank">GitHub</a>
    </div>
  </div>
  <div class="foot-legal">
    <span>© DISPATCH 2026 · ALL BROADCASTS AUTONOMOUS</span>
    <span>SETTLED IN USDC ON BASE · POWERED BY LOCUS</span>
  </div>
</footer>

<script>
  // ═══ State ═══
  let currentCommissionId  = null;
  let currentWatchFilename = null;
  let currentWatchCommId   = null;
  let currentWatchSessionId = null;
  let commissionPollTimer  = null;
  let watchPollTimer       = null;
  let sseConn              = null;
  let startTime            = null;
  let timerInterval        = null;
  let mountedPipelineJobId = null; // prevents re-mount / auto-scroll loop on each poll

  // ═══ Mode selector ═══
  function selectMode(mode) {
    const selector = document.getElementById('mode-selector');
    if (selector) selector.dataset.mode = mode;
    document.querySelectorAll('.mode-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.modeValue === mode);
    });
    const brkPublic = document.getElementById('breakdown-public');
    const brkExclusive = document.getElementById('breakdown-exclusive');
    if (brkPublic) brkPublic.classList.toggle('hidden', mode === 'exclusive');
    if (brkExclusive) brkExclusive.classList.toggle('hidden', mode !== 'exclusive');
    const lbl = document.getElementById('commissionBtnLabel');
    if (lbl) {
      lbl.innerHTML = mode === 'exclusive'
        ? 'PAY &amp; COMMISSION · $2.00 EXCLUSIVE'
        : 'PAY &amp; COMMISSION · OPEN LOCUS CHECKOUT';
    }
  }
  window.selectMode = selectMode;

  const AGENT_SVG_MAP = {
    researcher:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg>',
    scriptwriter: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v5h6"/></svg>',
    visual:       '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="9" cy="9" r="1.6"/><path d="m21 16-5-5-9 9"/></svg>',
    voice:        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
    music:        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    editor:       '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20"/></svg>',
  };
  const agentSvg = (name) => AGENT_SVG_MAP[name] || '';

  // ═══ Odometer animation ═══
  function animateBalance(el, target) {
    if (!el) return;
    const current = parseFloat((el.dataset.val ?? '0')) || 0;
    const duration = 900;
    const start = performance.now();
    function tick(t) {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = current + (target - current) * eased;
      el.textContent = '$' + val.toFixed(2);
      if (p < 1) requestAnimationFrame(tick);
      else el.dataset.val = target;
    }
    requestAnimationFrame(tick);
  }

  // ═══ Init ═══
  window.addEventListener('DOMContentLoaded', () => {
    // Reveal entrances
    const reveals = document.querySelectorAll('.reveal');
    reveals.forEach((el, i) => setTimeout(() => el.classList.add('in'), 80 + i * 90));

    // Clock in ON AIR
    updateOnAirClock();
    setInterval(updateOnAirClock, 1000);

    loadBalances();
    setInterval(loadBalances, 30_000);
    loadAgentModes();
    loadPayouts();
    payoutTimer = setInterval(loadPayouts, 30_000);

    // Bind watch buttons (archive + featured)
    document.querySelectorAll('[data-watch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        watchVideo(btn.dataset.watch, btn.dataset.comm);
      });
    });

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('commissionId');
    if (sessionId) {
      resumeCommission(sessionId);
    }
  });

  // Eagerly probe a commission id from the URL and route to the right state,
  // or clear the URL if the commission is unknown / terminal.
  async function resumeCommission(sessionId) {
    try {
      const resp = await fetch('/commission/' + sessionId);
      if (resp.status === 404) {
        // Stale url (pre-deploy or wiped state) — reset to the form.
        history.replaceState(null, '', '/');
        return;
      }
      const data = await resp.json();
      currentCommissionId = sessionId;
      if (data.status === 'done') {
        // Try to claim the one-time free watch (only works if not already claimed)
        if (data.canClaimWatch) {
          try {
            const claimResp = await fetch('/commission/' + sessionId + '/claim-watch', { method: 'POST' });
            if (claimResp.ok) {
              const claimed = await claimResp.json();
              data.watchToken = claimed.watchToken;
            }
          } catch (e) {}
        }
        // If already claimed (409) or no token, show the watch gate (pay-to-view)
        showCommissionerVideo(data);
        return;
      }
      if (data.status === 'error' || data.status === 'refund_needed') {
        // Terminal — surface the correct state, clear the URL so a reload starts fresh.
        handleCommissionStatus(data);
        history.replaceState(null, '', '/');
        return;
      }
      if (data.status === 'generating') {
        mountedPipelineJobId = null; // force a clean mount on page load
        showPipelineSection(data.topic, data.jobId);
        startCommissionPoll(sessionId);
        return;
      }
      // pending_payment — show the pending card with the real checkout URL
      showPendingState(data.topic || 'Commission', data.checkoutUrl || '');
      startCommissionPoll(sessionId);
    } catch (e) {
      history.replaceState(null, '', '/');
    }
  }

  function updateOnAirClock() {
    const el = document.getElementById('onair-time');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ═══ Agent autonomy modes ═══
  async function loadAgentModes() {
    try {
      const resp = await fetch('/api/agent-modes');
      const data = await resp.json();
      if (!data.success) return;

      for (const m of data.modes) {
        // Pipeline cards
        const pipeCard = document.querySelector('[data-agent="' + m.agent + '"]');
        if (pipeCard) {
          const badge = pipeCard.querySelector('[data-autonomy-badge]');
          const label = pipeCard.querySelector('[data-autonomy-label]');
          if (badge && label) {
            badge.classList.remove('pipe-autonomy--auto', 'pipe-autonomy--orch');
            badge.classList.add(m.autonomous ? 'pipe-autonomy--auto' : 'pipe-autonomy--orch');
            label.textContent = m.autonomous ? 'AUTONOMOUS' : 'ORCHESTRATOR';
          }
        }

        // Wallet cards
        const walletBadge = document.querySelector('[data-wallet-autonomy][data-agent-name="' + m.agent + '"]');
        if (walletBadge) {
          const lbl = walletBadge.querySelector('[data-wallet-autonomy-label]');
          walletBadge.classList.remove('wallet-autonomy--auto', 'wallet-autonomy--orch');
          walletBadge.classList.add(m.autonomous ? 'wallet-autonomy--auto' : 'wallet-autonomy--orch');
          if (lbl) lbl.textContent = m.autonomous ? 'AUTONOMOUS · SELF-FUNDING' : 'ORCHESTRATOR-BILLED';
        }
      }

      // Update hero stat (agents aired + autonomy count)
      const autoChip = document.getElementById('autonomy-stat');
      if (autoChip) autoChip.textContent = data.autonomousCount + '/' + data.totalCount;
    } catch (e) {
      console.error('agent modes load failed:', e);
    }
  }

  // ═══ Treasury ═══
  async function loadBalances() {
    try {
      const resp = await fetch('/api/balance');
      const data = await resp.json();
      if (!data.success) return;
      const { main, agents } = data;

      const headerEl = document.getElementById('header-bal-val');
      if (headerEl) animateBalance(headerEl, main.balance);

      const mainEl = document.getElementById('main-balance');
      if (mainEl) animateBalance(mainEl, main.balance);

      const addrEl = document.getElementById('main-address');
      if (addrEl) addrEl.innerHTML = '<a href="https://basescan.org/address/' + main.address + '" target="_blank">' + main.address + '</a>';

      for (const a of agents) {
        const card = document.querySelector('[data-wallet="' + a.address + '"]');
        if (card) {
          const balEl = card.querySelector('[data-balance]');
          if (balEl) animateBalance(balEl, a.balance);
        }
      }
    } catch(e) {
      console.error('Balance load failed:', e);
    }
  }

  // ═══ Commission flow ═══
  async function submitCommission() {
    const topic  = document.getElementById('topicInput').value.trim();
    const wallet = document.getElementById('walletInput').value.trim();
    const btn    = document.getElementById('commissionBtn');
    const mode   = (document.getElementById('mode-selector') || {}).dataset.mode || 'public';

    if (!topic)  { flagError('topicInput'); return; }
    if (!wallet || !wallet.startsWith('0x') || wallet.length < 20) { flagError('walletInput'); return; }

    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9" stroke-opacity="0.3"/><path d="M12 3a9 9 0 0 1 9 9"/></svg><span>CREATING CHECKOUT…</span>';

    try {
      const resp = await fetch('/commission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, requesterAddress: wallet, mode })
      });
      const data = await resp.json();
      if (!data.sessionId) throw new Error(data.error || 'Commission creation failed');

      currentCommissionId = data.sessionId;
      history.replaceState(null, '', '/?commissionId=' + data.sessionId);
      showPendingState(topic, data.checkoutUrl);
      window.open(data.checkoutUrl, '_blank');
      startCommissionPoll(data.sessionId);
    } catch(e) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20M7 15h2"/></svg><span>PAY & COMMISSION · OPEN LOCUS CHECKOUT</span>';
      alert('Error: ' + e.message);
    }
  }

  function flagError(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('is-error');
    el.focus();
    setTimeout(() => el.classList.remove('is-error'), 800);
  }

  function showPendingState(topic, checkoutUrl) {
    document.getElementById('form-state').classList.add('hidden');
    document.getElementById('refund-state').classList.add('hidden');
    document.getElementById('pending-state').classList.remove('hidden');
    document.getElementById('pending-topic-label').textContent = '"' + topic + '"';
    if (checkoutUrl) document.getElementById('checkout-link').href = checkoutUrl;
    document.getElementById('pending-status-msg').textContent = 'Waiting for Locus payment confirmation…';
  }

  function startCommissionPoll(sessionId) {
    if (commissionPollTimer) clearInterval(commissionPollTimer);
    commissionPollTimer = setInterval(async () => {
      try {
        const resp = await fetch('/commission/' + sessionId);
        if (resp.status === 404) {
          clearInterval(commissionPollTimer);
          history.replaceState(null, '', '/');
          document.getElementById('pending-state').classList.add('hidden');
          document.getElementById('refund-state').classList.add('hidden');
          document.getElementById('form-state').classList.remove('hidden');
          return;
        }
        const data = await resp.json();
        handleCommissionStatus(data);
      } catch(e) {}
    }, 3000);
  }

  function handleCommissionStatus(data) {
    if (data.status === 'pending_payment') {
      document.getElementById('pending-status-msg').innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><svg class="animate-spin" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9" stroke-opacity="0.3"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>Checking Locus checkout…</span>';
    } else if (data.status === 'generating') {
      const msg = document.getElementById('pending-status-msg');
      if (msg) {
        msg.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;padding:4px 8px;background:#000;color:var(--lime);font-size:10.5px;font-weight:700;letter-spacing:0.12em"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 7"/></svg>PAYMENT CONFIRMED</span>'
          + (data.paymentTxHash
            ? ' <a style="color:#000;text-decoration:underline;text-underline-offset:3px;font-size:11px;margin-left:8px" href="https://basescan.org/tx/' + data.paymentTxHash + '" target="_blank">view tx</a>'
            : '');
      }
      setTimeout(() => {
        document.getElementById('pending-state').classList.add('hidden');
        showPipelineSection(data.topic, data.jobId);
      }, 900);
    } else if (data.status === 'done') {
      clearInterval(commissionPollTimer);
      if (sseConn) { sseConn.close(); sseConn = null; }
      clearInterval(timerInterval);
      mountedPipelineJobId = null;
      document.getElementById('pipeline-section').classList.add('hidden');

      // Claim the one-time free watch token (consumed on first call)
      if (data.canClaimWatch) {
        try {
          const claimResp = await fetch('/commission/' + data.sessionId + '/claim-watch', { method: 'POST' });
          if (claimResp.ok) {
            const claimed = await claimResp.json();
            data.watchToken = claimed.watchToken;
          }
        } catch (e) {}
      }
      showCommissionerVideo(data);
    } else if (data.status === 'refund_needed') {
      clearInterval(commissionPollTimer);
      document.getElementById('pending-state').classList.add('hidden');
      document.getElementById('refund-state').classList.remove('hidden');
      document.getElementById('refund-details').textContent  =
        'Pipeline failed twice. Contact us for a $0.50 refund. Session: ' + data.sessionId;
    } else if (data.status === 'error') {
      clearInterval(commissionPollTimer);
      document.getElementById('pending-status-msg').innerHTML = '<span style="color:#a00">Checkout expired or cancelled.</span> <a href="/" style="color:#000;text-decoration:underline">start over</a>';
    }
  }

  // ═══ Audio — coin sound via WebAudio (no external asset) ═══
  let _audioCtx = null;
  let _audioUnlocked = false;
  function unlockAudio() {
    if (_audioUnlocked) return;
    try {
      _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      _audioUnlocked = true;
    } catch (e) {}
  }
  // Unlock on first user interaction (browser autoplay policy)
  ['click','keydown','touchstart'].forEach(ev =>
    window.addEventListener(ev, unlockAudio, { once: true, passive: true })
  );

  function playCoinSound() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;

      // Two-note coin ding — mario-style
      const freqs = [1046.5, 1568.0];  // C6 → G6
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, t0 + i * 0.09);
        gain.gain.setValueAtTime(0.0001, t0 + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.09 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + i * 0.09);
        osc.stop(t0 + i * 0.09 + 0.2);
      });
    } catch (e) { /* silent fail */ }
  }

  // ═══ Council chat ═══
  const AGENT_INITIAL = {
    researcher: 'R', scriptwriter: 'S', visual: 'V', voice: 'V',
    music: 'M', editor: 'E', orchestrator: 'O', treasury: 'T',
  };
  let reservedTotal = 0;

  function resetCouncil() {
    const stream = document.getElementById('chat-stream');
    if (stream) stream.innerHTML = '<div class="chat-empty">Waiting for the council to convene…</div>';
    document.querySelectorAll('.avatar[data-avatar]').forEach(a => a.classList.remove('talking'));
    reservedTotal = 0;
    updateBudgetBar(0);
  }

  function updateBudgetBar(reserved) {
    const margin = Math.max(0, 0.50 - reserved);
    const r = document.getElementById('budget-reserved');
    const m = document.getElementById('budget-margin');
    if (r) r.textContent = 'RESERVED · $' + reserved.toFixed(3);
    if (m) m.textContent = 'MARGIN · $' + margin.toFixed(3);
  }

  function setAvatarTalking(agent) {
    document.querySelectorAll('.avatar[data-avatar]').forEach(a => a.classList.remove('talking'));
    const el = document.querySelector('.avatar[data-avatar="' + agent + '"]');
    if (el) el.classList.add('talking');
  }

  function renderChat(msg) {
    const stream = document.getElementById('chat-stream');
    if (!stream) return;
    const empty = stream.querySelector('.chat-empty');
    if (empty) empty.remove();

    // Remove any existing 'typing' bubble from this agent before rendering the real message
    if (msg.kind !== 'status') {
      stream.querySelectorAll('[data-typing-from="' + msg.from + '"]').forEach(n => n.remove());
    }

    // Status = typing indicator — single bubble that gets replaced
    if (msg.kind === 'status') {
      // Don't accumulate; replace any previous typing from same agent
      stream.querySelectorAll('[data-typing-from="' + msg.from + '"]').forEach(n => n.remove());
      const row = document.createElement('div');
      row.className = 'chat-row';
      row.setAttribute('data-typing-from', msg.from);
      const color = msg.color || 'paper';
      row.innerHTML =
        '<div class="chat-avatar avatar-' + color + '">' + (AGENT_INITIAL[msg.from] || '?') + '</div>' +
        '<div class="chat-body">' +
          '<div class="chat-meta"><span class="chat-name">' + msg.from.toUpperCase() + '</span></div>' +
          '<div class="chat-bubble kind-status"><span class="typing-dots"><span></span><span></span><span></span></span></div>' +
        '</div>';
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
      setAvatarTalking(msg.from);
      return;
    }

    const row = document.createElement('div');
    row.className = 'chat-row';
    const color = msg.color || 'paper';
    const timeStr = new Date(msg.ts || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Special-case: money transfer → coin sound + dedicated bubble
    if (msg.kind === 'money') {
      playCoinSound();
      const amt = typeof msg.amount === 'number' ? msg.amount : 0;
      const to = (msg.toAgent || '').toUpperCase();
      const memo = msg.memo ? escJs(msg.memo) : '';
      row.innerHTML =
        '<div class="chat-avatar avatar-black">$</div>' +
        '<div class="chat-body">' +
          '<div class="chat-meta">' +
            '<span class="chat-name">TREASURY</span>' +
            '<span class="chat-role">TRANSFER</span>' +
            '<span class="chat-ts">' + timeStr + '</span>' +
          '</div>' +
          '<div class="chat-bubble kind-money">' +
            '<span class="coin">$</span>' +
            '<span class="money-amt">$' + amt.toFixed(3) + '</span>' +
            '<span class="money-arrow">→</span>' +
            '<span class="money-to">' + escJs(to) + '</span>' +
            (memo ? '<span style="opacity:0.7;font-weight:500;margin-left:6px">' + memo + '</span>' : '') +
          '</div>' +
        '</div>';
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
      return;
    }

    const roleLabel = msg.kind === 'handoff' ? 'HANDOFF'
                    : msg.kind === 'error' ? 'DISTRESS'
                    : msg.kind === 'recovery' ? 'RECOVERY'
                    : msg.kind === 'orchestrator' ? 'ORCHESTRATOR'
                    : 'COUNCIL';
    const estimateChip = (typeof msg.estimate === 'number')
      ? '<span class="chat-estimate">EST $' + msg.estimate.toFixed(3) + '</span>'
      : '';
    row.innerHTML =
      '<div class="chat-avatar avatar-' + color + '">' + (AGENT_INITIAL[msg.from] || '?') + '</div>' +
      '<div class="chat-body">' +
        '<div class="chat-meta">' +
          '<span class="chat-name">' + msg.from.toUpperCase() + '</span>' +
          '<span class="chat-role">' + roleLabel + '</span>' +
          estimateChip +
          '<span class="chat-ts">' + timeStr + '</span>' +
        '</div>' +
        '<div class="chat-bubble bg-' + color + ' kind-' + (msg.kind || 'council') + '">' + escJs(msg.text) + '</div>' +
      '</div>';
    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;

    // Avatar stops talking after the real message lands, unless another typing follows
    const talkEl = document.querySelector('.avatar[data-avatar="' + msg.from + '"]');
    if (talkEl) talkEl.classList.remove('talking');

    // Budget bar — accumulate council estimates
    if (msg.kind === 'council' && typeof msg.estimate === 'number') {
      reservedTotal += msg.estimate;
      updateBudgetBar(reservedTotal);
    }
  }

  function escJs(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ═══ Pipeline ═══
  function showPipelineSection(topic, jobId) {
    // Idempotent: if we already mounted this job, just make sure the section
    // is visible and don't wipe the council/terminal or re-scroll.
    if (mountedPipelineJobId === jobId) {
      const s = document.getElementById('pipeline-section');
      if (s) s.classList.remove('hidden');
      return;
    }
    mountedPipelineJobId = jobId;

    const section = document.getElementById('pipeline-section');
    section.classList.remove('hidden');
    requestAnimationFrame(() => section.classList.add('in'));
    document.getElementById('pipeline-topic-label').textContent = '"' + topic + '"';
    document.querySelectorAll('.pipe-card').forEach(c => {
      c.classList.remove('running', 'done', 'error');
    });
    document.querySelectorAll('.pipe-connector').forEach(c => c.classList.remove('active'));
    resetCouncil();
    const termBody = document.getElementById('terminal-body');
    termBody.innerHTML = '';
    addLog('Pipeline initializing — topic: "' + topic + '"', 'dim');

    startTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();

    if (jobId) startStreaming(jobId);
    // Smooth scroll only on first mount
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        if (data.type === 'chat') {
          renderChat(data);
          return;
        }
        if (data.type === 'step') {
          const { agent, phase } = data;
          const card = document.querySelector('[data-agent="' + agent + '"]');
          if (card) {
            card.classList.remove('running', 'done', 'error');
            if (phase === 'start') card.classList.add('running');
            else card.classList.add('done');
            if (phase === 'done') {
              const cards = Array.from(document.querySelectorAll('.pipe-card'));
              const idx = cards.indexOf(card);
              const connector = document.querySelector('[data-connector="' + idx + '"]');
              if (connector) connector.classList.add('active');
            }
          }
          return;
        }
        const { agent, token } = data;
        if (!agent || token === undefined) return;

        if (token.includes('\\n') && agentLines[agent]) { delete agentLines[agent]; return; }
        if (!agentLines[agent]) {
          const row = document.createElement('div');
          row.className = 'log-line';
          row.innerHTML = '<span class="stream-agent">' + agentSvg(agent) + ' [' + agent + ']</span><span class="stext" style="color:#f5f1e8"></span>';
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
    el.textContent = s < 60 ? s + 'S' : Math.floor(s/60) + 'M ' + (s%60) + 'S';
  }

  // ═══ Video display ═══
  function showCommissionerVideo(data) {
    currentWatchFilename = data.videoFilename;
    currentWatchCommId   = data.sessionId;

    // Exclusive mode — show download card instead of player/watch gate
    if (data.mode === 'exclusive') {
      const section = document.getElementById('video-section');
      section.classList.remove('hidden');
      requestAnimationFrame(() => section.classList.add('in'));
      document.getElementById('watch-gate').classList.add('hidden');
      document.getElementById('video-wrapper').classList.add('hidden');
      const filename = data.videoFilename;
      const dlUrl = '/video/' + encodeURIComponent(filename) + '/download?token=' + (data.downloadToken || '');
      let excEl = document.getElementById('exclusive-success');
      if (!excEl) {
        excEl = document.createElement('div');
        excEl.id = 'exclusive-success';
        section.appendChild(excEl);
      }
      excEl.className = 'exclusive-card';
      excEl.innerHTML =
        '<div class="exclusive-card__kicker">YOUR EXCLUSIVE BROADCAST IS READY</div>' +
        '<div class="exclusive-card__headline">' + escJs(data.headline || '') + '</div>' +
        '<div class="exclusive-card__sub">This video was produced only for you. It will never air on the network.</div>' +
        '<div class="exclusive-card__actions">' +
          '<a href="' + dlUrl + '" class="nb-btn nb-btn--lime" target="_blank">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
            'DOWNLOAD MP4' +
          '</a>' +
          '<button class="nb-btn" onclick="copyExclusiveLink()">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '<span id="copy-link-label">COPY LINK</span>' +
          '</button>' +
        '</div>';
      excEl.dataset.dlUrl = dlUrl;
      section.scrollIntoView({ behavior:'smooth', block:'start' });
      return;
    }

    const section = document.getElementById('video-section');
    section.classList.remove('hidden');
    requestAnimationFrame(() => section.classList.add('in'));

    // Remove exclusive card if it existed from a previous render
    const excOld = document.getElementById('exclusive-success');
    if (excOld) excOld.remove();

    if (data.watchToken) {
      playVideo(data.videoFilename, data.watchToken, data.headline, data.totalCost, data.payments);
    } else {
      document.getElementById('watch-gate').classList.remove('hidden');
      document.getElementById('video-wrapper').classList.add('hidden');
      document.getElementById('wg-headline').textContent = data.headline || 'Broadcast ready';
      document.getElementById('wg-meta').textContent = 'Commission fee paid · Watch free or share the link';
    }
    section.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function playVideo(filename, token, headline, cost, payments) {
    document.getElementById('watch-gate').classList.add('hidden');
    document.getElementById('video-wrapper').classList.remove('hidden');
    const vid = document.getElementById('main-video');
    vid.src = '/video/' + encodeURIComponent(filename) + '?token=' + token;
    document.getElementById('video-headline-text').textContent = headline || '';
    document.getElementById('video-meta-text').textContent = cost ? '$' + cost.toFixed(4) + ' USDC paid to agents' : '';
    if (payments && payments.length) {
      const bp = document.getElementById('payment-breakdown');
      bp.innerHTML = payments.filter(p => p.amount > 0).map(p =>
          '<div class="pay-item">'
          + '<strong>' + p.agent.toUpperCase() + '</strong>'
          + '<span class="pay-amt">+$' + p.amount.toFixed(2) + '</span>'
          + '<span class="pay-addr">' + p.address.slice(0,6) + '…' + p.address.slice(-4) + '</span>'
          + '</div>'
        ).join('');
    }
  }

  // ═══ Pay-to-watch ═══
  function watchCurrentVideo() {
    if (currentWatchFilename) watchVideo(currentWatchFilename, currentWatchCommId);
  }

  async function watchVideo(filename, commissionSessionId) {
    currentWatchFilename = filename;
    currentWatchCommId   = commissionSessionId;

    const section = document.getElementById('video-section');
    section.classList.remove('hidden');
    requestAnimationFrame(() => section.classList.add('in'));

    // Show preview player first instead of immediately gating
    document.getElementById('watch-gate').classList.add('hidden');
    document.getElementById('video-wrapper').classList.remove('hidden');
    document.getElementById('video-headline-text').textContent = '';
    document.getElementById('video-meta-text').textContent = 'Preview — first 10 seconds free';
    document.getElementById('payment-breakdown').innerHTML = '';

    const vid = document.getElementById('main-video');
    vid.src = '/video/' + encodeURIComponent(filename) + '/preview';
    vid.autoplay = true;
    vid.muted = true;
    vid.playsInline = true;

    // Add preview overlay if not present
    let previewWrapper = vid.parentElement.querySelector('.preview-wrapper');
    if (!previewWrapper) {
      const parent = vid.parentElement;
      previewWrapper = document.createElement('div');
      previewWrapper.className = 'preview-wrapper';
      parent.insertBefore(previewWrapper, vid);
      previewWrapper.appendChild(vid);
      const overlay = document.createElement('div');
      overlay.className = 'preview-overlay';
      overlay.id = 'preview-overlay';
      previewWrapper.appendChild(overlay);
    }
    const overlay = document.getElementById('preview-overlay');
    if (overlay) { overlay.classList.remove('visible'); overlay.textContent = ''; }

    // Timeupdate: show countdown when <= 3s remain
    function onTimeUpdate() {
      const remaining = vid.duration - vid.currentTime;
      if (remaining <= 3 && remaining > 0 && overlay) {
        overlay.classList.add('visible');
        overlay.textContent = 'PREVIEW ENDS IN ' + Math.ceil(remaining) + 'S -- PAY $0.05 TO CONTINUE';
      }
    }
    function onEnded() {
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('ended', onEnded);
      if (overlay) overlay.classList.remove('visible');
      // Show the watch gate for payment
      document.getElementById('video-wrapper').classList.add('hidden');
      document.getElementById('watch-gate').classList.remove('hidden');
      launchWatchCheckout(filename, commissionSessionId);
    }
    vid.removeEventListener('timeupdate', onTimeUpdate);
    vid.removeEventListener('ended', onEnded);
    vid.addEventListener('timeupdate', onTimeUpdate);
    vid.addEventListener('ended', onEnded);

    vid.play().catch(function() {});
    section.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  async function launchWatchCheckout(filename, commissionSessionId) {
    const btn = document.getElementById('wg-btn');
    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9" stroke-opacity="0.3"/><path d="M12 3a9 9 0 0 1 9 9"/></svg><span>CREATING CHECKOUT…</span>';

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

      document.getElementById('watch-pending-msg').textContent = 'Complete $0.05 payment on Locus — video will unlock automatically.';
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20"/></svg><span>REOPEN CHECKOUT</span>';
      btn.onclick = function() { window.open(data.checkoutUrl, '_blank'); };

      startWatchPoll(data.sessionId, filename);
    } catch(e) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>WATCH · $0.05 USDC</span>';
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
          document.getElementById('watch-pending-msg').innerHTML = '<span style="color:#14532d;font-weight:700">Payment confirmed</span>';
          setTimeout(() => {
            playVideo(filename, data.watchToken, data.headline, data.cost, null);
            // Resume from where the preview left off
            const vid = document.getElementById('main-video');
            if (vid) {
              vid.muted = false;
              vid.currentTime = 10;
              vid.play().catch(function() {});
            }
          }, 500);
        } else if (data.status === 'error') {
          clearInterval(watchPollTimer);
          document.getElementById('watch-pending-msg').innerHTML = '<span style="color:#a00">Payment failed or expired.</span>';
        }
      } catch(e) {}
    }, 3000);
  }

  // ═══ Exclusive helpers ═══
  function copyExclusiveLink() {
    const el = document.getElementById('exclusive-success');
    const url = el ? window.location.origin + el.dataset.dlUrl : '';
    if (url && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        const lbl = document.getElementById('copy-link-label');
        if (lbl) { lbl.textContent = 'COPIED'; setTimeout(() => { lbl.textContent = 'COPY LINK'; }, 2000); }
      });
    }
  }
  window.copyExclusiveLink = copyExclusiveLink;

  // ═══ Payouts polling ═══
  let payoutTimer = null;
  async function loadPayouts() {
    try {
      const resp = await fetch('/api/payouts');
      const data = await resp.json();
      const container = document.getElementById('payouts-list');
      if (!container) return;
      if (!data.payouts || data.payouts.length === 0) {
        container.innerHTML = '<div class="payout-empty">No payouts yet.</div>';
        return;
      }
      container.innerHTML = data.payouts.map(function(p) {
        const statusCls = p.status === 'sent' ? 'sent' : p.status === 'failed' ? 'failed' : 'pending';
        const addr = p.to_address ? (p.to_address.slice(0,6) + '...' + p.to_address.slice(-4)) : '—';
        const txLink = p.tx_hash
          ? '<span class="payout-tx"><a href="https://basescan.org/tx/' + escJs(p.tx_hash) + '" target="_blank" rel="noopener">' + p.tx_hash.slice(0,10) + '...</a></span>'
          : '';
        return '<div class="payout-row">' +
          '<span class="payout-status payout-status--' + statusCls + '">' + escJs(p.status).toUpperCase() + '</span>' +
          '<span class="payout-amount">$' + (typeof p.amount === 'number' ? p.amount.toFixed(4) : p.amount) + '</span>' +
          '<span class="payout-addr">' + escJs(addr) + '</span>' +
          '<span class="payout-reason">' + escJs(p.reason || '') + '</span>' +
          txLink +
        '</div>';
      }).join('');
    } catch (e) {
      console.error('Payouts load failed:', e);
    }
  }

  window.submitCommission = submitCommission;
  window.watchCurrentVideo = watchCurrentVideo;
  window.loadBalances = loadBalances;
</script>
</body>
</html>`;
}
