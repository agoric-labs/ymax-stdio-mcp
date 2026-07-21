#!/usr/bin/env -S node --import ts-blank-space/register
/** @file Flow 2: prepare an existing-portfolio agent grant, without signing. */
/* global globalThis */
import { pathToFileURL } from "node:url";
import { query as queryClaude } from "@anthropic-ai/claude-agent-sdk";
import {
  getPinchtabConfig,
  makePinchTabEndpoint,
  type JsonRecord,
} from "./pinchtab-api.ts";
import { makeFileRW } from "./pola-io.ts";

const MCP_SERVER = {
  type: "stdio" as const,
  command: "./mcp-server/node_modules/.bin/tsx",
  args: ["mcp-server/src/server.ts"],
  timeout: 600_000,
  alwaysLoad: true,
};

type AgentQuery = typeof queryClaude;

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
  const output: string[] = [];
  let sessionId: string | undefined;
  for await (const message of query({
    prompt,
    options: {
      cwd,
      env,
      mcpServers: { "ymax-yield-agent": MCP_SERVER },
      strictMcpConfig: true,
      tools: [],
      allowedTools: ["mcp__ymax-yield-agent__*"],
      permissionMode: "dontAsk",
      persistSession: true,
    },
  })) {
    if (!sessionId && "session_id" in message) {
      sessionId = message.session_id;
      console.info(`Flow 2 agent: Claude session ${sessionId}`);
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          console.info(`Flow 2 agent: calling ${block.name}...`);
        } else if (block.type === "text") {
          output.push(block.text);
          console.info(`Flow 2 agent: ${block.text}`);
        }
      }
    } else if (message.type === "result") {
      if (message.subtype !== "success") {
        throw Error(message.errors.join("\n") || message.subtype);
      }
      output.push(message.result);
    }
  }
  return output.join("\n");
};

const PROMPT = [
  "I have an existing YMax portfolio and I'd like this agent to help manage its allocations.",
  "Please get the agent ready and give me the YMax link where I can review and approve the delegation.",
  "Don't change my portfolio or submit any transactions; I'll review and approve everything in my wallet.",
].join(" ");

export const extractGrantUrl = (text: string, expectedUiUrl: string) => {
  const candidates = text.match(/https:\/\/[^\s<>"')]+/g) || [];
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

const checkAgentFailure = (output: string) => {
  if (/set SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY/i.test(output)) {
    throw Error(
      "The MCP server needs a sponsor credential to create and provision a delegate. Configure SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY in mcp-server/.env, then rerun the script.",
    );
  }
};

const hasNode = (snapshot: JsonRecord, role: string, name: string) =>
  snapshot.nodes?.some(
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

  console.info(
    "Flow 2: starting a persisted local Claude session. This may take a few minutes...",
  );
  const agentOutput = await runClaudeAgent(PROMPT, {
    query,
    cwd,
    env,
  });
  console.info("Flow 2: local agent finished; validating its grant proposal...");
  checkAgentFailure(agentOutput);
  const uiUrl =
    env.YMAX_UI_URL || "https://staging-agentic-ui.ymax0-ui.pages.dev";
  const grantUrl = extractGrantUrl(agentOutput, uiUrl);

  console.info("Flow 2: checking the local PinchTab server...");
  await pinchtab.health();
  console.info(`Flow 2: finding PinchTab profile ${config.profileName}...`);
  const profile = await pinchtab.provideProfile(config.profileName);
  console.info(
    `Flow 2: starting or reusing PinchTab profile ${config.profileName}...`,
  );
  const instance = await profile.provideInstance();
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
