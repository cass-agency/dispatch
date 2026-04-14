import { callWrapped, logCost } from "../locus";
import { Segment } from "./scriptwriter";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface VoiceResult {
  audioBuffer: Buffer;
  durationSeconds: number;
}

export async function runVoice(segments: Segment[]): Promise<VoiceResult> {
  console.log("🎙️ [Voice] Generating narration audio...");

  const fullNarration = segments.map((s) => s.narration).join("  ");

  if (DEMO_MODE) {
    logCost("voice", 0.02, "Deepgram TTS (demo)");
    const silentMp3 = Buffer.from("fffb9000000000000000000000000000000000000000", "hex");
    return { audioBuffer: silentMp3, durationSeconds: 88 };
  }

  // Deepgram max ~2000 chars per call — split if needed
  const MAX_CHARS = 1800;
  const chunks: string[] = [];
  if (fullNarration.length <= MAX_CHARS) {
    chunks.push(fullNarration);
  } else {
    // Split by sentence boundaries
    const sentences = fullNarration.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      if ((current + " " + sentence).trim().length > MAX_CHARS) {
        if (current) chunks.push(current.trim());
        current = sentence;
      } else {
        current = (current + " " + sentence).trim();
      }
    }
    if (current) chunks.push(current.trim());
  }

  console.log(`🎙️ [Voice] Sending ${chunks.length} TTS chunk(s), total ${fullNarration.length} chars`);

  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const raw = (await callWrapped("deepgram", "speak", {
      text: chunk,
      model: "aura-2-thalia-en",
      encoding: "mp3",
    })) as { data?: string; content_type?: string };

    // Deepgram returns { data: "<base64 mp3>", content_type: "audio/mpeg" }
    const audioBase64 = raw.data;
    if (!audioBase64) {
      console.error("Deepgram response keys:", Object.keys(raw));
      throw new Error("Deepgram TTS did not return audio data");
    }
    audioBuffers.push(Buffer.from(audioBase64, "base64"));
  }

  const audioBuffer = Buffer.concat(audioBuffers);
  const wordCount = fullNarration.split(/\s+/).length;
  const durationSeconds = Math.round((wordCount / 150) * 60);

  logCost("voice", 0.02, `Deepgram TTS — ${wordCount} words`);
  console.log(`🎙️ [Voice] Audio ready: ${audioBuffer.length} bytes, ~${durationSeconds}s`);

  return { audioBuffer, durationSeconds };
}
