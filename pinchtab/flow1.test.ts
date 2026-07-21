import test from "node:test";
import assert from "node:assert/strict";
import {
  findExpectedCreateUrl,
  main,
  validateRedemption,
} from "./flow1.ts";

const UI_URL = "https://staging-agentic-ui.ymax0-ui.pages.dev";
const CREATE_URL = `${UI_URL}/create-portfolio?Compound_Base=100&accountHolder=agoric1delegate&permissions=change-allocations`;

const response = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("create URL must be an allocated create-and-delegate proposal from YMax", () => {
  assert.strictEqual(
    findExpectedCreateUrl(`Here is your proposal: ${CREATE_URL}`, UI_URL),
    CREATE_URL,
  );
  assert.throws(
    () =>
      findExpectedCreateUrl(
        "https://attacker.example/create-portfolio?Compound_Base=100&accountHolder=agoric1delegate&permissions=change-allocations",
        UI_URL,
      ),
    /valid create-and-delegate/,
  );
  assert.throws(
    () =>
      findExpectedCreateUrl(
        `${UI_URL}/create-portfolio?Compound_Base=50&Aave_Base=50&accountHolder=agoric1delegate&permissions=change-allocations`,
        UI_URL,
        1,
      ),
    /valid create-and-delegate/,
  );
  assert.throws(
    () =>
      findExpectedCreateUrl(
        `${UI_URL}/create-portfolio?accountHolder=agoric1delegate&permissions=change-allocations`,
        UI_URL,
      ),
    /valid create-and-delegate/,
  );
});

test("create URL may be surrounded by Markdown formatting", () => {
  assert.strictEqual(
    findExpectedCreateUrl(`Here's your proposal: **${CREATE_URL}**`, UI_URL),
    CREATE_URL,
  );
  assert.strictEqual(
    findExpectedCreateUrl(
      `Here's your proposal: [review it](${CREATE_URL})`,
      UI_URL,
    ),
    CREATE_URL,
  );
});

test("redemption must identify the portfolio, agent, and allocation authority", () => {
  assert.doesNotThrow(() =>
    validateRedemption(
      'Done: {"status":"redeemed","portfolioId":84,"agentId":"agent2","permissions":{"allocation":true}}',
    ),
  );
  assert.throws(
    () => validateRedemption('{"status":"redeemed","portfolioId":84}'),
    /valid redeemed delegation/,
  );
});

test("flow 1 requires an explicit deposit within the 30 USDC cap", async () => {
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
              throw Error("deposit validation must precede ambient I/O");
            },
            query: (() => {
              throw Error("deposit validation must precede the agent");
            }) as any,
            ownerFlow: async () => undefined,
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
            YMAX_FLOW1_DEPOSIT_USDC: "3",
            YMAX_FLOW1_MAX_INSTRUMENTS: count,
          },
          {
            fetch: async () => {
              throw Error("configuration validation must precede ambient I/O");
            },
            query: (() => {
              throw Error("configuration validation must precede the agent");
            }) as any,
            ownerFlow: async () => undefined,
          },
        ),
      /integer from 1 through 12/,
    );
  }
});

test("flow 1 automates the wallet flow, then redeems in the same session", async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const agentCalls: any[] = [];
  let ownerFlowCall: any;

  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    urls.push(href);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (href.endsWith("/health")) return response({});
    if (href.endsWith("/profiles")) {
      return response([{ id: "prof_1", name: "ymax-flow1", path: "/tmp/p" }]);
    }
    if (href.endsWith("/profiles/prof_1/start")) {
      return response({ port: 9870 }, 201);
    }
    if (href.endsWith("/navigate")) return response({ ok: true });
    throw Error(`unexpected URL: ${href}`);
  };

  const query = ((input: any) => {
    agentCalls.push(input);
    const secondTurn = Boolean(input.options.resume);
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        session_id: "session-1",
        result: secondTurn
          ? '{"status":"redeemed","portfolioId":84,"agentId":"agent2","permissions":{"allocation":true}}'
          : `Prepared: ${CREATE_URL}`,
      };
    })();
  }) as any;

  const result = await main(
    {
      PINCHTAB_TOKEN: "test-token",
      YMAX_UI_URL: UI_URL,
      YMAX_FLOW1_DEPOSIT_USDC: "3",
      YMAX_FLOW1_MAX_INSTRUMENTS: "1",
    },
    {
      fetch: fetch as typeof globalThis.fetch,
      query,
      ownerFlow: async (instance, options) => {
        ownerFlowCall = { instance, options };
      },
      delay: async () => undefined,
    },
  );

  assert.deepStrictEqual(result, {
    createUrl: CREATE_URL,
    sessionId: "session-1",
  });
  assert.strictEqual(agentCalls.length, 2);
  assert.match(agentCalls[0].prompt, /3 USDC/);
  assert.match(agentCalls[0].prompt, /no more than 1 yield opportunities/);
  assert.match(agentCalls[0].prompt, /Agent-side transactions.*in scope/);
  assert.match(agentCalls[0].prompt, /Don't create the portfolio.*owner-wallet/);
  assert.doesNotMatch(agentCalls[0].prompt, /generate_delegate_key|propose_create/);
  assert.strictEqual(agentCalls[1].options.resume, "session-1");
  assert.match(agentCalls[1].prompt, /approved.*redeem the invitation/s);
  assert.match(agentCalls[1].prompt, /beyond the invitation redemption/);
  assert.strictEqual(ownerFlowCall.options.amount, 3);
  assert.strictEqual(ownerFlowCall.options.uiUrl, UI_URL);
  assert.ok(urls.includes("http://127.0.0.1:9870/navigate"));
  assert.deepStrictEqual(
    bodies.find((body) => (body as { url?: string }).url),
    { url: CREATE_URL },
  );
});

test("flow 1 does not redeem if the automated wallet flow fails", async () => {
  let agentTurns = 0;
  await assert.rejects(
    () =>
      main(
        {
          PINCHTAB_TOKEN: "test-token",
          YMAX_UI_URL: UI_URL,
          YMAX_FLOW1_DEPOSIT_USDC: "20",
        },
        {
          fetch: (async (url: string | URL | Request) => {
            const href = String(url);
            if (href.endsWith("/health")) return response({});
            if (href.endsWith("/profiles")) {
              return response([
                { id: "prof_1", name: "ymax-flow1", path: "/tmp/p" },
              ]);
            }
            if (href.endsWith("/profiles/prof_1/start")) {
              return response({ port: 9870 }, 201);
            }
            if (href.endsWith("/navigate")) return response({ ok: true });
            throw Error(`unexpected URL: ${href}`);
          }) as typeof globalThis.fetch,
          query: ((input: any) => {
            agentTurns += 1;
            assert.ok(!input.options.resume);
            return (async function* () {
              yield {
                type: "result",
                subtype: "success",
                session_id: "session-1",
                result: CREATE_URL,
              };
            })();
          }) as any,
          ownerFlow: async () => {
            throw Error("wallet flow failed");
          },
        },
      ),
    /wallet flow failed/,
  );
  assert.strictEqual(agentTurns, 1);
});
