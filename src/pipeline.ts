import { runResearcher } from "./agents/researcher";
import { runScriptwriter } from "./agents/scriptwriter";
import { runVisual } from "./agents/visual";
import { runVoice } from "./agents/voice";
import { runMusic } from "./agents/music";
import { runEditor } from "./editor";
import { pay, logCost } from "./locus";

// ============================================================
// Pipeline — main orchestration
// Researcher is the orchestrator: receives the budget and pays each
// specialist agent at MARKUP prices (not just cost). The markup is the
// agent's profit margin on top of the actual API cost that Locus handles.
// ============================================================

// Real agent wallet addresses (wallets with private keys)
const AGENT_ADDRESSES: Record<string, string> = {
  researcher:   "0xA865aEA68e7f6B611a69c34669e349C0aAe1FDF5",   // orchestrator — earns the spread
  scriptwriter: "0xA86e854Ef4cac10676E1c6f0f90e091b4b3f1598",
  visual:       "0xF46F05E04e6e34621DF881B486AbE45eA3010617",
  voice:        "0x51fF2E55eF9687aCcC97b8dDa2983859104e56c8",
  music:        "0x60Be80b931836e60651B3Cb7800D5cAA7CE10a50",
};

// Markup prices — what orchestrator pays each agent (higher than actual API cost; agent pockets the margin)
const AGENT_COSTS: Record<string, number> = {
  researcher:   0.00,   // orchestrator doesn't pay itself — it earns the spread
  scriptwriter: 0.02,   // actual Locus cost ~$0.01, earns $0.01 margin
  visual:       0.12,   // actual Locus cost ~$0.08, earns $0.04 margin
  voice:        0.04,   // actual Locus cost ~$0.02, earns $0.02 margin
  music:        0.15,   // actual Locus cost ~$0.10, earns $0.05 margin
};

// Agent margins for display (markup price minus actual cost)
const AGENT_MARGINS: Record<string, number> = {
  researcher: 0, scriptwriter: 0.01, visual: 0.04, voice: 0.02, music: 0.05,
};

export interface Payment {
  agent: string;
  address: string;
  amount: number;
  memo: string;
  margin: number;
}

export interface PipelineResult {
  videoPath: string;
  totalCost: number;
  payments: Payment[];
  headline: string;
  requesterAddress?: string;
  orchestratorEarnings: number;
}

export interface PipelineOptions {
  requesterAddress?: string;
  requestFee?: number;
}

async function payAgent(
  agentName: string,
  memo: string
): Promise<Payment> {
  const address = AGENT_ADDRESSES[agentName];
  const amount = AGENT_COSTS[agentName];
  const margin = AGENT_MARGINS[agentName];

  logCost(agentName, amount, memo);

  if (agentName === "researcher") {
    console.log(`🤖 [researcher]  orchestrator  earns spread`);
  } else {
    const actualCost = amount - margin;
    console.log(`🤖 [${agentName}] paid $${amount.toFixed(2)} (cost $${actualCost.toFixed(2)}, margin $${margin.toFixed(2)})`);
    await pay(address, amount, memo);
  }

  return { agent: agentName, address, amount, memo, margin };
}

export async function runPipeline(
  topic = "AI agent economy breakthroughs",
  options?: PipelineOptions
): Promise<PipelineResult> {
  console.log("\n🚀 [Pipeline] Starting Dispatch news video pipeline...");
  console.log(`📰 [Pipeline] Topic: ${topic}\n`);

  const payments: Payment[] = [];
  let totalCost = 0;

  // ── Step 1: Research ─────────────────────────────────────
  const research = await runResearcher(topic);
  const p1 = await payAgent("researcher", "Tavily news search");
  payments.push(p1);
  totalCost += p1.amount;

  // ── Step 2: Scriptwriting ────────────────────────────────
  const script = await runScriptwriter(research.summary);
  const p2 = await payAgent("scriptwriter", "Claude Haiku script");
  payments.push(p2);
  totalCost += p2.amount;

  // ── Step 3: Visual generation ────────────────────────────
  const visuals = await runVisual(script.segments);
  const p3 = await payAgent("visual", "fal.ai flux image generation");
  payments.push(p3);
  totalCost += p3.amount;

  // ── Step 4: Voice synthesis ──────────────────────────────
  const voice = await runVoice(script.segments);
  const p4 = await payAgent("voice", "Deepgram TTS narration");
  payments.push(p4);
  totalCost += p4.amount;

  // ── Step 5: Music generation ─────────────────────────────
  const music = await runMusic();
  const p5 = await payAgent("music", "Suno background music");
  payments.push(p5);
  totalCost += p5.amount;

  // ── Step 6: Edit & assemble (Ken Burns FFmpeg) ───────────
  const videoPath = await runEditor(visuals.images, voice, music);

  // Calculate orchestrator earnings (spread between request fee and total agent payments)
  const requestFee = options?.requestFee ?? 0;
  const orchestratorEarnings = requestFee > 0 ? Math.max(0, requestFee - totalCost) : 0;

  console.log("\n✅ [Pipeline] Complete!");
  console.log(`📹 [Pipeline] Video: ${videoPath}`);
  console.log(`💰 [Pipeline] Total agent payments: $${totalCost.toFixed(4)} USDC`);
  if (orchestratorEarnings > 0) {
    console.log(`🤖 [researcher] orchestrator earnings (spread): $${orchestratorEarnings.toFixed(4)} USDC`);
  }

  return {
    videoPath,
    totalCost,
    payments,
    headline: script.headline,
    requesterAddress: options?.requesterAddress,
    orchestratorEarnings,
  };
}
