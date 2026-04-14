import { callWrapped, logCost } from "../locus";
import { Segment } from "./scriptwriter";
import { VisualImage } from "./visual";

// ============================================================
// Animator Agent
// Takes each image URL + segment narration → 5-second video clip
// Uses fal-ai/kling-video/v1.6/standard/image-to-video
// Cost: ~$0.30 total (4 clips × ~$0.075 each)
// ============================================================

// DEMO MODE
const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface VideoClip {
  url: string;
  duration: number; // seconds
  segmentIndex: number;
}

export interface AnimatorResult {
  clips: VideoClip[];
}

const DEMO_CLIPS: AnimatorResult = {
  clips: [
    {
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
      duration: 5,
      segmentIndex: 0,
    },
    {
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
      duration: 5,
      segmentIndex: 1,
    },
    {
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
      duration: 5,
      segmentIndex: 2,
    },
    {
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
      duration: 5,
      segmentIndex: 3,
    },
  ],
};

async function pollFalStatus(requestId: string): Promise<unknown> {
  const maxAttempts = 40;
  const delayMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = (await callWrapped("fal", "status", {
      request_id: requestId,
    })) as { status?: string };

    if (statusRes.status === "COMPLETED") {
      const result = await callWrapped("fal", "result", {
        request_id: requestId,
      });
      return result;
    } else if (statusRes.status === "FAILED") {
      throw new Error(`fal.ai video request ${requestId} failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(
    `fal.ai video request ${requestId} timed out after ${maxAttempts} attempts`
  );
}

async function generateClip(
  imageUrl: string,
  narration: string,
  segmentIndex: number
): Promise<VideoClip> {
  console.log(`🎬 [Animator] Generating video clip for segment ${segmentIndex}...`);

  const genRes = (await callWrapped("fal", "generate", {
    model: "fal-ai/kling-video/v1.6/standard/image-to-video",
    image_url: imageUrl,
    prompt: narration.slice(0, 300), // Kling prompt limit
  })) as { request_id?: string };

  if (!genRes.request_id) {
    throw new Error("fal.ai video generate did not return a request_id");
  }

  const result = (await pollFalStatus(genRes.request_id)) as {
    video?: { url?: string };
  };

  const url = result.video?.url;
  if (!url) {
    throw new Error(`No video URL returned for segment ${segmentIndex}`);
  }

  return { url, duration: 5, segmentIndex };
}

export async function runAnimator(
  segments: Segment[],
  images: VisualImage[]
): Promise<AnimatorResult> {
  console.log(`🎬 [Animator] Animating ${segments.length} clips...`);

  if (DEMO_MODE) {
    console.log("🎬 [Animator] DEMO MODE — returning placeholder clips");
    logCost("animator", 0.3, "fal.ai Kling video generation (demo)");
    return DEMO_CLIPS;
  }

  const clips: VideoClip[] = [];

  for (let i = 0; i < segments.length; i++) {
    const image = images.find((img) => img.segmentIndex === i);
    if (!image) {
      throw new Error(`No image found for segment ${i}`);
    }
    const clip = await generateClip(image.url, segments[i].narration, i);
    clips.push(clip);
  }

  logCost("animator", 0.3, `fal.ai Kling — ${segments.length} video clips`);
  console.log(`🎬 [Animator] All ${clips.length} clips ready`);

  return { clips };
}
