# 📡 Dispatch — Autonomous AI News Network

> An agent swarm that researches, produces, and sells video news briefings about the agentic economy — fully self-funded through Locus payments.

Built for the **[Locus Paygentic Hackathon](https://devfolio.co/locus-paygentic)** 🏆

## What It Does

Every 6 hours, a swarm of specialized AI agents collaborates to produce a 90-second video briefing on the latest developments in the agentic economy:

```
Researcher Agent  ──→  $0.03  (Tavily + Perplexity + X/Twitter)
    ↓ pays
Scriptwriter Agent ──→  $0.01  (Claude)
    ↓ pays
Visual Agent       ──→  $0.08  (fal.ai image generation)
    ↓ pays
Animator Agent     ──→  $0.30  (fal.ai image-to-video)
    ↓ pays
Voice Agent        ──→  $0.01  (Deepgram TTS)
    ↓ pays
Music Agent        ──→  $0.02  (Suno)
    ↓ pays
Editor Agent       ──→  $0.00  (FFmpeg assembly)
    ↓
Final Video ──→ Published to X/Twitter + sold via Locus Checkout ($1 USDC)
```

Each agent is a **separate service on BuildWithLocus**, paid per job in **USDC via PayWithLocus**. Real money flows between agents for every video produced.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Orchestrator Service                │
│         (schedules jobs, routes payments)            │
└─────┬───────────────────────────────────────────────┘
      │  pays $0.03 USDC
      ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Researcher  │    │ Scriptwriter │    │ Visual Agent│
│   Service   │    │   Service    │    │   Service   │
│ (Tavily/Exa)│    │  (Claude)    │    │  (fal.ai)   │
└─────────────┘    └──────────────┘    └─────────────┘
      │                   │                   │
      └───────────────────┴───────────────────┘
                          │ each service paid per job
                          ▼
                 ┌────────────────┐
                 │  Editor Service│
                 │   (FFmpeg)     │
                 └───────┬────────┘
                         │ publishes
                         ▼
              ┌──────────────────────┐
              │  X/Twitter + Checkout│
              │  ($1 USDC per video) │
              └──────────────────────┘
```

## Locus Integration

| Feature | Usage |
|---------|-------|
| **PayWithLocus** | Orchestrator pays each sub-agent in USDC per job |
| **Wrapped APIs** | Tavily, Perplexity, fal.ai, Deepgram, Suno, X/Twitter — all via Locus proxy |
| **Locus Checkout** | Viewers pay $1 USDC to access full videos |
| **AgentMail** | Agents communicate job status via `dispatch@agentmail.to` |
| **BuildWithLocus** | All services deployed as containers on `svc-*.buildwithlocus.com` |
| **Approval Workflow** | Large budget runs (>$5) require human approval |

## Cost Per Video

| Step | API | Cost |
|------|-----|------|
| Research | Tavily + Perplexity | ~$0.03 |
| Script | Claude (Wrapped) | ~$0.01 |
| 4× Images | fal.ai (Flux) | ~$0.08 |
| 4× Video clips | fal.ai (Kling) | ~$0.30 |
| Narration | Deepgram TTS | ~$0.01 |
| Music | Suno | ~$0.02 |
| **Total** | | **~$0.45** |
| **Revenue** | Locus Checkout | **$1.00** |
| **Margin** | | **55%** |

## Stack

- **Runtime**: Node.js + TypeScript
- **Deployment**: BuildWithLocus (each agent = one service)
- **Payments**: PayWithLocus (USDC on Base)
- **Video assembly**: FFmpeg
- **AI APIs**: All via Locus Wrapped APIs (no separate accounts needed)

## Getting Started

```bash
# Clone
git clone https://github.com/cass-agency/dispatch
cd dispatch

# Install
npm install

# Configure
cp .env.example .env
# Add your LOCUS_API_KEY (claw_...)

# Deploy to BuildWithLocus
npm run deploy
```

## Environment Variables

```env
LOCUS_API_KEY=claw_...          # PayWithLocus API key
LOCUS_BUILD_JWT=eyJ...          # BuildWithLocus JWT token
```

No other API keys needed — all external services are accessed via Locus Wrapped APIs.

## Hackathon

Built for [Locus Paygentic Hackathon #1](https://devfolio.co/locus-paygentic) — track: *AI agents that make purchases and transactions*.

The economic loop: agents earn USDC → pay other agents → produce content → sell to viewers → earn more USDC. A self-sustaining digital media business with no human operators.

---

Made with 🦞 by [cass-agency](https://github.com/cass-agency)
