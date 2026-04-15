import { callWrapped, callWrappedStream, logCost } from "../locus";
import { ResearchBrief } from "./researcher";

const DEMO_MODE = process.env.DEMO_MODE === "true";
export interface MusicResult { audioUrl: string; }
const DEMO_MUSIC: MusicResult = { audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" };

interface SunoData { audioUrl: string; sourceAudioUrl: string; duration: number; }
interface SunoStatus {
  taskId: string; status: string;
  response?: { taskId: string; sunoData: SunoData[] } | null;
}

export async function runMusic(
  script: { headline: string; mood: string; totalDuration: number },
  brief: ResearchBrief,
  onToken?: (t: string) => void
): Promise<MusicResult> {
  console.log("🎵 [Music] Running music composition LLM reasoning...");
  if (DEMO_MODE) { logCost("music", 0.1, "Suno (demo)"); return DEMO_MUSIC; }

  // Music composer LLM reasoning
  let sunoPrompt = "cinematic news, dramatic, orchestral";
  let sunoTitle = "Dispatch Theme";

  try {
    const musicPrompt = `You are the music composer for Dispatch. Compose a background score brief for this specific broadcast.

Story: ${script.headline}
Mood: ${script.mood}
Emotional register: ${brief.emotionalRegister}
Duration: ~${script.totalDuration} seconds

Write a Suno music generation prompt (max 50 words) for purely instrumental broadcast score.

Return ONLY valid JSON:
{ "sunoPrompt": "...", "title": "Dispatch: [keyword]" }`;

    const musicText = await callWrappedStream(
      "anthropic",
      "chat",
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: musicPrompt }],
        max_tokens: 200,
      },
      onToken ?? (() => {})
    );

    const cleaned = musicText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { sunoPrompt?: string; title?: string };
    if (parsed.sunoPrompt) {
      sunoPrompt = parsed.sunoPrompt;
      sunoTitle = parsed.title ?? "Dispatch Theme";
      console.log(`🎵 [Music] Composer brief: "${sunoPrompt}"`);
    }
  } catch (err) {
    console.warn(`🎵 [Music] Music composition LLM failed, using default: ${(err as Error).message}`);
  }

  // Sanitize Suno prompt — only musical/technical terms, never content/thematic words
  // Suno blocks: war, crisis, collapse, geopolitical, violence, death, etc.
  const BLOCKED = /\b(war|crisis|collapse|instability|crises|geopolitic|violence|death|blood|terror|nuclear|bomb|weapon|attack|conflict|destabiliz)\w*/gi;
  const sanitized = sunoPrompt.replace(BLOCKED, "").replace(/\s+/g, " ").trim() ||
    "cinematic orchestral news broadcast, pulsing strings, dramatic brass, driving rhythm";
  if (sanitized !== sunoPrompt) {
    console.log(`🎵 [Music] Prompt sanitized (content filter avoidance): "${sanitized}"`);
    sunoPrompt = sanitized;
  }

  console.log("🎵 [Music] Generating background music via Suno...");

  try {
    // generate → { code, msg, data: { taskId } }
    const gen = (await callWrapped("suno", "generate-music", {
      customMode: true, instrumental: true, model: "V4",
      style: sunoPrompt, title: sunoTitle,
    })) as { data?: { taskId?: string } };

    const taskId = gen?.data?.taskId;
    if (!taskId) {
      console.error("🎵 [Music] Suno gen response:", JSON.stringify(gen));
      console.warn("🎵 [Music] No taskId — skipping music");
      return { audioUrl: "" };
    }
    console.log(`🎵 [Music] Task ${taskId} — polling...`);

    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const poll = (await callWrapped("suno", "get-music-status", { taskId })) as { data?: SunoStatus };
      const inner = poll?.data;
      console.log(`🎵 [Music] ${inner?.status}`);

      if (inner?.status === "SUCCESS") {
        const audioUrl = inner.response?.sunoData?.[0]?.audioUrl;
        if (!audioUrl) {
          console.warn("🎵 [Music] SUCCESS but no audioUrl — skipping music");
          return { audioUrl: "" };
        }
        logCost("music", 0.1, "Suno instrumental");
        console.log(`🎵 [Music] Ready: ${audioUrl}`);
        return { audioUrl };
      }
      if (["CREATE_TASK_FAILED","GENERATE_AUDIO_FAILED","SENSITIVE_WORD_ERROR"].includes(inner?.status ?? "")) {
        console.warn(`🎵 [Music] Suno content filter/failure (${inner?.status}) — skipping music`);
        return { audioUrl: "" };
      }
    }
    console.warn(`🎵 [Music] Suno task ${taskId} timed out — skipping music`);
    return { audioUrl: "" };
  } catch (err) {
    console.warn(`🎵 [Music] Suno error — skipping music: ${(err as Error).message}`);
    return { audioUrl: "" };
  }
}
