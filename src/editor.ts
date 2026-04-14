import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import ffmpeg from "fluent-ffmpeg";
import { VideoClip } from "./agents/animator";
import { VoiceResult } from "./agents/voice";
import { MusicResult } from "./agents/music";

// ============================================================
// Editor
// Assembles final video using fluent-ffmpeg
// Steps:
//   1. Download each video clip to /tmp
//   2. Write narration audio to /tmp
//   3. Download music track to /tmp
//   4. Concatenate video clips
//   5. Mix narration + music (music at -20dB)
//   6. Return output path
// ============================================================

const DEMO_MODE = process.env.DEMO_MODE === "true";

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith("https") ? https : http;
    protocol
      .get(url, (res) => {
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

function runFfmpeg(command: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    command
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

export async function runEditor(
  clips: VideoClip[],
  voice: VoiceResult,
  music: MusicResult
): Promise<string> {
  const timestamp = Date.now();
  const outputPath = `/tmp/dispatch-${timestamp}.mp4`;

  console.log("🎞️ [Editor] Starting video assembly...");

  if (DEMO_MODE) {
    console.log("🎞️ [Editor] DEMO MODE — creating placeholder output path");
    // Write a minimal marker file so the server can return something
    fs.writeFileSync(outputPath, "DEMO_VIDEO_PLACEHOLDER");
    return outputPath;
  }

  // 1. Download video clips
  const clipPaths: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const clipPath = `/tmp/dispatch-clip-${timestamp}-${i}.mp4`;
    console.log(`🎞️ [Editor] Downloading clip ${i}...`);
    await downloadFile(clips[i].url, clipPath);
    clipPaths.push(clipPath);
  }

  // 2. Write narration audio
  const voicePath = `/tmp/dispatch-voice-${timestamp}.mp3`;
  fs.writeFileSync(voicePath, voice.audioBuffer);

  // 3. Download music
  const musicPath = `/tmp/dispatch-music-${timestamp}.mp3`;
  console.log("🎞️ [Editor] Downloading music track...");
  await downloadFile(music.audioUrl, musicPath);

  // 4. Create concat file for ffmpeg
  const concatListPath = `/tmp/dispatch-list-${timestamp}.txt`;
  const concatContent = clipPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(concatListPath, concatContent);

  const concatenatedPath = `/tmp/dispatch-concat-${timestamp}.mp4`;

  // Concatenate clips
  console.log("🎞️ [Editor] Concatenating video clips...");
  await runFfmpeg(
    ffmpeg()
      .input(concatListPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions(["-c", "copy"])
      .output(concatenatedPath)
  );

  // 5. Mix narration + music, mux with video
  console.log("🎞️ [Editor] Mixing audio and muxing final video...");
  await runFfmpeg(
    ffmpeg()
      .input(concatenatedPath)
      .input(voicePath)
      .input(musicPath)
      .complexFilter([
        // Lower music volume to -20dB
        "[2:a]volume=0.1[music]",
        // Mix narration and music
        "[1:a][music]amix=inputs=2:duration=first[audio]",
      ])
      .outputOptions([
        "-map", "0:v",
        "-map", "[audio]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
      ])
      .output(outputPath)
  );

  // Cleanup temp files
  const temps = [...clipPaths, voicePath, musicPath, concatListPath, concatenatedPath];
  for (const t of temps) {
    try { fs.unlinkSync(t); } catch { /* ignore */ }
  }

  console.log(`🎞️ [Editor] Final video: ${outputPath}`);
  return outputPath;
}
