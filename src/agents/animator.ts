import { callWrapped, logCost } from "../locus";
import { Segment } from "./scriptwriter";
import { VisualImage } from "./visual";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface VideoClip { url: string; duration: number; segmentIndex: number; }
export interface AnimatorResult { clips: VideoClip[]; }

const DEMO_CLIPS: AnimatorResult = {
  clips: [
    { url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", duration: 5, segmentIndex: 0 },
    { url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4", duration: 5, segmentIndex: 1 },
    { url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4", duration: 5, segmentIndex: 2 },
    { url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4", duration: 5, segmentIndex: 3 },
  ],
};

const VIDEO_MODEL = "fal-ai/kling-video/v1.6/standard/image-to-video";

async function pollFalStatus(model: string, requestId: string): Promise<unknown> {
  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = (await callWrapped("fal", "status", { model, request_id: requestId })) as { status?: string };
    if (statusRes.status === "COMPLETED") {
      return await callWrapped("fal", "result", { model, request_id: requestId });
    } else if (statusRes.status === "FAILED") {
      throw new Error(`fal.ai video request ${requestId} failed`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`fal.ai video request ${requestId} timed out`);
}

async function generateClip(imageUrl: string, narration: string, segmentIndex: number): Promise<VideoClip> {
  console.log(`🎬 [Animator] Generating clip for segment ${segmentIndex}...`);
  const genRes = (await callWrapped("fal", "generate", {
    model: VIDEO_MODEL, image_url: imageUrl, prompt: narration.slice(0, 300),
  })) as { request_id?: string; video?: { url?: string } };

  if (genRes.video?.url) return { url: genRes.video.url, duration: 5, segmentIndex };
  if (!genRes.request_id) throw new Error("fal.ai video generate: no request_id");

  const result = (await pollFalStatus(VIDEO_MODEL, genRes.request_id)) as { video?: { url?: string } };
  const url = result.video?.url;
  if (!url) throw new Error(`No video URL for segment ${segmentIndex}`);
  return { url, duration: 5, segmentIndex };
}

export async function runAnimator(segments: Segment[], images: VisualImage[]): Promise<AnimatorResult> {
  console.log(`🎬 [Animator] Animating ${segments.length} clips...`);
  if (DEMO_MODE) {
    logCost("animator", 0.3, "fal.ai Kling video generation (demo)");
    return DEMO_CLIPS;
  }
  const clips: VideoClip[] = [];
  for (let i = 0; i < segments.length; i++) {
    const image = images.find((img) => img.segmentIndex === i);
    if (!image) throw new Error(`No image for segment ${i}`);
    clips.push(await generateClip(image.url, segments[i].narration, i));
  }
  logCost("animator", 0.3, `fal.ai Kling — ${segments.length} clips`);
  return { clips };
}
