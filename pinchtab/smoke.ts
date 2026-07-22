#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Non-signing PinchTab smoke for the YMax recording profile. */
/* global globalThis */
import { execFile as execFileCb } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  finishRecording,
  getPinchtabConfig,
  makePinchTabEndpoint,
} from "./pinchtab-api.ts";
import {
  hasErrorCode,
  makeCommand,
  makeFileRW,
  type ReadableFile,
  type WritableFile,
} from "./pola-io.ts";

const assertFileExists = async (file: ReadableFile) => {
  const stats = await file.stat();
  if (!stats.isFile() || Number(stats.size) <= 0) {
    throw Error(`PinchTab did not write a non-empty recording: ${file}`);
  }
};

const convertGif = async (
  ffmpeg: ReturnType<typeof makeCommand>,
  gifFile: ReadableFile,
  convertedFile: WritableFile,
  format: string,
) => {
  const formatArgs =
    format === "mp4"
      ? [
          "-movflags",
          "+faststart",
          "-pix_fmt",
          "yuv420p",
          "-vf",
          "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        ]
      : ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p"];

  try {
    await ffmpeg([
      "-y",
      "-v",
      "error",
      "-i",
      gifFile.toString(),
      ...formatArgs,
      convertedFile.toString(),
    ]);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw Error(
        `ffmpeg is required to convert the PinchTab GIF recording to ${format}.`,
      );
    }
    throw error;
  }
  await assertFileExists(convertedFile);
  return convertedFile;
};

export const main = async (
  env = process.env,
  {
    fetch = globalThis.fetch,
    fspP = import("node:fs/promises"),
    pathP = import("node:path"),
    delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    execFile = promisify(execFileCb),
    log = console.error,
    stdout = process.stdout,
    cwd = process.cwd(),
  } = {},
) => {
  const fsp = await fspP;
  const path = await pathP;
  const files = makeFileRW("/", { fsp, path });
  const config = await getPinchtabConfig(env, files.readOnly());
  const pinchtab = makePinchTabEndpoint(
    fetch,
    config.serverUrl,
    config.token,
    files,
    { delay },
  );
  const ffmpeg = makeCommand(execFile, config.ffmpeg);
  const artifactDir = path.isAbsolute(config.artifactDir)
    ? config.artifactDir
    : path.join(cwd, config.artifactDir);
  const artifacts = files.join(artifactDir);

  await artifacts.mkdir();
  await pinchtab.health();

  const profile = await pinchtab.provideProfile(config.profileName);
  const recordings = profile.getRecordingsDir();
  const instance = await profile.provideInstance();

  const navigation = await instance.navigate("https://main0.ymax.app");
  await artifacts
    .join("pinchtab-smoke-navigation.json")
    .writeText(`${JSON.stringify(navigation, null, 2)}\n`);

  await instance.recorder.startGif(navigation.tabId);
  await delay(3000);

  const snapshot = await instance.snapshot();
  await artifacts
    .join("pinchtab-smoke-snapshot.json")
    .writeText(`${JSON.stringify(snapshot, null, 2)}\n`);

  const gifFile = await finishRecording({
    recorder: instance.recorder,
    recordings: recordings.readOnly(),
    delay,
  });
  if (config.recordingFormat === "gif") {
    log(
      `PinchTab saved the smoke recording at ${gifFile}. No wallet action was attempted.`,
    );
    stdout.write(`${gifFile}\n`);
    return;
  }

  const recordingFile = recordings
    .join(gifFile.basename())
    .withExtension(config.recordingFormat);
  await convertGif(ffmpeg, gifFile, recordingFile, config.recordingFormat);
  log(
    `PinchTab saved the smoke recording at ${recordingFile}. No wallet action was attempted.`,
  );
  log(`Intermediate GIF retained at ${gifFile}.`);
  stdout.write(`${recordingFile}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
