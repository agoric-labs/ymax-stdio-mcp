#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Flow 1: create, fund, and delegate a new portfolio with owner signing. */
/* global globalThis */
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { query as queryClaude } from "@anthropic-ai/claude-agent-sdk";
import {
  getPinchtabConfig,
  getSnapshotNodes,
  makePinchTabEndpoint,
  type JsonRecord,
} from "./pinchtab-api.ts";
import {
  checkSponsorFailure,
  runClaudeAgentTurn,
  type AgentQuery,
} from "./local-agent.ts";
import { makeFileRW } from "./pola-io.ts";

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

const makeInitialPrompt = (amount: number) =>
  [
    `I want to create a new YMax portfolio with ${amount} USDC.`,
    "I prefer a diversified, yield-seeking allocation, while avoiding needless concentration.",
    "Please choose a sensible initial allocation, prepare this agent to manage allocations, and give me one YMax link where I can review and approve the portfolio creation and delegation.",
    "Don't submit transactions or claim that I've approved anything; I'll review and sign in my wallet.",
  ].join(" ");

const REDEEM_PROMPT = [
  "I've approved the portfolio creation and delegation in YMax.",
  "Please finish setting up your access, then report the portfolio, agent, and permissions you received.",
  "Do not change the allocation or submit any other portfolio transaction.",
].join(" ");

export const findExpectedCreateUrl = (
  text: string,
  expectedUiUrl: string,
) => {
  const candidates = text.match(/https:\/\/[^\s<>"')]+/g) || [];
  const expectedOrigin = new URL(expectedUiUrl).origin;
  for (const candidate of candidates) {
    const url = new URL(candidate.replace(/[.,;]+$/, ""));
    const allocationValues = [...url.searchParams.entries()]
      .filter(([name]) => !["accountHolder", "permissions"].includes(name))
      .map(([, value]) => Number(value));
    const allocationTotal = allocationValues.reduce(
      (total, value) => total + value,
      0,
    );
    if (
      url.origin === expectedOrigin &&
      url.pathname === "/create-portfolio" &&
      url.searchParams.get("accountHolder")?.startsWith("agoric1") &&
      url.searchParams.get("permissions") === "change-allocations" &&
      allocationValues.length > 0 &&
      allocationValues.every((value) => Number.isFinite(value) && value >= 0) &&
      Math.abs(allocationTotal - 100) < 0.000_001
    ) {
      return url.toString();
    }
  }
  throw Error(
    `The local agent did not return a valid create-and-delegate proposal from ${expectedOrigin}.`,
  );
};

export const validateRedemption = (text: string) => {
  const checks = [
    /"status"\s*:\s*"redeemed"/,
    /"portfolioId"\s*:\s*\d+/,
    /"agentId"\s*:\s*"[^"]+"/,
    /"permissions"\s*:\s*\{[^{}]*"allocation"\s*:\s*true[^{}]*\}/,
  ];
  if (!checks.every((pattern) => pattern.test(text))) {
    throw Error(
      "The local agent did not report a valid redeemed delegation with portfolio, agent, and allocation authority.",
    );
  }
};

const hasNode = (snapshot: JsonRecord, role: string, name: RegExp) =>
  getSnapshotNodes(snapshot).some(
    (node: JsonRecord) => node.role === role && name.test(node.name || ""),
  );

const makeWaitForOwner = (
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
) => async (prompt: string) => {
  const terminal = createInterface({ input, output });
  try {
    const answer = await terminal.question(`${prompt}\nType COMPLETE to continue: `);
    if (answer.trim() !== "COMPLETE") {
      throw Error("Owner did not confirm completion; invitation was not redeemed.");
    }
  } finally {
    terminal.close();
  }
};

export const main = async (
  env = process.env,
  {
    fetch = globalThis.fetch,
    fspP = import("node:fs/promises"),
    pathP = import("node:path"),
    query = queryClaude,
    cwd = process.cwd(),
    waitForOwner = makeWaitForOwner(process.stdin, process.stdout),
  }: {
    fetch?: typeof globalThis.fetch;
    fspP?: Promise<typeof import("node:fs/promises")>;
    pathP?: Promise<typeof import("node:path")>;
    query?: AgentQuery;
    cwd?: string;
    waitForOwner?: (prompt: string) => Promise<void>;
  } = {},
) => {
  const amount = getDepositAmount(env);
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

  console.info(
    "Flow 1: asking the local Claude agent to prepare a new portfolio. This may take a few minutes...",
  );
  const prepared = await runClaudeAgentTurn(makeInitialPrompt(amount), {
    query,
    cwd,
    env,
    label: "Flow 1",
  });
  checkSponsorFailure(prepared.output);
  if (!prepared.sessionId) {
    throw Error("The local agent did not return a resumable session ID.");
  }

  const uiUrl =
    env.YMAX_UI_URL || "https://staging-agentic-ui.ymax0-ui.pages.dev";
  const createUrl = findExpectedCreateUrl(prepared.output, uiUrl);

  console.info("Flow 1: checking the local PinchTab server...");
  await pinchtab.health();
  console.info(`Flow 1: finding PinchTab profile ${config.profileName}...`);
  const profile = await pinchtab.provideProfile(config.profileName);
  console.info(
    `Flow 1: starting or reusing PinchTab profile ${config.profileName}...`,
  );
  const instance = await profile.provideInstance([new URL(uiUrl).hostname]);
  console.info("Flow 1: opening the combined portfolio proposal...");
  await instance.navigate(createUrl);
  const snapshot = await instance.snapshot();
  if (!hasNode(snapshot, "heading", /Create Your Portfolio/i)) {
    throw Error("Flow 1 did not reach the Create Your Portfolio page.");
  }
  if (
    !hasNode(snapshot, "heading", /Review Your Portfolio/i) ||
    !hasNode(snapshot, "heading", /Deposit USDC/i) ||
    !hasNode(snapshot, "spinbutton", /^0(?:\.0+)?$/)
  ) {
    throw Error("Flow 1 proposal did not reach the review and deposit steps.");
  }

  const walletState = hasNode(snapshot, "button", /Connect Wallet/i)
    ? "Connect the dedicated wallet first. "
    : "";
  await waitForOwner(
    `${walletState}Review the proposed allocation, enter ${amount} USDC, and complete the YMax create-and-delegate wallet flow. No wallet action is automated by this script.`,
  );

  console.info(
    "Flow 1: owner confirmed completion; asking the same local agent to redeem and verify its invitation...",
  );
  const redeemed = await runClaudeAgentTurn(REDEEM_PROMPT, {
    query,
    cwd,
    env,
    label: "Flow 1",
    resume: prepared.sessionId,
  });
  validateRedemption(redeemed.output);
  console.info("Flow 1: delegation redeemed and verified.");
  return { createUrl, sessionId: prepared.sessionId };
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
