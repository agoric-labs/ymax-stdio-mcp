import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { main } from "./flow2.ts";

const UI_URL = "https://staging-agentic-ui.ymax0-ui.pages.dev";
const RECORDING = "/tmp/profile/.pinchtab-state/recordings/flow2.gif";

const response = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const makeFsp = ({ stateExists = false } = {}) =>
  Promise.resolve({
    stat: async (path: unknown) => {
      const name = String(path);
      if (name.endsWith("mcp-server/state.json")) {
        if (stateExists) return {} as any;
        throw Object.assign(Error("not found"), { code: "ENOENT" });
      }
      if (name === RECORDING) {
        return { isFile: () => true, size: 42 } as any;
      }
      throw Error(`unexpected stat: ${path}`);
    },
  } as any);

const makePinchtabFetch = (events: string[], bodies: unknown[]) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (href.endsWith("/health")) return response({});
    if (href.endsWith("/profiles")) {
      return response([
        { id: "prof_2", name: "ymax-flow2", path: "/tmp/profile" },
      ]);
    }
    if (href.endsWith("/profiles/prof_2/start")) {
      return response({ id: "inst_2", port: 9870, status: "starting" }, 201);
    }
    if (href.endsWith("/instances")) {
      return response([{ id: "inst_2", port: 9870, status: "running" }]);
    }
    if (href.endsWith("/navigate")) {
      events.push("navigate");
      return response({ ok: true });
    }
    if (href.endsWith("/record/start")) {
      events.push("record:start");
      return response({});
    }
    if (href.endsWith("/record/stop")) {
      events.push("record:stop");
      return response({ path: RECORDING });
    }
    if (href.endsWith("/record/status")) {
      return response({ state: "finished", outputPath: RECORDING });
    }
    throw Error(`unexpected URL: ${href}`);
  }) as typeof globalThis.fetch;

const makeClaudeSpawn = (
  events: string[],
  { fail, receive = () => undefined }: { fail?: Error; receive?: (prompt: string) => void } = {},
) =>
  ((_: string, args: string[]) => {
    events.push("claude:start");
    receive(String(args.at(-1)));
    const child = new EventEmitter();
    queueMicrotask(() => {
      if (fail) {
        child.emit("error", fail);
      } else {
        events.push("claude:exit");
        child.emit("exit", 0, null);
      }
    });
    return child;
  }) as any;

test("flow 2 records around an operator-driven Claude session", async () => {
  const events: string[] = [];
  const bodies: unknown[] = [];
  const logs: string[] = [];
  let output = "";
  let receivedPrompt = "";

  const result = await main(
    {
      PINCHTAB_TOKEN: "test-token",
      PINCHTAB_YMAX_PROFILE: "ymax-flow2",
      YMAX_UI_URL: UI_URL,
    },
    {
      cwd: "/repo",
      delay: async () => undefined,
      fetch: makePinchtabFetch(events, bodies),
      fspP: makeFsp(),
      spawn: makeClaudeSpawn(events, {
        receive: prompt => {
          receivedPrompt = prompt;
        },
      }),
      log: message => logs.push(message),
      stdout: {
        write: (text: string) => {
          output += text;
        },
      } as any,
    },
  );

  assert.deepStrictEqual(events, [
    "navigate",
    "record:start",
    "claude:start",
    "claude:exit",
    "record:stop",
  ]);
  assert.match(receivedPrompt, /existing YMax portfolio/);
  assert.match(receivedPrompt, /I'll handle any wallet approvals/);
  assert.doesNotMatch(receivedPrompt, /generate_delegate_key|clobberActiveDelegate/);
  assert.match(logs.join("\n"), /\/exit.*stop the recording/s);
  assert.strictEqual(result, undefined);
  assert.strictEqual(output, `${RECORDING}\n`);
  assert.deepStrictEqual(
    bodies.find(body => (body as { url?: string }).url),
    { url: UI_URL },
  );
  assert.deepStrictEqual(
    bodies.find(body => (body as { format?: string }).format),
    { format: "gif", fps: 5, quality: 70, scale: 1 },
  );
  assert.deepStrictEqual(
    bodies.find(body => (body as { securityPolicy?: unknown }).securityPolicy),
    {
      headless: false,
      securityPolicy: {
        allowedDomains: ["staging-agentic-ui.ymax0-ui.pages.dev"],
      },
    },
  );
});

test("flow 2 stops recording if interactive Claude fails", async () => {
  const events: string[] = [];
  const bodies: unknown[] = [];

  await assert.rejects(
    () =>
      main(
        {
          PINCHTAB_TOKEN: "test-token",
          PINCHTAB_YMAX_PROFILE: "ymax-flow2",
          YMAX_UI_URL: UI_URL,
        },
        {
          cwd: "/repo",
          delay: async () => undefined,
          fetch: makePinchtabFetch(events, bodies),
          fspP: makeFsp(),
          spawn: makeClaudeSpawn(events, {
            fail: Error("Claude exited unexpectedly"),
          }),
          log: () => undefined,
        },
      ),
    /Claude exited unexpectedly/,
  );
  assert.deepStrictEqual(events, [
    "navigate",
    "record:start",
    "claude:start",
    "record:stop",
  ]);
});

test("flow 2 refuses existing MCP state before recording or Claude", async () => {
  await assert.rejects(
    () =>
      main(
        { PINCHTAB_TOKEN: "test-token" },
        {
          cwd: "/repo",
          fetch: async () => {
            throw Error("state validation must precede PinchTab");
          },
          fspP: makeFsp({ stateExists: true }),
          spawn: (() => {
            throw Error("state validation must precede Claude");
          }) as any,
        },
      ),
    /blank MCP state.*Remove .*mcp-server\/state\.json/s,
  );
});
