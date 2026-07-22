#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Flow 1: operator-driven YMax session with browser recording. */
/* global globalThis */
import { spawn as spawnChild } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  finishRecording,
  getPinchtabConfig,
  makePinchTabEndpoint,
} from "./pinchtab-api.ts";
import {
  launchInteractiveClaude,
} from "./local-agent.ts";
import { hasErrorCode, makeFileRW } from "./pola-io.ts";

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

export const main = async (
  env = process.env,
  {
    fetch = globalThis.fetch,
    fspP = import("node:fs/promises"),
    pathP = import("node:path"),
    cwd = process.cwd(),
    delay = (milliseconds: number) =>
      new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
    spawn = spawnChild,
    claudeCommand = env.YMAX_CLAUDE_BIN || "claude",
    log = console.error,
    stdout = process.stdout,
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

  log(`Flow 1: opening ${uiUrl} in the recording tab...`);
  const navigation = await instance.navigate(uiUrl);
  log("Flow 1: starting browser recording...");
  await instance.recorder.startGif(navigation.tabId);

  const prompt = makeInitialPrompt(amount, maxInstruments);
  log(`\nFlow 1 initial prompt:\n\n${prompt}\n`);
  log(
    "Claude is interactive. Use the headed browser for wallet actions. When you are done, type /exit in Claude to stop the recording.",
  );

  let claudeFailure: unknown;
  try {
    await launchInteractiveClaude(prompt, {
      cwd,
      env,
      name: "ymax-flow1",
      command: claudeCommand,
      spawn,
    });
  } catch (error) {
    claudeFailure = error;
  }

  log("Flow 1: stopping browser recording...");
  const recording = await finishRecording({
    recorder: instance.recorder,
    recordings,
    delay,
  });
  log(`Flow 1: browser recording saved at ${recording}.`);

  if (claudeFailure) throw claudeFailure;
  stdout.write(`${recording}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
