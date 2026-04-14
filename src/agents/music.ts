import { callWrapped, logCost } from "../locus";

// ============================================================
// Music Agent
// Generates instrumental news background music via Suno
// Cost: ~$0.10
// ============================================================

const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface MusicResult {
  audioUrl: string;
}

const DEMO_MUSIC: MusicResult = {
  audioUrl:
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
};

export async function runMusic(): Promise<MusicResult> {
  console.log("🎵 [Music] Generating background music via Suno...");

  if (DEMO_MODE) {
    console.log("🎵 [Music] DEMO MODE — returning placeholder music URL");
    logCost("music", 0.1, "Suno music generation (demo)");
    return DEMO_MUSIC;
  }

  const genRes = (await callWrapped("suno", "generate-music", {
    customMode: true,
    instrumental: true,
    model: "V4",
    style: "cinematic news, dramatic",
    title: "Dispatch Theme",
  })) as { taskId?: string };

  if (!genRes.taskId) {
    throw new Error("Suno generate-music did not return a taskId");
  }

  const taskId = genRes.taskId;
  console.log(`🎵 [Music] Polling Suno task ${taskId}...`);

  const maxAttempts = 30;
  const delayMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = (await callWrapped("suno", "get-music-status", {
      taskId,
    })) as { status?: string; data?: Array<{ audioUrl?: string }> };

    if (statusRes.status === "SUCCESS") {
      const audioUrl = statusRes.data?.[0]?.audioUrl;
      if (!audioUrl) {
        throw new Error("Suno returned SUCCESS but no audioUrl");
      }
      logCost("music", 0.1, "Suno instrumental music generation");
      console.log(`🎵 [Music] Music ready: ${audioUrl}`);
      return { audioUrl };
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Suno task ${taskId} timed out`);
}
