import axios from "axios";
import { callWrapped, callWrappedStream, logCost } from "../locus";
import { getAgentKey } from "../agent-keys";
import { Segment } from "./scriptwriter";
import { ResearchBrief } from "./researcher";

const AGENT_KEY = () => getAgentKey("visual");

const DEMO_MODE = process.env.DEMO_MODE === "true";
const IMAGE_MODEL = "fal-ai/flux/dev";

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

interface FalQueueResponse {
  request_id: string;
  status_url: string;
  response_url: string;
  status?: string;
  images?: Array<{ url: string }>;
}

async function pollFalQueue(statusUrl: string, responseUrl: string): Promise<{ images: Array<{ url: string }> }> {
  for (let i = 0; i < 30; i++) {
    const { data: status } = await axios.get<{ status: string }>(statusUrl);
    if (status.status === "COMPLETED") {
      const { data: result } = await axios.get<{ images: Array<{ url: string }> }>(responseUrl);
      return result;
    } else if (status.status === "FAILED") {
      throw new Error("fal.ai image generation failed");
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("fal.ai image generation timed out");
}

export async function generateImage(prompt: string, segmentIndex: number): Promise<VisualImage> {
  console.log(`🎨 [Visual] Generating image ${segmentIndex + 1}/4...`);

  const genRes = (await callWrapped("fal", "generate", {
    model: IMAGE_MODEL, prompt, num_images: 1,
  }, AGENT_KEY())) as FalQueueResponse;

  // Synchronous response (images already returned)
  if (genRes.images?.[0]?.url) {
    return { url: genRes.images[0].url, segmentIndex };
  }

  if (!genRes.status_url || !genRes.response_url) {
    throw new Error("fal.ai generate: missing queue URLs");
  }

  const result = await pollFalQueue(genRes.status_url, genRes.response_url);
  const url = result.images?.[0]?.url;
  if (!url) throw new Error(`No image URL for segment ${segmentIndex}`);
  console.log(`🎨 [Visual] Image ${segmentIndex + 1} ready: ${url.slice(0, 60)}...`);
  return { url, segmentIndex };
}

export async function runVisual(
  segments: Segment[],
  script: { headline: string; mood: string },
  brief: ResearchBrief,
  onToken?: (t: string) => void
): Promise<VisualResult> {
  if (DEMO_MODE) {
    logCost("visual", 0.08, "fal.ai flux/dev — demo");
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
  logCost("visual", 0.08, `fal.ai flux/dev — ${segments.length} images`);
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
    logCost("visual", 0.02 * count, `fal.ai flux/dev supplementary — demo`);
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

  logCost("visual", 0.02 * count, `fal.ai flux/dev supplementary — ${count} frames`);
  return images;
}
