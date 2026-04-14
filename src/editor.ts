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
// Assembles final video using FFmpeg Ken Burns zoom effect
// Steps:
//   1. Download each image to /tmp
//   2. For each image, run FFmpeg Ken Burns zoompan to create 5-second clip
//   3. Write narration audio to /tmp
//   4. Download music track to /tmp
//   5. Concatenate video clips
//   6. Mix narration + music (music at 0.3 volume)
//   7. Return output path
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
  const clipPaths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const imgPath = `/tmp/dispatch-img-${timestamp}-${i}.jpg`;
    const clipPath = `/tmp/dispatch-clip-${timestamp}-${i}.mp4`;
    console.log(`🎞️ [Editor] Downloading image ${i}...`);
    await downloadFile(images[i].url, imgPath);

    console.log(`🎞️ [Editor] Creating Ken Burns clip ${i}...`);
    // Ken Burns zoompan: slowly zoom in from 1.0 to 1.5 over 125 frames (5s @ 25fps)
    const ffmpegCmd = [
      "ffmpeg", "-y",
      "-loop", "1",
      "-i", `"${imgPath}"`,
      "-vf", '"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z=\'min(zoom+0.0015,1.5)\':d=125:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=hd1080"',
      "-t", "5",
      "-r", "25",
      "-c:v", "libx264",
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
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatenatedPath}"`,
    { stdio: "inherit" }
  );

  // 5. Mix narration + music, mux with video
  console.log("🎞️ [Editor] Mixing audio and muxing final video...");
  execSync(
    `ffmpeg -y -i "${concatenatedPath}" -i "${voicePath}" -i "${musicPath}" ` +
    `-filter_complex "[2:a]volume=0.3[music];[1:a][music]amix=inputs=2:duration=first[audio]" ` +
    `-map 0:v -map "[audio]" -c:v copy -c:a aac -shortest "${outputPath}"`,
    { stdio: "inherit" }
  );

  // Cleanup temp files
  const temps = [...clipPaths, voicePath, musicPath, concatListPath, concatenatedPath];
  for (const t of temps) {
    try { fs.unlinkSync(t); } catch { /* ignore */ }
  }

  console.log(`🎞️ [Editor] Final video: ${outputPath}`);
  return outputPath;
}
