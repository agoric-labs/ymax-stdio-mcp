#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Flow 2: prepare an existing-portfolio agent grant, without signing. */
/* global globalThis */
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

export const runClaudeAgent = async (
  prompt: string,
  {
    query,
    cwd,
    env,
  }: {
    query: AgentQuery;
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) => {
  const { output } = await runClaudeAgentTurn(prompt, {
    query,
    cwd,
    env,
    label: "Flow 2",
  });
  return output;
};

const PROMPT = [
  "I have an existing YMax portfolio and I'd like this agent to help manage its allocations.",
  "Please get the agent ready and give me the YMax link where I can review and approve the delegation.",
  "Don't change my portfolio or submit any transactions; I'll review and approve everything in my wallet.",
].join(" ");

export const findExpectedGrantUrl = (text: string, expectedUiUrl: string) => {
  const candidates = text.match(/https:\/\/[^\s<>"')\]*`]+/g) || [];
  const expectedOrigin = new URL(expectedUiUrl).origin;
  for (const candidate of candidates) {
    const url = new URL(candidate.replace(/[.,;]+$/, ""));
    if (
      url.origin === expectedOrigin &&
      url.pathname === "/grant" &&
      url.searchParams.get("accountHolder")?.startsWith("agoric1")
    ) {
      return url.toString();
    }
  }
  throw Error(
    `The local agent did not return a valid ${expectedOrigin}/grant URL.`,
  );
};

const hasNode = (snapshot: JsonRecord, role: string, name: string) =>
  getSnapshotNodes(snapshot).some(
    (node: JsonRecord) => node.role === role && node.name === name,
  );

export const main = async (
  env = process.env,
  {
    fetch = globalThis.fetch,
    fspP = import("node:fs/promises"),
    pathP = import("node:path"),
    query = queryClaude,
    cwd = process.cwd(),
    delay = (milliseconds: number) =>
      new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
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

  console.info(
    "Flow 2: starting a persisted local Claude session. This may take a few minutes...",
  );
  const agentOutput = await runClaudeAgent(PROMPT, {
    query,
    cwd,
    env,
  });
  console.info("Flow 2: local agent finished; validating its grant proposal...");
  checkSponsorFailure(agentOutput);
  const uiUrl =
    env.YMAX_UI_URL || "https://staging-agentic-ui.ymax0-ui.pages.dev";
  const grantUrl = findExpectedGrantUrl(agentOutput, uiUrl);

  console.info("Flow 2: checking the local PinchTab server...");
  await pinchtab.health();
  console.info(`Flow 2: finding PinchTab profile ${config.profileName}...`);
  const profile = await pinchtab.provideProfile(config.profileName);
  console.info(
    `Flow 2: starting or reusing PinchTab profile ${config.profileName}...`,
  );
  const instance = await profile.provideInstance([new URL(uiUrl).hostname]);
  console.info("Flow 2: opening the delegation proposal in the browser...");
  await instance.navigate(grantUrl);
  console.info(
    "Flow 2: checking that the browser reached the signature boundary...",
  );
  const snapshot = await instance.snapshot();

  if (hasNode(snapshot, "button", "Connect Wallet")) {
    throw Error(
      "Flow 2 requires a dedicated profile whose existing-portfolio wallet is already connected.",
    );
  }
  if (!hasNode(snapshot, "heading", "New agent")) {
    throw Error("Flow 2 did not reach the New agent grant page.");
  }
  if (!hasNode(snapshot, "button", "Grant delegation")) {
    throw Error("Flow 2 did not reach the Grant delegation action.");
  }

  throw Error(
    "TODO: click Grant delegation and handle the first MetaMask signature",
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
