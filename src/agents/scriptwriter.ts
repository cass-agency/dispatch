import { callWrapped, logCost } from "../locus";

// ============================================================
// Scriptwriter Agent
// Takes research summary, writes 90-second video script
// Uses Claude haiku
// Cost: ~$0.01
// ============================================================

// DEMO MODE
const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface Segment {
  title: string;
  narration: string;
  imagePrompt: string;
  duration: number; // seconds
}

export interface Script {
  headline: string;
  segments: Segment[];
  mood: string;
  totalDuration: number; // seconds
}

const DEMO_SCRIPT: Script = {
  headline: "AI Agents Are Rewriting the Rules of the Global Economy",
  mood: "urgent, optimistic, cinematic",
  totalDuration: 88,
  segments: [
    {
      title: "The Dawn of Agent Economy",
      narration:
        "A quiet revolution is underway. Across financial markets, supply chains, and research labs, autonomous AI agents are taking on tasks once reserved for humans. The numbers are staggering: productivity in sectors deploying agents has jumped by thirty percent in under a year.",
      imagePrompt:
        "Futuristic cityscape at dawn, glowing digital networks connecting skyscrapers, autonomous drones weaving between buildings, cinematic wide shot, ultra-realistic",
      duration: 22,
    },
    {
      title: "Payments Without Friction",
      narration:
        "Central to this shift is a new kind of financial infrastructure. The Locus network allows AI agents to pay each other in real time using USDC stablecoins. No banks, no delays, no middlemen. An agent completes a task, receives compensation, and immediately reinvests — all in milliseconds.",
      imagePrompt:
        "Abstract visualization of USDC tokens flowing through glowing fiber-optic channels, cryptocurrency nodes lighting up in sequence, dark background, neon blue and gold",
      duration: 22,
    },
    {
      title: "Big Tech Joins the Race",
      narration:
        "Major AI labs are accelerating the trend. OpenAI's Operator framework now lets GPT-4 models browse the web, run code, and complete complex workflows autonomously. Google's Project Mariner is following close behind. The race to build the most capable autonomous agents has entered overdrive.",
      imagePrompt:
        "Giant glowing AI neural network brain floating above a futuristic tech campus, data streams cascading like waterfalls, dramatic lighting, photorealistic",
      duration: 22,
    },
    {
      title: "What Comes Next",
      narration:
        "Analysts project the agent economy will surpass one trillion dollars by 2027. Governments are scrambling to write regulation. Workers are asking hard questions about the future of employment. One thing is certain: the age of autonomous AI is not approaching — it has already arrived.",
      imagePrompt:
        "Earth from orbit with glowing network connections spanning continents, golden light on the horizon suggesting sunrise, epic cinematic composition, ultra HD",
      duration: 22,
    },
  ],
};

export async function runScriptwriter(summary: string): Promise<Script> {
  console.log("✍️ [Scriptwriter] Writing 90-second video script...");

  if (DEMO_MODE) {
    console.log("✍️ [Scriptwriter] DEMO MODE — returning placeholder script");
    logCost("scriptwriter", 0.01, "Claude Haiku script generation (demo)");
    return DEMO_SCRIPT;
  }

  const prompt = `You are a professional broadcast news scriptwriter. Based on the research summary below, write a 90-second video script for a news segment about the AI agent economy.

Research Summary:
${summary}

Return ONLY a valid JSON object with this exact structure:
{
  "headline": "compelling 10-word headline",
  "mood": "3 comma-separated mood words",
  "totalDuration": 88,
  "segments": [
    {
      "title": "segment title",
      "narration": "~100 words of broadcast narration",
      "imagePrompt": "detailed Stable Diffusion image prompt, photorealistic, cinematic",
      "duration": 22
    }
  ]
}

Requirements:
- Exactly 4 segments
- Each narration ~100 words, suitable for TTS
- Each imagePrompt is detailed, cinematic, photorealistic
- mood describes the visual and emotional tone
- totalDuration = 88 seconds
- JSON only, no markdown, no extra text`;

  const raw = (await callWrapped("anthropic", "chat", {
    model: "claude-haiku-4-5",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1000,
  })) as { content?: Array<{ text?: string }> };

  const text = raw.content?.[0]?.text ?? "";

  let script: Script;
  try {
    // Strip possible markdown code fences
    const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    script = JSON.parse(cleaned) as Script;
  } catch {
    throw new Error(`Scriptwriter: failed to parse Claude response as JSON: ${text.slice(0, 200)}`);
  }

  logCost("scriptwriter", 0.01, "Claude Haiku script generation");
  console.log(`✍️ [Scriptwriter] Script ready: "${script.headline}" (${script.segments.length} segments)`);

  return script;
}
