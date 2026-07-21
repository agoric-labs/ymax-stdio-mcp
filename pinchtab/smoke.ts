#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Non-signing PinchTab smoke for the YMax recording profile. */
/* global globalThis */
import { execFile as execFileCb } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { makePinchTabEndpoint, type PinchTabInstance } from "./pinchtab-api.ts";
import {
  hasErrorCode,
  makeCommand,
  makeFileRW,
  type ReadableFile,
  type WritableFile,
} from "./pola-io.ts";

const execFile = promisify(execFileCb);

const getRecordingFormat = (format = "mp4") => {
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

export const getPinchtabConfig = async (
  env: NodeJS.ProcessEnv,
  files: ReadableFile,
) => {
  const { PINCHTAB_TOKEN, PINCHTAB_CONFIG, XDG_CONFIG_HOME, HOME } = env;
  let token = PINCHTAB_TOKEN;
  if (PINCHTAB_TOKEN) {
    token = PINCHTAB_TOKEN;
  } else {
    const candidates = [];
    if (PINCHTAB_CONFIG) {
      candidates.push(files.join(PINCHTAB_CONFIG));
    }
    const configBase = XDG_CONFIG_HOME || (HOME && `${HOME}/.config`);
    if (configBase) {
      candidates.push(files.join(configBase, "pinchtab", "config.json"));
    }
    if (HOME) {
      candidates.push(files.join(HOME, ".pinchtab", "config.json"));
    }

    for (const configFile of candidates) {
      try {
        const config = await configFile.readJSON();
        token = config?.server?.token;
        if (typeof token === "string" && token) {
          break;
        }
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
          throw error;
        }
      }
    }
  }

  if (typeof token !== "string" || !token) {
    throw Error(
      "Set PINCHTAB_TOKEN or configure server.token in the local PinchTab config.",
    );
  }

  return {
    token,
    serverUrl: env.PINCHTAB_SERVER_URL || "http://127.0.0.1:9867",
    profileName: env.PINCHTAB_YMAX_PROFILE || "ymax-flow1",
    artifactDir: env.PINCHTAB_ARTIFACT_DIR || "artifacts",
    recordingFormat: getRecordingFormat(env.PINCHTAB_RECORDING_FORMAT),
    ffmpeg: env.PINCHTAB_FFMPEG_BIN || "ffmpeg",
  };
};

const assertFileExists = async (file: ReadableFile) => {
  const stats = await file.stat();
  if (!stats.isFile() || Number(stats.size) <= 0) {
    throw Error(`PinchTab did not write a non-empty recording: ${file}`);
  }
};

const joinTailUnder = (
  file: { toString(): string },
  directory: ReadableFile,
) => {
  const directoryPath = directory.toString().replace(/\/+$/, "");
  const filePath = file.toString();
  const prefix = `${directoryPath}/`;
  if (filePath !== directoryPath && !filePath.startsWith(prefix)) {
    throw Error(
      `PinchTab returned a recording outside the expected directory: ${filePath}`,
    );
  }
  const tail = filePath.slice(prefix.length);
  if (tail.split("/").includes("..")) {
    throw Error(`PinchTab returned an unsafe recording path: ${filePath}`);
  }
  return tail ? directory.join(tail) : directory;
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
      : [
          "-c:v",
          "libvpx-vp9",
          "-pix_fmt",
          "yuva420p",
        ];

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
    execFile: execFilePower = execFile,
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
  const ffmpeg = makeCommand(execFilePower, config.ffmpeg);
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
