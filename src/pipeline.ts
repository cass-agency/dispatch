import { runResearcher } from "./agents/researcher";
import { runScriptwriter } from "./agents/scriptwriter";
import { runVisual } from "./agents/visual";
import { runVoice } from "./agents/voice";
import { runMusic } from "./agents/music";
import { runEditor } from "./editor";
import { pay, logCost, getLocusBalance } from "./locus";
import { getAgentMode, AgentName, getAgentKey } from "./agent-keys";
import { runCouncil, announceHandoff, ChatCallback, ChatMessage } from "./council";

// ============================================================
// Pipeline — orchestrator model with on-stream council
// Step 0: Council (agents debate scope + budget on-camera)
// Steps 1-5: Agents run, each handoff announced via chat
// Step 6: Editor assembles
// ============================================================

const AGENT_ADDRESSES: Record<string, string> = {
  researcher:   "0x99ea943041e186b103a160e843e3e8ef47881c5c",
  scriptwriter: "0x403760e3f06c126c687722897bf2d661cb8585a8",
  visual:       "0x16ae9ba7ea3cbf57e632d5533ff01645fc901cdd",
  voice:        "0x8fe8c382e5cbbd590e9eca04cbdf6ae17de89ed5",
  music:        "0x053f33a2a7c03f6dd9000c9e1e956e9ea5833563",
};

const AGENT_COSTS: Record<string, number> = {
  researcher:   0.00,
  scriptwriter: 0.02,
  visual:       0.12,
  voice:        0.04,
  music:        0.15,
};

const COMMISSION_FEE = 0.50;

export type StepCallback = (agent: string, phase: "start" | "done", log: string) => void;
export type TokenCallback = (agent: string, token: string) => void;

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
  if (amount > 0) await pay(address, amount, memo);
  return { agent: agentName, address, amount, memo };
}

async function fetchAgentBalances(): Promise<Partial<Record<AgentName, number>>> {
  const agents: AgentName[] = ["researcher", "scriptwriter", "visual", "voice", "music"];
  const out: Partial<Record<AgentName, number>> = {};
  await Promise.all(
    agents.map(async (a) => {
      try {
        const key = getAgentKey(a);
        if (!key) return;
        const info = await getLocusBalance(key);
        out[a] = info.balance;
      } catch {
        out[a] = 0;
      }
    })
  );
  return out;
}

export async function runPipeline(
  topic = "AI agent economy breakthroughs",
  onStep?: StepCallback,
  onToken?: TokenCallback,
  onChat?: ChatCallback
): Promise<PipelineResult> {
  const chat: ChatCallback = onChat ?? (() => {});

  console.log("\n🚀 [Pipeline] Starting Dispatch news video pipeline...");
  console.log(`📰 [Pipeline] Topic: ${topic}`);

  const modeAgents: AgentName[] = ["researcher", "scriptwriter", "visual", "voice", "music"];
  const modes = modeAgents.map(getAgentMode);
  const autoCount = modes.filter((m) => m.autonomous).length;
  console.log(`🔐 [Pipeline] Autonomy: ${autoCount}/5 agents self-funding`);

  const payments: Payment[] = [];
  let totalCost = 0;

  // ── Step 0: Council ──────────────────────────────────────
  onStep?.("council", "start", "🏛️  Agents convening pre-production council...");
  const balances = await fetchAgentBalances();
  const outcome = await runCouncil(topic, balances, COMMISSION_FEE, chat);
  onStep?.("council", "done", `✅ Budget locked at $${outcome.totalEstimate.toFixed(3)} · margin $${(COMMISSION_FEE - outcome.totalEstimate).toFixed(3)}`);

  // ── Step 1: Research ──────────────────────────────────────
  onStep?.("researcher", "start", `🔍 Searching live news about "${topic}"...`);
  const research = await runResearcher(topic, (t) => onToken?.("researcher", t));
  const p1 = await payAgent("researcher", "Tavily news search");
  payments.push(p1); totalCost += p1.amount;
  onStep?.("researcher", "done", `✅ Found ${research.articles.length} articles — researcher wallet credited`);
  await announceHandoff("researcher", "scriptwriter", JSON.stringify({ headline: research.brief.headline, angle: research.brief.angle }), chat);

  // ── Step 2: Scriptwriting ─────────────────────────────────
  onStep?.("scriptwriter", "start", "✍️  Writing 4-segment broadcast script with Claude...");
  const script = await runScriptwriter(research.brief, (t) => onToken?.("scriptwriter", t));
  const p2 = await payAgent("scriptwriter", "Claude Haiku script generation");
  payments.push(p2); totalCost += p2.amount;
  onStep?.("scriptwriter", "done", `✅ Script ready: "${script.headline}" — paid $${p2.amount.toFixed(2)} USDC`);
  await announceHandoff("scriptwriter", "visual", JSON.stringify({ headline: script.headline, segments: script.segments.map((s) => s.title) }), chat);

  // ── Step 3: Visual generation ─────────────────────────────
  onStep?.("visual", "start", `🎨 Generating ${script.segments.length} cinematic images with fal.ai Flux...`);
  const visuals = await runVisual(script.segments, script, research.brief, (t) => onToken?.("visual", t));
  const p3 = await payAgent("visual", "fal.ai flux image generation");
  payments.push(p3); totalCost += p3.amount;
  onStep?.("visual", "done", `✅ ${visuals.images.length} images generated — paid $${p3.amount.toFixed(2)} USDC`);
  await announceHandoff("visual", "voice", JSON.stringify({ imageCount: visuals.images.length, mood: script.mood }), chat);

  // ── Step 4: Voice synthesis ───────────────────────────────
  onStep?.("voice", "start", "🎙️  Synthesizing broadcast narration with Deepgram...");
  const voice = await runVoice(script.segments, research.brief, (t) => onToken?.("voice", t));
  const p4 = await payAgent("voice", "Deepgram TTS narration");
  payments.push(p4); totalCost += p4.amount;
  onStep?.("voice", "done", `✅ Narration ready (${voice.durationSeconds.toFixed(0)}s) — paid $${p4.amount.toFixed(2)} USDC`);
  await announceHandoff("voice", "music", JSON.stringify({ durationSeconds: voice.durationSeconds, mood: script.mood }), chat);

  // ── Step 5: Music generation ──────────────────────────────
  onStep?.("music", "start", "🎵 Composing original background score with Suno...");
  const music = await runMusic(script, research.brief, (t) => onToken?.("music", t));
  const p5 = await payAgent("music", "Suno background music");
  payments.push(p5); totalCost += p5.amount;
  onStep?.("music", "done", `✅ Score composed — paid $${p5.amount.toFixed(2)} USDC`);
  await announceHandoff("music", "editor", JSON.stringify({ mood: script.mood, totalDuration: script.totalDuration }), chat);

  // ── Step 6: Edit & assemble ───────────────────────────────
  onStep?.("editor", "start", "🎬 Assembling video: Ken Burns motion + color grade + audio mix...");
  const videoPath = await runEditor(visuals.images, voice, music);
  onStep?.("editor", "done", `✅ Video assembled: ${videoPath.split("/").pop()}`);

  // Closing orchestrator message
  const closing: ChatMessage = {
    from: "orchestrator",
    color: "black",
    kind: "orchestrator",
    text: `Broadcast done. Five agents, $${totalCost.toFixed(3)} paid out, margin retained. Rolling the tape.`,
    ts: Date.now(),
  };
  chat(closing);

  console.log("\n✅ [Pipeline] Complete!");
  console.log(`📹 [Pipeline] Video: ${videoPath}`);
  console.log(`💰 [Pipeline] Total paid to agents: $${totalCost.toFixed(4)} USDC`);

  return { videoPath, totalCost, payments, headline: script.headline };
}
