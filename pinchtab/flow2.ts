#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Flow 2: operator-driven existing-portfolio session with recording. */
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
import { makeFileRW } from "./pola-io.ts";

export const makeInitialPrompt = () =>
  [
    "I have an existing YMax portfolio and I'd like this agent to help manage its allocations.",
    "Please help me add the agent to the portfolio.",
    "Don't change my portfolio allocations yet.",
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
  const uiUrl =
    env.YMAX_UI_URL || "https://staging-agentic-ui.ymax0-ui.pages.dev";

  log("Flow 2: checking the local PinchTab server...");
  await pinchtab.health();
  const profile = await pinchtab.provideProfile(config.profileName);
  log(`Flow 2: opening headed PinchTab profile ${config.profileName}...`);
  const instance = await profile.provideFreshInstance([
    new URL(uiUrl).hostname,
  ]);
  const recordings = profile.getRecordingsDir().readOnly();

  log("Flow 2: starting browser recording...");
  await instance.recorder.startGif();

  const prompt = makeInitialPrompt();
  log(`\nFlow 2 initial prompt:\n\n${prompt}\n`);
  log(
    "Claude is interactive. Use the headed browser for wallet actions. When you are done, type /exit in Claude to stop the recording.",
  );

  let claudeFailure: unknown;
  try {
    await launchInteractiveClaude(prompt, {
      cwd,
      env,
      name: "ymax-flow2",
      command: claudeCommand,
      spawn,
    });
  } catch (error) {
    claudeFailure = error;
  }

  log("Flow 2: stopping browser recording...");
  const recording = await finishRecording({
    recorder: instance.recorder,
    recordings,
    delay,
  });
  log(`Flow 2: browser recording saved at ${recording}.`);

  if (claudeFailure) throw claudeFailure;
  stdout.write(`${recording}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
