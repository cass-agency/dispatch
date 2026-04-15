import { callWrapped, logCost } from "../locus";

const DEMO_MODE = process.env.DEMO_MODE === "true";
export interface MusicResult { audioUrl: string; }
const DEMO_MUSIC: MusicResult = { audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" };

interface SunoData { audioUrl: string; sourceAudioUrl: string; duration: number; }
interface SunoStatus {
  taskId: string; status: string;
  response?: { taskId: string; sunoData: SunoData[] } | null;
}

export async function runMusic(): Promise<MusicResult> {
  console.log("🎵 [Music] Generating background music via Suno...");
  if (DEMO_MODE) { logCost("music", 0.1, "Suno (demo)"); return DEMO_MUSIC; }

  // generate → { code, msg, data: { taskId } }
  const gen = (await callWrapped("suno", "generate-music", {
    customMode: true, instrumental: true, model: "V4",
    style: "cinematic news, dramatic, orchestral", title: "Dispatch Theme",
  })) as { data?: { taskId?: string } };

  const taskId = gen?.data?.taskId;
  if (!taskId) { console.error("Suno gen response:", JSON.stringify(gen)); throw new Error("Suno: no taskId returned"); }
  console.log(`🎵 [Music] Task ${taskId} — polling...`);

  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    // Retry up to 3 times on transient network errors before propagating
    let poll: { data?: SunoStatus } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        poll = (await callWrapped("suno", "get-music-status", { taskId })) as { data?: SunoStatus };
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`🎵 [Music] Status poll attempt ${attempt + 1} failed (${msg}) — retrying...`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
        else throw err; // rethrow after 3 failures
      }
    }

    const inner = poll?.data;
    console.log(`🎵 [Music] ${inner?.status}`);

    if (inner?.status === "SUCCESS") {
      const audioUrl = inner.response?.sunoData?.[0]?.audioUrl;
      if (!audioUrl) throw new Error("Suno SUCCESS but sunoData[0].audioUrl missing");
      logCost("music", 0.1, "Suno instrumental");
      console.log(`🎵 [Music] Ready: ${audioUrl}`);
      return { audioUrl };
    }
    if (["CREATE_TASK_FAILED","GENERATE_AUDIO_FAILED","SENSITIVE_WORD_ERROR"].includes(inner?.status ?? "")) {
      throw new Error(`Suno failed: ${inner?.status}`);
    }
  }
  throw new Error(`Suno task ${taskId} timed out`);
}

