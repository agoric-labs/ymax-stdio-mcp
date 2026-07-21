import { query as queryClaude } from "@anthropic-ai/claude-agent-sdk";

const MCP_SERVER = {
  type: "stdio" as const,
  command: "./mcp-server/node_modules/.bin/tsx",
  args: ["mcp-server/src/server.ts"],
  timeout: 600_000,
  alwaysLoad: true,
};

export type AgentQuery = typeof queryClaude;

// Pattern: Explicit Agent Powers. No default arguments here: callers provide
// the query function, cwd, and environment capability.
export const runClaudeAgentTurn = async (
  prompt: string,
  {
    query,
    cwd,
    env,
    label,
    resume,
  }: {
    query: AgentQuery;
    cwd: string;
    env: NodeJS.ProcessEnv;
    label: string;
    resume?: string;
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
      // Pattern: Local-MCP Full Surface. Expose every tool from the one
      // explicitly configured stdio server, and no unrelated built-in tools.
      tools: [],
      allowedTools: ["mcp__ymax-yield-agent__*"],
      permissionMode: "dontAsk",
      persistSession: true,
      ...(resume ? { resume } : {}),
    },
  })) {
    if (!sessionId && "session_id" in message) {
      sessionId = message.session_id;
      console.info(`${label} agent: Claude session ${sessionId}`);
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          console.info(`${label} agent: calling ${block.name}...`);
        } else if (block.type === "text") {
          output.push(block.text);
          console.info(`${label} agent: ${block.text}`);
        }
      }
    } else if (message.type === "result") {
      if (message.subtype !== "success") {
        throw Error(message.errors.join("\n") || message.subtype);
      }
      output.push(message.result);
    }
  }
  return { output: output.join("\n"), sessionId };
};

export const checkSponsorFailure = (output: string) => {
  if (/set SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY/i.test(output)) {
    throw Error(
      "The MCP server needs a sponsor credential to create and provision a delegate. Configure SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY in mcp-server/.env, then rerun the script.",
    );
  }
};
