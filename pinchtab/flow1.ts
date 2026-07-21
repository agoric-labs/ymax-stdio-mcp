#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Flow 1: create, fund, and delegate a new portfolio. */
/* global globalThis */
import { pathToFileURL } from "node:url";
import { query as queryClaude } from "@anthropic-ai/claude-agent-sdk";
import {
  getPinchtabConfig,
  makePinchTabEndpoint,
  type PinchTabInstance,
} from "./pinchtab-api.ts";
import { driveOwnerFlow } from "./flow1-browser.ts";
import {
  checkSponsorFailure,
  runClaudeAgentTurn,
  type AgentQuery,
} from "./local-agent.ts";
import { makeFileRW } from "./pola-io.ts";

// Pattern: Explicit Real-Funds Knob. A run cannot spend an implicit/default
// amount.
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

const makeInitialPrompt = (amount: number, maxInstruments: number) =>
  [
    `I want to create a new YMax portfolio with ${amount} USDC.`,
    "I prefer a diversified, yield-seeking allocation, while avoiding needless concentration.",
    `Keep it simple: use no more than ${maxInstruments} yield opportunities.`,
    "Please choose a sensible initial allocation, prepare this agent to manage allocations, and give me one YMax link where I can review and approve the portfolio creation and delegation.",
    "Agent-side transactions needed to prepare your access are in scope. Don't create the portfolio, submit owner-wallet transactions, or claim that I've approved anything; the portfolio driver will handle my dedicated wallet.",
  ].join(" ");

const REDEEM_PROMPT = [
  "I've approved the portfolio creation and delegation in YMax.",
  "Please redeem the invitation to finish setting up your access, then report the portfolio, agent, and permissions you received.",
  "Do not change the allocation or submit any transaction beyond the invitation redemption.",
].join(" ");

// Pattern: Expected-Artifact Validation. The MCP computes the URL; the driver
// only finds it and verifies the expected origin, shape, and bounded proposal.
export const findExpectedCreateUrl = (
  text: string,
  expectedUiUrl: string,
  maxInstruments = Number.POSITIVE_INFINITY,
) => {
  const candidates = text.match(/https:\/\/[^\s<>"')\]*`]+/g) || [];
  const expectedOrigin = new URL(expectedUiUrl).origin;
  for (const candidate of candidates) {
    const url = new URL(candidate.replace(/[.,;]+$/, ""));
    const allocationEntries = [...url.searchParams.entries()].filter(
      ([name]) => !["accountHolder", "permissions"].includes(name),
    );
    const allocationValues = allocationEntries.map(([, value]) =>
      Number(value),
    );
    const allocationTotal = allocationValues.reduce(
      (total, value) => total + value,
      0,
    );
    if (
      url.origin === expectedOrigin &&
      url.pathname === "/create-portfolio" &&
      url.searchParams.get("accountHolder")?.startsWith("agoric1") &&
      url.searchParams.get("permissions") === "change-allocations" &&
      url.searchParams.getAll("accountHolder").length === 1 &&
      url.searchParams.getAll("permissions").length === 1 &&
      allocationValues.length > 0 &&
      allocationValues.length <= maxInstruments &&
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

// Pattern: Composition-Root Defaults. Only main connects ambient powers;
// helpers receive explicit capabilities and remain cheap to test.
export const main = async (
  env = process.env,
  {
    fetch = globalThis.fetch,
    fspP = import("node:fs/promises"),
    pathP = import("node:path"),
    query = queryClaude,
    cwd = process.cwd(),
    ownerFlow = driveOwnerFlow,
    delay = (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  }: {
    fetch?: typeof globalThis.fetch;
    fspP?: Promise<typeof import("node:fs/promises")>;
    pathP?: Promise<typeof import("node:path")>;
    query?: AgentQuery;
    cwd?: string;
    ownerFlow?: (
      instance: PinchTabInstance,
      options: {
        amount: number;
        uiUrl: string;
        delay: (milliseconds: number) => Promise<void>;
      },
    ) => Promise<unknown>;
    delay?: (milliseconds: number) => Promise<void>;
  } = {},
) => {
  const amount = getDepositAmount(env);
  const maxInstruments = getMaxInstruments(env);
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
  const prepared = await runClaudeAgentTurn(
    makeInitialPrompt(amount, maxInstruments),
    {
      query,
      cwd,
      env,
      label: "Flow 1",
    },
  );
  checkSponsorFailure(prepared.output);
  if (!prepared.sessionId) {
    throw Error("The local agent did not return a resumable session ID.");
  }

  const uiUrl =
    env.YMAX_UI_URL || "https://staging-agentic-ui.ymax0-ui.pages.dev";
  const createUrl = findExpectedCreateUrl(
    prepared.output,
    uiUrl,
    maxInstruments,
  );

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
  console.info(
    `Flow 1: creating the portfolio with ${amount} USDC using at most ${maxInstruments} instruments...`,
  );
  await ownerFlow(instance, { amount, uiUrl, delay });

  console.info(
    "Flow 1: wallet flow completed; asking the same local agent to redeem and verify its invitation...",
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
