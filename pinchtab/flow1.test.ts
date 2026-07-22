import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { main } from "./flow1.ts";

const UI_URL = "https://staging-agentic-ui.ymax0-ui.pages.dev";
const RECORDING = "/tmp/profile/.pinchtab-state/recordings/flow1.gif";

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
      throw Error(`unexpected stat: ${name}`);
    },
  } as any);

const makePinchtabFetch = (events: string[], bodies: unknown[]) =>
  (() => {
    let startAttempts = 0;
    return async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (href.endsWith("/health")) return response({});
      if (href.endsWith("/profiles")) {
        return response([
          { id: "prof_1", name: "ymax-flow1", path: "/tmp/profile" },
        ]);
      }
      if (href.endsWith("/profiles/prof_1/start")) {
        startAttempts += 1;
        if (startAttempts === 1) return response("already running", 409);
        return response({ id: "inst_1", port: 9870, status: "starting" }, 201);
      }
      if (href.endsWith("/instances"))
        return response([{ id: "inst_1", port: 9870, status: "running" }]);
      if (href.endsWith("/profiles/prof_1/stop")) {
        events.push("profile:stop");
        return response({ status: "stopped" });
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
    };
  })() as typeof globalThis.fetch;

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

test("flow 1 requires an explicit deposit within the recording cap", async () => {
  for (const amount of [undefined, "0", "31", "not-a-number"]) {
    await assert.rejects(
      () =>
        main(
          {
            PINCHTAB_TOKEN: "test-token",
            YMAX_FLOW1_DEPOSIT_USDC: amount,
          },
          {
            fetch: async () => {
              throw Error("deposit validation must precede PinchTab");
            },
          },
        ),
      /no more than 30/,
    );
  }
});

test("flow 1 requires a bounded integer instrument count", async () => {
  for (const count of ["0", "1.5", "13", "not-a-number"]) {
    await assert.rejects(
      () =>
        main(
          {
            PINCHTAB_TOKEN: "test-token",
            YMAX_FLOW1_DEPOSIT_USDC: "9",
            YMAX_FLOW1_MAX_INSTRUMENTS: count,
          },
          {
            fetch: async () => {
              throw Error("instrument validation must precede PinchTab");
            },
          },
        ),
      /integer from 1 through 12/,
    );
  }
});

test("flow 1 records around an operator-driven Claude session", async () => {
  const events: string[] = [];
  const bodies: unknown[] = [];
  const logs: string[] = [];
  let output = "";
  let receivedPrompt = "";

  const result = await main(
    {
      PINCHTAB_TOKEN: "test-token",
      YMAX_UI_URL: UI_URL,
      YMAX_FLOW1_DEPOSIT_USDC: "9",
      YMAX_FLOW1_MAX_INSTRUMENTS: "3",
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
    "profile:stop",
    "record:start",
    "claude:start",
    "claude:exit",
    "record:stop",
  ]);
  assert.match(receivedPrompt, /9 USDC/);
  assert.match(receivedPrompt, /no more than 3 yield opportunities/);
  assert.match(receivedPrompt, /only.*Base chain/i);
  assert.match(logs.join("\n"), /\/exit.*stop the recording/s);
  assert.strictEqual(result, undefined);
  assert.strictEqual(output, `${RECORDING}\n`);
  assert.deepStrictEqual(
    bodies.find(body => (body as { format?: string }).format),
    { format: "gif", fps: 5, quality: 70, scale: 1 },
  );
  assert.deepStrictEqual(
    bodies.find(
      body => (body as { securityPolicy?: unknown }).securityPolicy,
    ),
    {
      headless: false,
      securityPolicy: {
        allowedDomains: ["staging-agentic-ui.ymax0-ui.pages.dev"],
      },
    },
  );
});

test("flow 1 stops recording if interactive Claude fails", async () => {
  const events: string[] = [];
  const bodies: unknown[] = [];
  await assert.rejects(
    () =>
      main(
        {
          PINCHTAB_TOKEN: "test-token",
          YMAX_UI_URL: UI_URL,
          YMAX_FLOW1_DEPOSIT_USDC: "9",
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
    "profile:stop",
    "record:start",
    "claude:start",
    "record:stop",
  ]);
});

test("flow 1 refuses existing MCP state before recording or Claude", async () => {
  await assert.rejects(
    () =>
      main(
        {
          PINCHTAB_TOKEN: "test-token",
          YMAX_FLOW1_DEPOSIT_USDC: "9",
        },
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
