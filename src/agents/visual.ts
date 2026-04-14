import { callWrapped, logCost } from "../locus";
import { Segment } from "./scriptwriter";

// ============================================================
// Visual Agent
// Generates images for each script segment via fal.ai flux/dev
// Cost: ~$0.08 total (4 images × ~$0.02 each)
// ============================================================

// DEMO MODE
const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface VisualImage {
  url: string;
  segmentIndex: number;
}

export interface VisualResult {
  images: VisualImage[];
}

const DEMO_IMAGES: VisualResult = {
  images: [
    {
      url: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1280",
      segmentIndex: 0,
    },
    {
      url: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=1280",
      segmentIndex: 1,
    },
    {
      url: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1280",
      segmentIndex: 2,
    },
    {
      url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280",
      segmentIndex: 3,
    },
  ],
};

async function pollFalStatus(requestId: string): Promise<unknown> {
  const maxAttempts = 30;
  const delayMs = 3000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = (await callWrapped("fal", "status", {
      request_id: requestId,
    })) as { status?: string };

    if (statusRes.status === "COMPLETED") {
      // Fetch the actual result
      const result = await callWrapped("fal", "result", {
        request_id: requestId,
      });
      return result;
    } else if (statusRes.status === "FAILED") {
      throw new Error(`fal.ai request ${requestId} failed`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`fal.ai request ${requestId} timed out after ${maxAttempts} attempts`);
}

async function generateImage(
  prompt: string,
  segmentIndex: number
): Promise<VisualImage> {
  console.log(`🎨 [Visual] Generating image for segment ${segmentIndex}...`);

  const genRes = (await callWrapped("fal", "generate", {
    model: "fal-ai/flux/dev",
    prompt,
    num_images: 1,
  })) as { request_id?: string };

  if (!genRes.request_id) {
    throw new Error("fal.ai generate did not return a request_id");
  }

  const result = (await pollFalStatus(genRes.request_id)) as {
    images?: Array<{ url?: string }>;
  };

  const url = result.images?.[0]?.url;
  if (!url) {
    throw new Error(`No image URL returned for segment ${segmentIndex}`);
  }

  return { url, segmentIndex };
}

export async function runVisual(segments: Segment[]): Promise<VisualResult> {
  console.log(`🎨 [Visual] Generating ${segments.length} images...`);

  if (DEMO_MODE) {
    console.log("🎨 [Visual] DEMO MODE — returning placeholder images");
    logCost("visual", 0.08, "fal.ai flux/dev image generation (demo)");
    return DEMO_IMAGES;
  }

  const images: VisualImage[] = [];

  for (let i = 0; i < segments.length; i++) {
    const image = await generateImage(segments[i].imagePrompt, i);
    images.push(image);
  }

  logCost("visual", 0.08, `fal.ai flux/dev — ${segments.length} images`);
  console.log(`🎨 [Visual] All ${images.length} images generated`);

  return { images };
}
