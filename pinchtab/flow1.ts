#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Flow 1: operator-driven YMax session with browser recording. */
/* global globalThis */
import { spawn as spawnChild } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  getPinchtabConfig,
  makePinchTabEndpoint,
  type PinchTabInstance,
} from "./pinchtab-api.ts";
import {
  hasErrorCode,
  joinTailUnder,
  makeFileRW,
  type ReadableFile,
} from "./pola-io.ts";

const MCP_CONFIG = {
  mcpServers: {
    "ymax-yield-agent": {
      type: "stdio",
      command: "./mcp-server/node_modules/.bin/tsx",
      args: ["mcp-server/src/server.ts"],
    },
  },
};

type InteractiveClaude = (
  prompt: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<void>;

const getDepositAmount = (env: NodeJS.ProcessEnv) => {
  const text = env.YMAX_FLOW1_DEPOSIT_USDC;
  const amount = Number(text);
  if (!text || !Number.isFinite(amount) || amount <= 0 || amount > 30) {
    throw Error(
      "Set YMAX_FLOW1_DEPOSIT_USDC to the intended amount, greater than 0 and no more than 30.",
    );
  }
  return amount;
};

const getMaxInstruments = (env: NodeJS.ProcessEnv) => {
  const text = env.YMAX_FLOW1_MAX_INSTRUMENTS || "3";
  const count = Number(text);
  if (!Number.isSafeInteger(count) || count <= 0 || count > 12) {
    throw Error(
      "Set YMAX_FLOW1_MAX_INSTRUMENTS to an integer from 1 through 12.",
    );
  }
  return count;
};

export const makeInitialPrompt = (amount: number, maxInstruments: number) =>
  [
    `I want to create a new YMax portfolio with ${amount} USDC.`,
    "I prefer a diversified, yield-seeking allocation, while avoiding needless concentration.",
    "For now, only use yield opportunities on the Base chain so withdrawals are quick during testing.",
    `Keep it simple: use no more than ${maxInstruments} yield opportunities.`,
    "Please choose a sensible initial allocation and help me create the portfolio so you can manage its allocations.",
    "I'll handle any wallet approvals.",
  ].join(" ");

export const makeInteractiveClaudeArgs = (prompt: string) => [
  "--mcp-config",
  JSON.stringify(MCP_CONFIG),
  "--strict-mcp-config",
  "--dangerously-skip-permissions",
  "--name",
  "ymax-flow1",
  prompt,
];

const launchInteractiveClaude = (
  prompt: string,
  {
    cwd,
    env,
    command = "claude",
    spawn = spawnChild,
  }: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    command?: string;
    spawn?: typeof spawnChild;
  },
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, makeInteractiveClaudeArgs(prompt), {
      cwd,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          Error(
            `Interactive Claude exited ${signal ? `on ${signal}` : `with status ${code}`}.`,
          ),
        );
      }
    });
  });

const assertRecording = async (file: ReadableFile) => {
  const stats = await file.stat();
  if (!stats.isFile() || Number(stats.size) <= 0) {
    throw Error(`PinchTab did not write a non-empty recording: ${file}`);
  }
};

const stopAndFindRecording = async (
  recorder: PinchTabInstance["recorder"],
  recordings: ReadableFile,
  delay: (milliseconds: number) => Promise<unknown>,
) => {
  await recorder.stop();
  let lastStatus;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    lastStatus = await recorder.status();
    if (lastStatus.error) {
      throw Error(`PinchTab recording failed:\n${lastStatus.error}`);
    }
    const path = lastStatus.outputPath || lastStatus.path;
    if (lastStatus.state === "finished" && typeof path === "string") {
      const file = joinTailUnder({ toString: () => path }, recordings);
      await assertRecording(file);
      return file;
    }
    await delay(1000);
  }
  throw Error(
    `PinchTab did not finish writing the Flow 1 recording within 30 seconds. Last status:\n${JSON.stringify(lastStatus, null, 2)}`,
  );
};

export const main = async (
  env = process.env,
  {
    fetch = globalThis.fetch,
    fspP = import("node:fs/promises"),
    pathP = import("node:path"),
    cwd = process.cwd(),
    delay = (milliseconds: number) =>
      new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
    interactiveClaude,
    log = console.log,
  }: {
    fetch?: typeof globalThis.fetch;
    fspP?: Promise<typeof import("node:fs/promises")>;
    pathP?: Promise<typeof import("node:path")>;
    cwd?: string;
    delay?: (milliseconds: number) => Promise<unknown>;
    interactiveClaude?: InteractiveClaude;
    log?: (message: string) => void;
  } = {},
) => {
  const amount = getDepositAmount(env);
  const maxInstruments = getMaxInstruments(env);
  const fsp = await fspP;
  const path = await pathP;
  const files = makeFileRW("/", { fsp, path });
  const statePath = path.resolve(
    cwd,
    env.YMAX_STATE_FILE || "mcp-server/state.json",
  );
  const stateExists = await files
    .join(statePath)
    .stat()
    .then(
      () => true,
      error => {
        if (hasErrorCode(error, "ENOENT")) return false;
        throw error;
      },
    );
  if (stateExists) {
    throw Error(
      `Flow 1 requires a blank MCP state. Remove ${statePath} before rerunning Flow 1.`,
    );
  }

  const config = await getPinchtabConfig(env, files.readOnly());
  const pinchtab = makePinchTabEndpoint(
    fetch,
    config.serverUrl,
    config.token,
    files,
    { delay },
  );
  const uiUrl =
    env.YMAX_UI_URL || "https://staging-agentic-ui.ymax0-ui.pages.dev";

  log("Flow 1: checking the local PinchTab server...");
  await pinchtab.health();
  const profile = await pinchtab.provideProfile(config.profileName);
  log(`Flow 1: opening headed PinchTab profile ${config.profileName}...`);
  const instance = await profile.provideFreshInstance([
    new URL(uiUrl).hostname,
  ]);
  const recordings = profile.getRecordingsDir().readOnly();

  log("Flow 1: starting browser recording...");
  await instance.recorder.startGif();

  const prompt = makeInitialPrompt(amount, maxInstruments);
  log(`\nFlow 1 initial prompt:\n\n${prompt}\n`);
  log(
    "Claude is interactive. Use the headed browser for wallet actions. When you are done, type /exit in Claude to stop the recording.",
  );

  const runClaude =
    interactiveClaude ||
    ((initialPrompt, options) =>
      launchInteractiveClaude(initialPrompt, {
        ...options,
        command: env.YMAX_CLAUDE_BIN || "claude",
      }));

  let claudeFailure: unknown;
  try {
    await runClaude(prompt, { cwd, env });
  } catch (error) {
    claudeFailure = error;
  }

  log("Flow 1: stopping browser recording...");
  const recording = await stopAndFindRecording(
    instance.recorder,
    recordings,
    delay,
  );
  log(`Flow 1: browser recording saved at ${recording}.`);

  if (claudeFailure) throw claudeFailure;
  return { recordingPath: recording.toString() };
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
