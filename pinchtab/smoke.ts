#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Non-signing PinchTab smoke for the YMax recording profile. */
/* global globalThis */
import { execFile as execFileCb } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  getPinchtabConfig,
  makePinchTabEndpoint,
  type PinchTabInstance,
} from "./pinchtab-api.ts";
import {
  hasErrorCode,
  joinTailUnder,
  makeCommand,
  makeFileRW,
  type ReadableFile,
  type WritableFile,
} from "./pola-io.ts";

export const getRecordingFormat = (format = "mp4") => {
  switch (format) {
    case "gif":
    case "mp4":
    case "webm":
      return format;
    default:
      throw Error(
        `Unsupported PINCHTAB_RECORDING_FORMAT=${format}. Use gif, mp4, or webm.`,
      );
  }
};

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

const waitForFinishedRecording = async ({
  recorder,
  recordings,
  delay,
}: {
  recorder: PinchTabInstance["recorder"];
  recordings: ReadableFile;
  delay(ms: number): Promise<unknown>;
}) => {
  let lastStatus;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    lastStatus = await recorder.status();
    if (lastStatus.error) {
      throw Error(`PinchTab recording failed:\n${lastStatus.error}`);
    }
    const recordingPath = lastStatus.outputPath || lastStatus.path;
    if (lastStatus.state === "finished" && typeof recordingPath === "string") {
      const recordingFile = joinTailUnder(
        { toString: () => recordingPath },
        recordings,
      );
      await assertFileExists(recordingFile);
      return recordingFile;
    }
    await delay(1000);
  }
  throw Error(
    `PinchTab did not finish writing the smoke recording within 30 seconds. Last status:\n${JSON.stringify(
      lastStatus,
      null,
      2,
    )}`,
  );
};

export const main = async (
  env = process.env,
  {
    fetch = globalThis.fetch,
    fspP = import("node:fs/promises"),
    pathP = import("node:path"),
    delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    execFile = promisify(execFileCb),
    log = console.log,
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
  );
  const ffmpeg = makeCommand(execFile, config.ffmpeg);
  const artifacts = files.join(config.artifactDir);

  await artifacts.mkdir();
  await pinchtab.health();

  const profile = await pinchtab.provideProfile(config.profileName);
  const recordings = profile.getRecordingsDir();
  const instance = await profile.provideInstance();

  const navigation = await instance.navigate("https://main0.ymax.app");
  await artifacts
    .join("pinchtab-smoke-navigation.json")
    .writeText(`${JSON.stringify(navigation, null, 2)}\n`);

  await instance.recorder.startGif();
  await delay(3000);

  const snapshot = await instance.snapshot();
  await artifacts
    .join("pinchtab-smoke-snapshot.json")
    .writeText(`${JSON.stringify(snapshot, null, 2)}\n`);

  await instance.recorder.stop();

  const gifFile = await waitForFinishedRecording({
    recorder: instance.recorder,
    recordings: recordings.readOnly(),
    delay,
  });
  if (config.recordingFormat === "gif") {
    log(
      `PinchTab saved the smoke recording at ${gifFile}. No wallet action was attempted.`,
    );
    return {
      recordingPath: gifFile.toString(),
      intermediateGifPath: undefined,
    };
  }

  const recordingFile = recordings
    .join(gifFile.basename())
    .withExtension(config.recordingFormat);
  await convertGif(ffmpeg, gifFile, recordingFile, config.recordingFormat);
  log(
    `PinchTab saved the smoke recording at ${recordingFile}. No wallet action was attempted.`,
  );
  log(`Intermediate GIF retained at ${gifFile}.`);
  return {
    recordingPath: recordingFile.toString(),
    intermediateGifPath: gifFile.toString(),
  };
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
