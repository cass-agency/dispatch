import { runResearcher } from "./agents/researcher";
import { runScriptwriter } from "./agents/scriptwriter";
import { runVisual } from "./agents/visual";
import { runVoice } from "./agents/voice";
import { runMusic } from "./agents/music";
import { runEditor } from "./editor";
import { pay, logCost } from "./locus";

// ============================================================
// Pipeline — orchestrator model
// Researcher is the orchestrator: receives budget, pays specialists
// All Locus wrapped API calls route through the main claw_ wallet
// Sub-agent wallets accumulate real USDC earnings
// ============================================================

// Real agent wallet addresses (funded wallets)
const AGENT_ADDRESSES: Record<string, string> = {
  researcher:   "0xA865aEA68e7f6B611a69c34669e349C0aAe1FDF5", // cass-agency main (orchestrator)
  scriptwriter: "0xA86e854Ef4cac10676E1c6f0f90e091b4b3f1598", // gifted wallet
  visual:       "0xF46F05E04e6e34621DF881B486AbE45eA3010617",
  voice:        "0x51fF2E55eF9687aCcC97b8dDa2983859104e56c8",
  music:        "0x60Be80b931836e60651B3Cb7800D5cAA7CE10a50",
};

// Markup prices — what orchestrator pays to each specialist agent
// (above actual API cost — margin stays with orchestrator/researcher wallet)
const AGENT_COSTS: Record<string, number> = {
  researcher:   0.00,  // Orchestrator earns from margins; doesn't pay itself
  scriptwriter: 0.02,  // API: ~$0.01  margin: $0.01
  visual:       0.12,  // API: ~$0.08  margin: $0.04
  voice:        0.04,  // API: ~$0.02  margin: $0.02
  music:        0.15,  // API: ~$0.10  margin: $0.05
};

export type StepCallback = (
  agent: string,
  phase: "start" | "done",
  log: string
) => void;

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

async function payAgent(agentName: string, memo: string): Promise<Payment> {
  const address = AGENT_ADDRESSES[agentName];
  const amount = AGENT_COSTS[agentName];

  logCost(agentName, amount, memo);

  if (amount > 0) {
    await pay(address, amount, memo);
  }

  return { agent: agentName, address, amount, memo };
}

export async function runPipeline(
  topic = "AI agent economy breakthroughs",
  onStep?: StepCallback
): Promise<PipelineResult> {
  console.log("\n🚀 [Pipeline] Starting Dispatch news video pipeline...");
  console.log(`📰 [Pipeline] Topic: ${topic}\n`);

  const payments: Payment[] = [];
  let totalCost = 0;

  // ── Step 1: Research ──────────────────────────────────────
  onStep?.("researcher", "start", `🔍 Searching live news about "${topic}"...`);
  const research = await runResearcher(topic);
  const p1 = await payAgent("researcher", "Tavily news search");
  payments.push(p1);
  totalCost += p1.amount;
  onStep?.("researcher", "done", `✅ Found ${research.articles.length} articles — researcher wallet credited`);

  // ── Step 2: Scriptwriting ─────────────────────────────────
  onStep?.("scriptwriter", "start", "✍️  Writing 4-segment broadcast script with Claude...");
  const script = await runScriptwriter(research.summary);
  const p2 = await payAgent("scriptwriter", "Claude Haiku script generation");
  payments.push(p2);
  totalCost += p2.amount;
  onStep?.("scriptwriter", "done", `✅ Script ready: "${script.headline}" — paid $${p2.amount.toFixed(2)} USDC`);

  // ── Step 3: Visual generation ─────────────────────────────
  onStep?.("visual", "start", `🎨 Generating ${script.segments.length} cinematic images with fal.ai Flux...`);
  const visuals = await runVisual(script.segments);
  const p3 = await payAgent("visual", "fal.ai flux image generation");
  payments.push(p3);
  totalCost += p3.amount;
  onStep?.("visual", "done", `✅ ${visuals.images.length} images generated — paid $${p3.amount.toFixed(2)} USDC`);

  // ── Step 4: Voice synthesis ───────────────────────────────
  onStep?.("voice", "start", "🎙️  Synthesizing broadcast narration with Deepgram...");
  const voice = await runVoice(script.segments);
  const p4 = await payAgent("voice", "Deepgram TTS narration");
  payments.push(p4);
  totalCost += p4.amount;
  onStep?.("voice", "done", `✅ Narration ready (${voice.durationSeconds.toFixed(0)}s) — paid $${p4.amount.toFixed(2)} USDC`);

  // ── Step 5: Music generation ──────────────────────────────
  onStep?.("music", "start", "🎵 Composing original background score with Suno...");
  const music = await runMusic();
  const p5 = await payAgent("music", "Suno background music");
  payments.push(p5);
  totalCost += p5.amount;
  onStep?.("music", "done", `✅ Score composed — paid $${p5.amount.toFixed(2)} USDC`);

  // ── Step 6: Edit & assemble ───────────────────────────────
  onStep?.("editor", "start", "🎬 Assembling video: Ken Burns motion + color grade + audio mix...");
  const videoPath = await runEditor(visuals.images, voice, music);
  onStep?.("editor", "done", `✅ Video assembled: ${videoPath.split("/").pop()}`);

  console.log("\n✅ [Pipeline] Complete!");
  console.log(`📹 [Pipeline] Video: ${videoPath}`);
  console.log(`💰 [Pipeline] Total paid to agents: $${totalCost.toFixed(4)} USDC`);

  return { videoPath, totalCost, payments, headline: script.headline };
}
