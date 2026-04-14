import { callWrapped, logCost } from "../locus";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface MusicResult { audioUrl: string; }

const DEMO_MUSIC: MusicResult = {
  audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
};

// Suno response wrapper: callWrapped returns { code, msg, data: {...} }
interface SunoOuter<T> { code: number; msg: string; data: T; }

export async function runMusic(): Promise<MusicResult> {
  console.log("🎵 [Music] Generating background music via Suno...");

  if (DEMO_MODE) {
    logCost("music", 0.1, "Suno music generation (demo)");
    return DEMO_MUSIC;
  }

  const genOuter = (await callWrapped("suno", "generate-music", {
    customMode: true,
    instrumental: true,
    model: "V4",
    style: "cinematic news, dramatic, orchestral",
    title: "Dispatch Theme",
  })) as SunoOuter<{ taskId: string }>;

  const taskId = genOuter?.data?.taskId;
  if (!taskId) {
    console.error("Suno generate response:", JSON.stringify(genOuter));
    throw new Error("Suno generate-music did not return a taskId");
  }
  console.log(`🎵 [Music] Suno task ${taskId} — polling...`);

  for (let attempt = 0; attempt < 36; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusOuter = (await callWrapped("suno", "get-music-status", {
      taskId,
    })) as SunoOuter<{
      taskId: string;
      status: string;
      response?: Array<{ audioUrl?: string }> | null;
    }>;

    const inner = statusOuter?.data;
    const status = inner?.status;
    console.log(`🎵 [Music] Suno status: ${status}`);

    if (status === "SUCCESS") {
      const audioUrl = inner?.response?.[0]?.audioUrl;
      if (!audioUrl) throw new Error("Suno SUCCESS but no audioUrl in response");
      logCost("music", 0.1, "Suno instrumental music generation");
      console.log(`🎵 [Music] Music ready: ${audioUrl}`);
      return { audioUrl };
    }

    if (status === "CREATE_TASK_FAILED" || status === "GENERATE_AUDIO_FAILED" || status === "SENSITIVE_WORD_ERROR") {
      throw new Error(`Suno task failed with status: ${status}`);
    }
  }

  throw new Error(`Suno task ${taskId} timed out after 3 minutes`);
}
