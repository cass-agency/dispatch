import { callWrapped, logCost } from "../locus";
import { Segment } from "./scriptwriter";

// ============================================================
// Voice Agent
// Concatenates all narration, generates single MP3 via Deepgram TTS
// Cost: ~$0.02
// ============================================================

const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface VoiceResult {
  audioBuffer: Buffer;
  durationSeconds: number;
}

export async function runVoice(segments: Segment[]): Promise<VoiceResult> {
  console.log("🎙️ [Voice] Generating narration audio...");

  const fullNarration = segments
    .map((s, i) => `${s.narration}`)
    .join("  ");

  if (DEMO_MODE) {
    console.log("🎙️ [Voice] DEMO MODE — returning silent audio buffer");
    logCost("voice", 0.02, "Deepgram TTS (demo)");
    // Return a minimal valid MP3 buffer (silence)
    const silentMp3 = Buffer.from(
      "fffb9000000000000000000000000000000000000000",
      "hex"
    );
    return { audioBuffer: silentMp3, durationSeconds: 88 };
  }

  const raw = (await callWrapped("deepgram", "speak", {
    text: fullNarration,
    model: "aura-2-thalia-en",
    encoding: "mp3",
  })) as { data?: { audio?: string } };

  const audioBase64 = raw.data?.audio;
  if (!audioBase64) {
    throw new Error("Deepgram TTS did not return audio data");
  }

  const audioBuffer = Buffer.from(audioBase64, "base64");
  // Estimate duration: ~150 words per minute, ~100 words per segment
  const wordCount = fullNarration.split(/\s+/).length;
  const durationSeconds = Math.round((wordCount / 150) * 60);

  logCost("voice", 0.02, `Deepgram TTS — ${wordCount} words`);
  console.log(
    `🎙️ [Voice] Audio ready: ${audioBuffer.length} bytes, ~${durationSeconds}s`
  );

  return { audioBuffer, durationSeconds };
}
