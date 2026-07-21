import test from "node:test";
import assert from "node:assert/strict";
import {
  extractGrantUrl,
  main,
  runClaudeAgent,
} from "./flow2.ts";

const UI_URL = "https://staging-agentic-ui.ymax0-ui.pages.dev";
const GRANT_URL = `${UI_URL}/grant?accountHolder=agoric1delegate`;
const response = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("Claude SDK gets every tool from only the local MCP server", async () => {
  let call: any;
  const output = await runClaudeAgent("A DeFi user request", {
    cwd: "/repo",
    env: { PATH: "/bin" },
    query: ((input: any) => {
      call = input;
      return (async function* () {
        yield {
          type: "assistant",
          session_id: "session-2",
          message: {
            content: [
              { type: "tool_use", name: "mcp__ymax-yield-agent__propose_grant" },
              { type: "text", text: `Prepared: ${GRANT_URL}` },
            ],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "session-2",
          result: `Prepared: ${GRANT_URL}`,
        };
      })();
    }) as any,
  });

  assert.strictEqual(call.prompt, "A DeFi user request");
  assert.strictEqual(call.options.cwd, "/repo");
  assert.strictEqual(call.options.strictMcpConfig, true);
  assert.strictEqual(call.options.persistSession, true);
  assert.deepStrictEqual(call.options.tools, []);
  assert.deepStrictEqual(call.options.allowedTools, [
    "mcp__ymax-yield-agent__*",
  ]);
  assert.strictEqual(
    call.options.mcpServers["ymax-yield-agent"].command,
    "./mcp-server/node_modules/.bin/tsx",
  );
  assert.match(output, /Prepared:/);
});

test("grant URL must come from the configured YMax UI", () => {
  assert.strictEqual(
    extractGrantUrl(`Prepared: ${GRANT_URL}`, UI_URL),
    GRANT_URL,
  );
  assert.throws(
    () =>
      extractGrantUrl(
        "https://attacker.example/grant?accountHolder=agoric1delegate",
        UI_URL,
      ),
    /did not return a valid/,
  );
});

test("flow 2 stops before the Grant delegation MetaMask signature", async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    urls.push(href);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (href.endsWith("/health")) return response({});
    if (href.endsWith("/profiles")) {
      return response([{ id: "prof_2", name: "ymax-flow1", path: "/tmp/p" }]);
    }
    if (href.endsWith("/profiles/prof_2/start")) {
      return response({ port: 9870 }, 201);
    }
    if (href.endsWith("/navigate")) return response({ ok: true });
    if (href.endsWith("/snapshot?filter=interactive")) {
      return response({
        nodes: [
          { role: "heading", name: "New agent" },
          { role: "button", name: "Grant delegation" },
        ],
      });
    }
    throw Error(`unexpected URL: ${href}`);
  };

  await assert.rejects(
    () =>
      main(
        {
          PINCHTAB_TOKEN: "test-token",
          YMAX_UI_URL: UI_URL,
        },
        {
          fetch: fetch as typeof globalThis.fetch,
          query: (({ prompt }: { prompt: string }) => {
            assert.match(prompt, /existing YMax portfolio/);
            assert.doesNotMatch(prompt, /generate_delegate_key/);
            assert.doesNotMatch(prompt, /clobberActiveDelegate/);
            return (async function* () {
              yield {
                type: "result",
                subtype: "success",
                session_id: "session-2",
                result: `Prepared: ${GRANT_URL}`,
              };
            })();
          }) as any,
        },
      ),
    {
      message:
        "TODO: click Grant delegation and handle the first MetaMask signature",
    },
  );

  assert.ok(urls.includes("http://127.0.0.1:9870/navigate"));
  assert.deepStrictEqual(
    bodies.find((body) => (body as { url?: string }).url),
    { url: GRANT_URL },
  );
});

test("flow 2 reports a missing sponsor credential directly", async () => {
  await assert.rejects(
    () =>
      main(
        { PINCHTAB_TOKEN: "test-token", YMAX_UI_URL: UI_URL },
        {
          fetch: async () => {
            throw Error("PinchTab should not be called after agent failure");
          },
          query: (() => (async function* () {
            yield {
              type: "result",
              subtype: "success",
              session_id: "session-2",
              result:
                "generate_delegate_key failed: set SPONSOR_MNEMONIC or SPONSOR_PRIVATE_KEY",
            };
          })()) as any,
        },
      ),
    /mcp-server\/\.env/,
  );
});

test("flow 2 rejects a profile that is not already connected", async () => {
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith("/health")) return response({});
    if (href.endsWith("/profiles")) {
      return response([{ id: "prof_2", name: "ymax-flow1", path: "/tmp/p" }]);
    }
    if (href.endsWith("/profiles/prof_2/start")) {
      return response({ port: 9870 }, 201);
    }
    if (href.endsWith("/navigate")) return response({ ok: true });
    if (href.endsWith("/snapshot?filter=interactive")) {
      return response({
        nodes: [{ role: "button", name: "Connect Wallet" }],
      });
    }
    throw Error(`unexpected URL: ${href} ${init?.method || "GET"}`);
  };

  await assert.rejects(
    () =>
      main(
        { PINCHTAB_TOKEN: "test-token", YMAX_UI_URL: UI_URL },
        {
          fetch: fetch as typeof globalThis.fetch,
          query: (() => (async function* () {
            yield {
              type: "result",
              subtype: "success",
              session_id: "session-2",
              result: `Prepared: ${GRANT_URL}`,
            };
          })()) as any,
        },
      ),
    /wallet is already connected/,
  );
});
