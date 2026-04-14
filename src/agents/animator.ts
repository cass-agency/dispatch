import axios from "axios";
import { callWrapped, logCost } from "../locus";
import { Segment } from "./scriptwriter";
import { VisualImage } from "./visual";

const DEMO_MODE = process.env.DEMO_MODE === "true";
const VIDEO_MODEL = "fal-ai/kling-video/v1.6/standard/image-to-video";

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

interface FalQueueResponse {
  request_id: string;
  status_url: string;
  response_url: string;
  status?: string;
  video?: { url: string };
}

async function pollFalQueue(statusUrl: string, responseUrl: string): Promise<{ video: { url: string } }> {
  for (let i = 0; i < 60; i++) {
    const { data: status } = await axios.get<{ status: string }>(statusUrl);
    if (status.status === "COMPLETED") {
      const { data: result } = await axios.get<{ video: { url: string } }>(responseUrl);
      return result;
    } else if (status.status === "FAILED") {
      throw new Error("fal.ai video generation failed");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("fal.ai video generation timed out");
}

async function generateClip(imageUrl: string, narration: string, segmentIndex: number): Promise<VideoClip> {
  console.log(`🎬 [Animator] Generating clip ${segmentIndex + 1}/4...`);

  const genRes = (await callWrapped("fal", "generate", {
    model: VIDEO_MODEL, image_url: imageUrl, prompt: narration.slice(0, 300),
  })) as FalQueueResponse;

  if (genRes.video?.url) return { url: genRes.video.url, duration: 5, segmentIndex };
  if (!genRes.status_url || !genRes.response_url) throw new Error("fal.ai video: missing queue URLs");

  const result = await pollFalQueue(genRes.status_url, genRes.response_url);
  console.log(`🎬 [Animator] Clip ${segmentIndex + 1} ready`);
  return { url: result.video.url, duration: 5, segmentIndex };
}

export async function runAnimator(segments: Segment[], images: VisualImage[]): Promise<AnimatorResult> {
  if (DEMO_MODE) {
    logCost("animator", 0.3, "fal.ai Kling — demo");
    return DEMO_CLIPS;
  }
  console.log(`🎬 [Animator] Animating ${segments.length} clips...`);
  const clips: VideoClip[] = [];
  for (let i = 0; i < segments.length; i++) {
    const image = images.find((img) => img.segmentIndex === i);
    if (!image) throw new Error(`No image for segment ${i}`);
    clips.push(await generateClip(image.url, segments[i].narration, i));
  }
  logCost("animator", 0.3, `fal.ai Kling — ${segments.length} clips`);
  return { clips };
}
