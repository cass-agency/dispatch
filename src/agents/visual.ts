import { callWrapped, logCost } from "../locus";
import { Segment } from "./scriptwriter";

const DEMO_MODE = process.env.DEMO_MODE === "true";

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

const IMAGE_MODEL = "fal-ai/flux/dev";

async function pollFalStatus(model: string, requestId: string): Promise<unknown> {
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = (await callWrapped("fal", "status", { model, request_id: requestId })) as { status?: string };
    if (statusRes.status === "COMPLETED") {
      return await callWrapped("fal", "result", { model, request_id: requestId });
    } else if (statusRes.status === "FAILED") {
      throw new Error(`fal.ai request ${requestId} failed`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`fal.ai request ${requestId} timed out`);
}

async function generateImage(prompt: string, segmentIndex: number): Promise<VisualImage> {
  console.log(`🎨 [Visual] Generating image for segment ${segmentIndex}...`);
  const genRes = (await callWrapped("fal", "generate", {
    model: IMAGE_MODEL, prompt, num_images: 1,
  })) as { request_id?: string; images?: Array<{ url?: string }> };

  // fal.ai may return synchronously (images in response) or async (request_id)
  if (genRes.images?.[0]?.url) {
    return { url: genRes.images[0].url!, segmentIndex };
  }
  if (!genRes.request_id) throw new Error("fal.ai generate: no request_id or images");

  const result = (await pollFalStatus(IMAGE_MODEL, genRes.request_id)) as { images?: Array<{ url?: string }> };
  const url = result.images?.[0]?.url;
  if (!url) throw new Error(`No image URL for segment ${segmentIndex}`);
  return { url, segmentIndex };
}

export async function runVisual(segments: Segment[]): Promise<VisualResult> {
  console.log(`🎨 [Visual] Generating ${segments.length} images...`);
  if (DEMO_MODE) {
    logCost("visual", 0.08, "fal.ai flux/dev image generation (demo)");
    return DEMO_IMAGES;
  }
  const images: VisualImage[] = [];
  for (let i = 0; i < segments.length; i++) {
    images.push(await generateImage(segments[i].imagePrompt, i));
  }
  logCost("visual", 0.08, `fal.ai flux/dev — ${segments.length} images`);
  return { images };
}
