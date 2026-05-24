import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { callWrapped, callWrappedStream, logCost } from "../locus";
import { getAgentKey } from "../agent-keys";
import { Segment } from "./scriptwriter";
import { ResearchBrief } from "./researcher";

const AGENT_KEY = () => getAgentKey("visual");

const DEMO_MODE = process.env.DEMO_MODE === "true";

// We use Locus's wrapped Stability AI generate-core (synchronous, returns
// base64 PNG). Previously used fal.ai/flux/dev, but Locus's wrapped fal
// endpoint returns queue URLs that point at queue.fal.run and reject all
// auth — pipeline polling fails with 401. Stability is sync, no polling.
const IMAGE_PROVIDER = "stability-ai";
const IMAGE_ENDPOINT = "generate-core";
const IMAGE_ASPECT   = "16:9";

export interface VisualImage { url: string; segmentIndex: number; }
export interface VisualResult { images: VisualImage[]; }

const DEMO_IMAGES: VisualResult = {
  images: [
    { url: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1280", segmentIndex: 0 },
    { url: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=1280", segmentIndex: 1 },
    { url: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1280", segmentIndex: 2 },
    { url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280", segmentIndex: 3 },
  ],
};

interface StabilityResponse {
  image?: string;          // base64 PNG/JPEG
  finish_reason?: string;
  seed?: number;
}

export async function generateImage(prompt: string, segmentIndex: number): Promise<VisualImage> {
  console.log(`🎨 [Visual] Generating image ${segmentIndex + 1}/4 via ${IMAGE_PROVIDER}/${IMAGE_ENDPOINT}...`);

  const res = (await callWrapped(
    IMAGE_PROVIDER,
    IMAGE_ENDPOINT,
    { prompt, aspect_ratio: IMAGE_ASPECT, output_format: "png" },
    AGENT_KEY()
  )) as StabilityResponse;

  if (res.finish_reason && res.finish_reason !== "SUCCESS") {
    throw new Error(`Stability generate failed: ${res.finish_reason}`);
  }
  if (!res.image) {
    throw new Error(`Stability generate: missing image bytes for segment ${segmentIndex}`);
  }

  // Persist to tmp so the editor's downloader can pick it up by path.
  const tmpDir = path.join(os.tmpdir(), "dispatch-imgs");
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `seg-${segmentIndex}-${crypto.randomBytes(6).toString("hex")}.png`);
  fs.writeFileSync(filePath, Buffer.from(res.image, "base64"));

  console.log(`🎨 [Visual] Image ${segmentIndex + 1} ready: ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(0)} KB)`);
  return { url: filePath, segmentIndex };
}

export async function runVisual(
  segments: Segment[],
  script: { headline: string; mood: string },
  brief: ResearchBrief,
  onToken?: (t: string) => void
): Promise<VisualResult> {
  if (DEMO_MODE) {
    logCost("visual", 0.08, "stability-ai/generate-core — demo");
    return DEMO_IMAGES;
  }

  console.log(`🎨 [Visual] Running visual direction LLM reasoning...`);

  // Visual director LLM reasoning
  let imagePrompts: string[] = segments.map((s) => s.imagePrompt);
  try {
    const visualPrompt = `You are the visual director for Dispatch. Plan the cinematography for a 4-segment news broadcast.

Story: ${script.headline}
Mood: ${script.mood}
Emotional register: ${brief.emotionalRegister}

Narration by segment:
${segments.map((s, i) => `[${i + 1}] "${s.title}": ${s.narration.slice(0, 150)}`).join("\n")}

Design 4 image prompts with a coherent visual language (consistent color palette, lighting, composition style that evolves across the arc). Each image advances the visual story.

Return ONLY valid JSON:
{
  "visualConcept": "one sentence describing the overall visual approach",
  "imagePrompts": ["prompt1", "prompt2", "prompt3", "prompt4"]
}`;

    const visualText = await callWrappedStream(
      "anthropic",
      "chat",
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: visualPrompt }],
        max_tokens: 600,
      },
      onToken ?? (() => {}),
      AGENT_KEY()
    );

    const cleaned = visualText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { visualConcept?: string; imagePrompts?: string[] };
    if (Array.isArray(parsed.imagePrompts) && parsed.imagePrompts.length === 4) {
      imagePrompts = parsed.imagePrompts;
      console.log(`🎨 [Visual] Visual concept: ${parsed.visualConcept}`);
    }
  } catch (err) {
    console.warn(`🎨 [Visual] Visual direction LLM failed, using segment prompts: ${(err as Error).message}`);
  }

  console.log(`🎨 [Visual] Generating ${segments.length} images...`);
  const images: VisualImage[] = [];
  for (let i = 0; i < segments.length; i++) {
    images.push(await generateImage(imagePrompts[i] ?? segments[i].imagePrompt, i));
  }
  logCost("visual", 0.08, `${IMAGE_PROVIDER}/${IMAGE_ENDPOINT} — ${segments.length} images`);
  return { images };
}

// Supplementary render: called when the voice track exceeds the original 4-frame budget.
// The visual director is re-engaged via Haiku to propose `count` more prompts that extend
// the visual language, then Flux generates them.
export async function runVisualExtra(
  count: number,
  script: { headline: string; mood: string; segments: Segment[] },
  brief: ResearchBrief,
  startIndex: number,
  onToken?: (t: string) => void
): Promise<VisualImage[]> {
  if (DEMO_MODE) {
    logCost("visual", 0.02 * count, `${IMAGE_PROVIDER}/${IMAGE_ENDPOINT} supplementary — demo`);
    return [];
  }

  // Ask the visual director for `count` extra prompts
  let prompts: string[] = [];
  try {
    const prompt = `You are the visual director for Dispatch. You already produced ${script.segments.length} cinematic frames for this broadcast. The voiceover came in longer than anticipated — dispatch wants ${count} MORE frame${count > 1 ? "s" : ""} to cover the extra runtime with coherent visuals.

Story: ${script.headline}
Mood: ${script.mood}
Emotional register: ${brief.emotionalRegister}
Existing segments you already covered:
${script.segments.map((s, i) => `[${i + 1}] ${s.title}: ${s.imagePrompt.slice(0, 80)}`).join("\n")}

Design ${count} ADDITIONAL prompt${count > 1 ? "s" : ""} — alternate angles, establishing shots, deeper dives into the themes. Keep the visual language consistent but don't simply duplicate existing frames.

Return ONLY valid JSON:
{"imagePrompts": [${Array.from({ length: count }, () => '"..."').join(", ")}]}`;

    const raw = await callWrappedStream(
      "anthropic",
      "chat",
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
      },
      onToken ?? (() => {}),
      AGENT_KEY()
    );
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { imagePrompts?: string[] };
    if (Array.isArray(parsed.imagePrompts)) prompts = parsed.imagePrompts;
  } catch (e) {
    console.warn(`🎨 [Visual] extra-director LLM failed, falling back: ${(e as Error).message}`);
  }

  while (prompts.length < count) {
    const seg = script.segments[prompts.length % script.segments.length];
    prompts.push(seg.imagePrompt + ", alternate cinematic angle");
  }

  const images: VisualImage[] = [];
  for (let i = 0; i < count; i++) {
    const img = await generateImage(prompts[i], startIndex + i);
    images.push(img);
  }

  logCost("visual", 0.02 * count, `${IMAGE_PROVIDER}/${IMAGE_ENDPOINT} supplementary — ${count} frames`);
  return images;
}
