import * as fs from "fs";
import * as https from "https";
import * as http from "http";
import { spawn } from "child_process";
import { VisualImage } from "./agents/visual";
import { VoiceResult } from "./agents/voice";
import { MusicResult } from "./agents/music";

// ============================================================
// Editor — assembles final video using FFmpeg Ken Burns effect
// Uses async spawn (not execSync) to avoid blocking health checks
// Scale+crop Ken Burns: scale image to 110%, animated crop pan
// ============================================================

const DEMO_MODE = process.env.DEMO_MODE === "true";

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith("https") ? https : http;
    protocol
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(destPath, () => {});
          return downloadFile(res.headers.location!, destPath).then(resolve).catch(reject);
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      })
      .on("error", (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// Non-blocking ffmpeg wrapper — spawns as child process, Node stays responsive
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\nArgs: ${args.join(" ")}`));
    });
    proc.on("error", reject);
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
    console.log("🎞️ [Editor] DEMO MODE — placeholder");
    fs.writeFileSync(outputPath, "DEMO_VIDEO_PLACEHOLDER");
    return outputPath;
  }

  // Clip duration driven by voice narration length
  const clipFrames = Math.round((voice.durationSeconds / images.length) * 25);
  const clipDurSecs = voice.durationSeconds / images.length;
  console.log(`🎞️ [Editor] Voice duration: ${voice.durationSeconds.toFixed(2)}s → ${clipFrames} frames/clip (${images.length} clips)`);

  // 1. Build Ken Burns clips (scale to 110% + animated crop — no zoompan, no frame buffering)
  const clipPaths: string[] = [];
  const ex = 192; // 2112 - 1920
  const ey = 108; // 1188 - 1080
  const totalFrameIndex = clipFrames - 1;
  const panDirections = [
    `x='${ex}*n/${totalFrameIndex}':y='${ey}*n/${totalFrameIndex}'`,
    `x='${ex}*(1-n/${totalFrameIndex})':y='${ey}*(1-n/${totalFrameIndex})'`,
    `x='${ex}*n/${totalFrameIndex}':y='${ey}*(1-n/${totalFrameIndex})'`,
    `x='${ex}*(1-n/${totalFrameIndex})':y='${ey}*n/${totalFrameIndex}'`,
  ];

  for (let i = 0; i < images.length; i++) {
    const imgPath = `/tmp/dispatch-img-${timestamp}-${i}.jpg`;
    const clipPath = `/tmp/dispatch-clip-${timestamp}-${i}.mp4`;
    console.log(`🎞️ [Editor] Downloading image ${i}...`);
    await downloadFile(images[i].url, imgPath);

    console.log(`🎞️ [Editor] Encoding clip ${i} (${clipDurSecs.toFixed(1)}s, ${clipFrames} frames)...`);
    const pan = panDirections[i % 4];
    const vf = `scale=2112:1188:force_original_aspect_ratio=increase,crop=2112:1188,crop=1920:1080:${pan},format=yuv420p`;
    await runFfmpeg([
      "-y", "-loop", "1", "-i", imgPath,
      "-vf", vf,
      "-frames:v", String(clipFrames),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-colorspace", "1", "-color_primaries", "1", "-color_trc", "1",
      "-pix_fmt", "yuv420p",
      clipPath,
    ]);
    clipPaths.push(clipPath);
    try { fs.unlinkSync(imgPath); } catch { /* ignore */ }
    console.log(`🎞️ [Editor] Clip ${i} done ✅`);
  }

  // 2. Write voice audio
  const voicePath = `/tmp/dispatch-voice-${timestamp}.mp3`;
  fs.writeFileSync(voicePath, voice.audioBuffer);

  // 3. Download music
  const musicPath = `/tmp/dispatch-music-${timestamp}.mp3`;
  console.log("🎞️ [Editor] Downloading music...");
  await downloadFile(music.audioUrl, musicPath);

  // 4. Concatenate clips
  const concatListPath = `/tmp/dispatch-list-${timestamp}.txt`;
  fs.writeFileSync(concatListPath, clipPaths.map((p) => `file '${p}'`).join("\n"));
  const concatenatedPath = `/tmp/dispatch-concat-${timestamp}.mp4`;
  console.log("🎞️ [Editor] Concatenating clips...");
  await runFfmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", concatListPath,
    "-c", "copy", concatenatedPath,
  ]);

  // 5. Mix voice + music → final video
  console.log("🎞️ [Editor] Mixing audio and muxing final video...");
  await runFfmpeg([
    "-y",
    "-i", concatenatedPath,
    "-i", voicePath,
    "-i", musicPath,
    "-filter_complex", "[2:a]volume=0.3[music];[1:a][music]amix=inputs=2:duration=first[audio]",
    "-map", "0:v",
    "-map", "[audio]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-shortest",
    outputPath,
  ]);

  // Cleanup
  for (const t of [...clipPaths, voicePath, musicPath, concatListPath, concatenatedPath]) {
    try { fs.unlinkSync(t); } catch { /* ignore */ }
  }

  console.log(`🎞️ [Editor] Final video: ${outputPath}`);
  return outputPath;
}
