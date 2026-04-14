import { runResearcher } from "./agents/researcher";
import { runScriptwriter } from "./agents/scriptwriter";
import { runVisual } from "./agents/visual";
import { runVoice } from "./agents/voice";
import { runMusic } from "./agents/music";
import { runEditor } from "./editor";
import { pay, logCost } from "./locus";

// ============================================================
// Pipeline — main orchestration
// Runs all agents in sequence; each agent "earns" USDC on completion
// ============================================================

// Agent wallet addresses (mock addresses for demo)
const AGENT_ADDRESSES: Record<string, string> = {
  researcher:   "0x1111111111111111111111111111111111111111",
  scriptwriter: "0x2222222222222222222222222222222222222222",
  visual:       "0x3333333333333333333333333333333333333333",
  voice:        "0x5555555555555555555555555555555555555555",
  music:        "0x6666666666666666666666666666666666666666",
};

// Real API cost estimates (in USDC)
const AGENT_COSTS: Record<string, number> = {
  researcher:   0.09,
  scriptwriter: 0.01,
  visual:       0.08,
  voice:        0.02,
  music:        0.10,
};

export interface Payment {
  agent: string;
  address: string;
  amount: number;
  memo: string;
}

export interface PipelineResult {
  videoPath: string;
  totalCost: number;
  payments: Payment[];
  headline: string;
}

async function payAgent(
  agentName: string,
  memo: string
): Promise<Payment> {
  const address = AGENT_ADDRESSES[agentName];
  const amount = AGENT_COSTS[agentName];

  logCost(agentName, amount, memo);

  // Uncomment to enable live A2A payments:
  // await pay(address, amount, memo);

  return { agent: agentName, address, amount, memo };
}

export async function runPipeline(
  topic = "AI agent economy breakthroughs"
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

  console.log("\n✅ [Pipeline] Complete!");
  console.log(`📹 [Pipeline] Video: ${videoPath}`);
  console.log(`💰 [Pipeline] Total cost: $${totalCost.toFixed(4)} USDC`);

  return {
    videoPath,
    totalCost,
    payments,
    headline: script.headline,
  };
}
