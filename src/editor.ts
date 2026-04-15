import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { execSync } from "child_process";
import { VisualImage } from "./agents/visual";
import { VoiceResult } from "./agents/voice";
import { MusicResult } from "./agents/music";

// ============================================================
// Editor
// Assembles final video using FFmpeg Ken Burns effect
// Steps:
//   1. Download each image to /tmp
//   2. For each image, scale to 110% and animated-crop (Ken Burns pan) → 5s clip
//   3. Write narration audio to /tmp
//   4. Download music track to /tmp
//   5. Concatenate video clips
//   6. Mix narration + music (music at 0.3 volume)
//   7. Return output path
// NOTE: scale+crop approach instead of zoompan — avoids d-frame buffer OOM at 512MB RAM
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

export async function runEditor(
  images: VisualImage[],
  voice: VoiceResult,
  music: MusicResult
): Promise<string> {
  const timestamp = Date.now();
  const outputPath = `/tmp/dispatch-${timestamp}.mp4`;

  console.log("🎞️ [Editor] Starting video assembly with Ken Burns effect...");

  if (DEMO_MODE) {
    console.log("🎞️ [Editor] DEMO MODE — creating placeholder output path");
    // Write a minimal marker file so the server can return something
    fs.writeFileSync(outputPath, "DEMO_VIDEO_PLACEHOLDER");
    return outputPath;
  }

  // 1. Download images and create Ken Burns clips
  // Clip length is driven by voice duration so the video matches the narration exactly.
  const clipFrames = Math.max(25, Math.round((voice.durationSeconds / images.length) * 25));
  const lastFrame = clipFrames - 1;
  console.log(`🎞️ [Editor] Voice: ${voice.durationSeconds}s / ${images.length} images → ${clipFrames} frames per clip (${(clipFrames/25).toFixed(1)}s)`);

  const clipPaths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const imgPath = `/tmp/dispatch-img-${timestamp}-${i}.jpg`;
    const clipPath = `/tmp/dispatch-clip-${timestamp}-${i}.mp4`;
    console.log(`🎞️ [Editor] Downloading image ${i}...`);
    await downloadFile(images[i].url, imgPath);

    console.log(`🎞️ [Editor] Creating Ken Burns clip ${i} (${clipFrames} frames)...`);
    // Ken Burns effect via scale-up + animated crop (no zoompan — avoids d-frame buffer OOM).
    // Scale image to 110% (2112x1188), then crop 1920x1080 window that slowly pans across.
    // Alternating pan directions give visual variety across clips.
    const ex = 192; // 2112 - 1920
    const ey = 108; // 1188 - 1080
    const panDirections = [
      `x='${ex}*n/${lastFrame}':y='${ey}*n/${lastFrame}'`,              // TL → BR
      `x='${ex}*(1-n/${lastFrame})':y='${ey}*(1-n/${lastFrame})'`,      // BR → TL
      `x='${ex}*n/${lastFrame}':y='${ey}*(1-n/${lastFrame})'`,           // BL → TR
      `x='${ex}*(1-n/${lastFrame})':y='${ey}*n/${lastFrame}'`,           // TR → BL
    ];
    const pan = panDirections[i % 4];
    const vf = `scale=2112:1188:force_original_aspect_ratio=increase,crop=2112:1188,crop=1920:1080:${pan}`;
    const ffmpegCmd = [
      "ffmpeg", "-y",
      "-loop", "1",
      "-i", `"${imgPath}"`,
      "-vf", `"${vf}"`,
      "-frames:v", String(clipFrames),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      `"${clipPath}"`
    ].join(" ");
    execSync(ffmpegCmd, { stdio: "inherit" });
    clipPaths.push(clipPath);

    // Cleanup image
    try { fs.unlinkSync(imgPath); } catch { /* ignore */ }
  }

  // 2. Write narration audio
  const voicePath = `/tmp/dispatch-voice-${timestamp}.mp3`;
  fs.writeFileSync(voicePath, voice.audioBuffer);

  // 3. Download music (optional — may be empty if Suno was skipped)
  let musicPath: string | null = null;
  if (music.audioUrl) {
    musicPath = `/tmp/dispatch-music-${timestamp}.mp3`;
    console.log("🎞️ [Editor] Downloading music track...");
    try {
      await downloadFile(music.audioUrl, musicPath);
    } catch (err) {
      console.warn(`🎞️ [Editor] Music download failed — continuing without music: ${(err as Error).message}`);
      musicPath = null;
    }
  } else {
    console.log("🎞️ [Editor] No music track (skipped) — voice-only output");
  }

  // 4. Create concat file for ffmpeg
  const concatListPath = `/tmp/dispatch-list-${timestamp}.txt`;
  const concatContent = clipPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(concatListPath, concatContent);

  const concatenatedPath = `/tmp/dispatch-concat-${timestamp}.mp4`;

  // Concatenate clips
  console.log("🎞️ [Editor] Concatenating video clips...");
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatenatedPath}"`,
    { stdio: "inherit" }
  );

  // 5. Mix audio and mux with video
  if (musicPath) {
    // Voice + music mix
    console.log("🎞️ [Editor] Mixing narration + music, muxing final video...");
    execSync(
      `ffmpeg -y -i "${concatenatedPath}" -i "${voicePath}" -i "${musicPath}" ` +
      `-filter_complex "[2:a]volume=0.3[music];[1:a][music]amix=inputs=2:duration=first[audio]" ` +
      `-map 0:v -map "[audio]" -c:v copy -c:a aac -shortest "${outputPath}"`,
      { stdio: "inherit" }
    );
  } else {
    // Voice only
    console.log("🎞️ [Editor] Muxing video with narration only (no music)...");
    execSync(
      `ffmpeg -y -i "${concatenatedPath}" -i "${voicePath}" ` +
      `-map 0:v -map 1:a -c:v copy -c:a aac -shortest "${outputPath}"`,
      { stdio: "inherit" }
    );
  }

  // Cleanup temp files
  const temps = [...clipPaths, voicePath, ...(musicPath ? [musicPath] : []), concatListPath, concatenatedPath];
  for (const t of temps) {
    try { fs.unlinkSync(t); } catch { /* ignore */ }
  }

  console.log(`🎞️ [Editor] Final video: ${outputPath}`);
  return outputPath;
}

