# Dispatch -- Autonomous AI News Network

> A swarm of six AI agents that research, script, illustrate, narrate, score, and edit video news broadcasts -- paying each other in real USDC on Base through Locus wallets. Every agent has its own wallet. Every API call is a real transaction.

Built for the **Locus Paygentic Hackathon** -- track: *AI agents that make purchases and transactions*.

**Live:** Deployed on BuildWithLocus at port 8080.

---

## What It Does

A user commissions a topic. Six agents convene in a live council, debate scope and budget on-camera, then execute a production pipeline -- researcher to editor -- with real money flowing between wallets at every step. The result is a broadcast-quality video with Ken Burns cinematography, AI narration, and an original score.

The entire system is self-funding: commissions come in as USDC, agents get paid for their work, the orchestrator retains the margin.

---

## Commission Modes

| Mode | Fee | What the Commissioner Gets |
|------|-----|---------------------------|
| **Public** | $0.50 USDC | Free watch token + 40% of all future view revenue from that video |
| **Exclusive** | $2.00 USDC | Private download token + full rights. Video never airs publicly. |

Commissions are created via `POST /commission` and paid through Locus Checkout. A 5-second poller detects payment and auto-launches the pipeline.

---

## The Council

Before any production work begins, all five autonomous agents convene in a pre-production council session. Each agent speaks in character via Claude Haiku (billed to its own wallet) about:

- What it will specifically do for this topic
- Its cost estimate for the job

The orchestrator opens by announcing the commission pool. Each agent responds in order (researcher, scriptwriter, visual, voice, music). The orchestrator then locks the budget and announces the margin. If any agent's wallet balance is below its estimate, the treasury flags it for top-up.

The entire council conversation streams live to the frontend via SSE. Between pipeline steps, agents generate in-character handoff messages addressed to the next agent in line -- these also appear in the live chat.

Recovery is built in: if an agent fails, it can ask a peer for help via `runRecovery`, which produces a revised input through a structured LLM exchange.

---

## Real Money Flows

```
Commission ($0.50 or $2.00 USDC)
    |
    v
Orchestrator Treasury Wallet
    |
    |-- pays --> Researcher   (0x99ea...1c5c)  $0.00 markup
    |-- pays --> Scriptwriter (0x4037...85a8)  $0.02 markup
    |-- pays --> Visual       (0x16ae...1cdd)  $0.12 markup
    |-- pays --> Voice        (0x8fe8...89ed5) $0.04 markup
    |-- pays --> Music        (0x053f...3563)  $0.15 markup
    |
    v
Each agent also pays for its OWN API calls via its claw_ key
(Locus wrapped APIs debit the agent's wallet directly)
```

**How it works under the hood:**

1. Each agent can have a dedicated `LOCUS_API_KEY_<AGENT>` environment variable (a `claw_` key). If set, that agent is in **autonomous mode** -- its wrapped API calls debit its own Locus wallet.

2. If unset, the agent falls back to **orchestrator-billed mode** using the main `LOCUS_API_KEY`.

3. After each pipeline step completes, the orchestrator calls `pay()` to transfer USDC to the agent's on-chain wallet address as compensation.

4. Every transfer emits a chat event with `kind: "money"` -- the frontend renders coin-sound effects and money bubbles in the live chat feed.

5. On-chain USDC balances (Base mainnet, contract `0x8335...2913`) are read via `eth_call` against the Base RPC and displayed in the treasury dashboard.

---

## Dynamic Visual Top-Up

The voice agent produces narration of unpredictable length. After synthesis, the editor probes the actual MP3 duration via `ffprobe` (not the word-count estimate, which drifts 15-30%).

If the real duration means each of the original 4 images would need to cover more than 18 seconds (which looks static), the orchestrator:

1. Calculates how many supplementary frames are needed (up to 8 total)
2. Announces the decision in the live chat
3. Tops up the visual agent's wallet on-chain ($0.03 per extra frame)
4. Re-engages the visual director via Claude Haiku to design prompts that extend the visual language
5. Generates the extra images via fal.ai Flux

This is a real-time budget adjustment with on-chain money movement, visible to the user as it happens.

---

## Preview Gating and Pay-to-Watch

For public videos:

- A **10-second free preview** is generated at assembly time (stream-copy, no re-encode) and served without authentication at `GET /video/:filename/preview`
- Full video requires a valid watch token
- Viewers pay **$0.05 USDC** via Locus Checkout to unlock the full video
- **40% of the watch fee** ($0.02) is sent to the original commissioner's wallet as revenue share
- Revenue share payments go through the `pay_outbox` table for reliability -- immediate best-effort send, with a 30-second reconciler that retries failed payments (up to 5 attempts)

For exclusive videos:

- No public listing, no preview endpoint
- Commissioner receives a download token for direct access via `GET /video/:filename/download`

---

## Persistence

All state is stored in Postgres (provisioned via Locus addon). The schema includes:

| Table | Purpose |
|-------|---------|
| `videos` | Full MP4 bytes (bytea), 10s preview bytes, headline, cost breakdown, commissioner info |
| `commissions` | Commission lifecycle: pending_payment, generating, done, error, refund_needed |
| `watch_sessions` | Pay-to-watch session tracking with revenue share status |
| `watch_tokens` | Token-to-filename mapping for video access control |
| `pay_outbox` | Persistent payment queue with deduplication, retry tracking, tx hash logging |

**Key design decisions:**

- Video bytes stored as `bytea` so videos survive container restarts. Range queries use `SUBSTRING` for HTTP range-request support (scrubbing works).
- On boot, all tables are hydrated into in-memory maps for fast serving, with DB as source of truth.
- A **circuit breaker** disables all DB operations if the connection fails at startup (expected for local dev outside the Locus VPC). The server falls back to in-memory-only mode.
- Idempotent migrations run on every boot via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

---

## Architecture

```
                           +---------------------------+
                           |      User / Browser       |
                           |  POST /commission (topic)  |
                           +-------------+-------------+
                                         |
                                   Locus Checkout
                                   ($0.50 or $2.00)
                                         |
                                         v
+------------------------------------------------------------------------+
|                         Dispatch Server (Express)                      |
|                                                                        |
|  +------------------+     +----------------------------------------+   |
|  | Checkout Poller  |---->|            Pipeline Orchestrator        |   |
|  | (5s interval)    |     |                                        |   |
|  +------------------+     |  0. Council    (all agents speak)      |   |
|                           |  1. Researcher (Tavily + Haiku brief)  |   |
|  +------------------+     |  2. Scriptwriter (Haiku script)        |   |
|  | SSE /stream      |<----|  3. Visual     (Haiku + fal.ai Flux)   |   |
|  | (live tokens,    |     |  4. Voice      (Haiku + Deepgram TTS)  |   |
|  |  chat, steps)    |     |  4.5 Dynamic visual top-up (if needed) |   |
|  +------------------+     |  5. Music      (Haiku + Suno V4)       |   |
|                           |  6. Editor     (FFmpeg Ken Burns)      |   |
|  +------------------+     +--------------------+-------------------+   |
|  | Pay Outbox       |                          |                       |
|  | Reconciler (30s) |     +--------------------v-------------------+   |
|  +------------------+     |              Postgres (Locus)          |   |
|                           |  videos | commissions | watch_sessions |   |
|                           |  watch_tokens | pay_outbox             |   |
|                           +----------------------------------------+   |
+------------------------------------------------------------------------+
         |                          |                        |
    Locus Pay API             Locus Wrapped APIs        Locus Checkout
    (USDC transfers)          (Tavily, Anthropic,       (commission +
                               fal.ai, Deepgram,        watch fees)
                               Suno)
```

---

## Agent Roster

| Agent | Role | APIs (via Locus Wrapped) | Wallet | Orchestrator Pays |
|-------|------|--------------------------|--------|-------------------|
| **Researcher** | Editorial director -- finds news, writes brief | Tavily search, Claude Haiku | `0x99ea...1c5c` | $0.00 |
| **Scriptwriter** | Head writer -- 4-segment broadcast script | Claude Haiku | `0x4037...85a8` | $0.02 |
| **Visual** | Cinematographer -- image prompts + generation | Claude Haiku, fal.ai Flux Dev | `0x16ae...1cdd` | $0.12 |
| **Voice** | Voice director + narrator -- adapts script, synthesizes | Claude Haiku, Deepgram TTS (aura-2-thalia-en) | `0x8fe8...9ed5` | $0.04 |
| **Music** | Composer -- writes Suno brief, generates score | Claude Haiku, Suno V4 (instrumental) | `0x053f...3563` | $0.15 |
| **Editor** | Post-production -- Ken Burns assembly, audio mix | FFmpeg (local, no API cost) | -- | $0.00 |

Each autonomous agent runs its own Claude Haiku reasoning step before calling its primary API. The council and handoff messages are also billed to the speaking agent's wallet.

---

## Cost Breakdown Per Video

| Step | API | Per-Call Cost | Notes |
|------|-----|---------------|-------|
| Council | Claude Haiku x5 | ~$0.01 | Each agent's council turn billed to its own wallet |
| Research | Tavily search | ~$0.09 | 5 results, 1-day news, includes answer |
| Research brief | Claude Haiku | ~$0.002 | Editorial direction reasoning |
| Script | Claude Haiku | ~$0.002 | 4-segment broadcast script |
| Visual direction | Claude Haiku | ~$0.002 | Coherent visual language planning |
| Image generation | fal.ai Flux Dev x4 | ~$0.08 | 4 cinematic images |
| Voice direction | Claude Haiku | ~$0.002 | Narration adaptation for spoken delivery |
| Narration | Deepgram TTS | ~$0.02 | aura-2-thalia-en, chunked if >1800 chars |
| Music composition | Claude Haiku | ~$0.002 | Suno prompt generation |
| Music generation | Suno V4 | ~$0.10 | Instrumental, content-filter-safe |
| Handoff messages | Claude Haiku x5 | ~$0.01 | In-character agent-to-agent handoffs |
| Editor | FFmpeg (local) | $0.00 | Ken Burns + audio mix + 10s preview |
| **Total API cost** | | **~$0.32** | |
| **Orchestrator markup** | | **$0.33** | Paid to agent wallets after steps |
| **Total production** | | **~$0.65** | |

With a $0.50 public commission, the system operates near break-even on production alone and profits on watch revenue. With $2.00 exclusive commissions, margin is ~$1.35 per video.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express 4 |
| Video assembly | FFmpeg (async spawn, Ken Burns pan via scale+crop) |
| Audio probing | ffprobe (real MP3 duration measurement) |
| Database | Postgres (Locus addon, `pg` driver, connection pooling) |
| Agent wallets | 6 Locus `claw_` API keys (5 autonomous + 1 orchestrator) |
| Payments | Locus Pay API (USDC on Base) |
| Checkout | Locus Checkout (commission + watch fees) |
| Wrapped APIs | Tavily, Anthropic (Claude Haiku), fal.ai (Flux Dev), Deepgram (TTS), Suno (V4) |
| Live streaming | Server-Sent Events (SSE) with replay buffer |
| Deployment | BuildWithLocus (Docker, Alpine + FFmpeg) |

---

## Getting Started

```bash
# Clone and install
git clone https://github.com/cass-agency/dispatch
cd dispatch
npm install

# Configure environment
cp .env.example .env
# Required: set LOCUS_API_KEY (orchestrator treasury wallet)
# Optional: set per-agent keys for autonomous mode
#   LOCUS_API_KEY_RESEARCHER=claw_...
#   LOCUS_API_KEY_SCRIPTWRITER=claw_...
#   LOCUS_API_KEY_VISUAL=claw_...
#   LOCUS_API_KEY_VOICE=claw_...
#   LOCUS_API_KEY_MUSIC=claw_...

# Seed agent wallets (optional -- funds each agent's wallet)
npm run seed-agents

# Run in development (hot reload via tsx)
npm run dev

# Or build and run production
npm run build
npm start
```

**Local dev notes:**

- Without `DATABASE_URL`, the server runs in memory-only mode (circuit breaker auto-disables DB).
- Without per-agent keys, all API calls bill the orchestrator's main wallet (still works, just not autonomous).
- Set `DEMO_MODE=true` to skip all paid API calls and use placeholder data.
- FFmpeg must be installed locally (`brew install ffmpeg` or `apk add ffmpeg`).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Main UI -- video archive, commission form, treasury dashboard |
| `POST` | `/commission` | Create a commission (topic, requesterAddress, mode) |
| `GET` | `/commission/:id` | Poll commission status, steps, logs |
| `POST` | `/commission/:id/claim-watch` | Claim free watch token (public commissions) |
| `POST` | `/videos/:filename/watch` | Create pay-to-watch session ($0.05) |
| `GET` | `/video/:filename` | Serve full video (requires watch token) |
| `GET` | `/video/:filename/preview` | Serve 10s free preview |
| `GET` | `/video/:filename/download` | Exclusive download (requires download token) |
| `GET` | `/api/jobs/:id/stream` | SSE stream -- live tokens, chat, step events |
| `GET` | `/api/jobs/:id` | Poll job status |
| `GET` | `/api/watch/:id` | Poll watch session |
| `GET` | `/api/balance` | Treasury + agent wallet balances |
| `GET` | `/api/ledger` | Recent Locus transaction history |
| `GET` | `/api/payouts` | Recent pay_outbox entries |
| `GET` | `/api/agent-modes` | Which agents are autonomous vs. orchestrator-billed |
| `GET` | `/health` | Health check (version 0.4.0) |

---

## Why It Matters

Most "AI agent" demos are prompt chains with no skin in the game. Dispatch is different:

- **Real wallets, real money.** Every agent has a Base mainnet wallet holding USDC. Every API call is a Locus transaction. Every payment is verifiable on-chain.
- **Agents pay for their own work.** The researcher's Tavily search debits the researcher's wallet. The visual agent's Flux generation debits the visual agent's wallet. This is not simulated.
- **Dynamic economic decisions.** When the voice track comes in long, the orchestrator tops up the visual wallet and commissions extra frames -- a real-time budget reallocation with on-chain settlement.
- **Revenue flows back.** Commissioners earn 40% of downstream view revenue. The pay_outbox ensures no payment is ever lost.
- **Everything is visible.** The council debate, the handoff messages, the money transfers -- all stream live to the user's browser. You watch the agents think, negotiate, and pay each other in real time.

---

Built for the [Locus Paygentic Hackathon](https://devfolio.co/locus-paygentic) by [cass-agency](https://github.com/cass-agency).
