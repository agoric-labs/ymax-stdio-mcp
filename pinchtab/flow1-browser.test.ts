import test from "node:test";
import assert from "node:assert/strict";
import { driveOwnerFlow } from "./flow1-browser.ts";

const UI_URL = "https://staging-agentic-ui.ymax0-ui.pages.dev";
const UI_HOST = "staging-agentic-ui.ymax0-ui.pages.dev";

test("owner flow connects MetaMask, deposits, and approves every request", async () => {
  const actions: { tabId?: string; action: Record<string, unknown> }[] = [];
  let connected = false;
  let walletModal = false;
  let amount = "";
  let request: "connect" | "sign" | "confirm" | undefined;
  let complete = false;

  const mainNodes = () => {
    const nodes: Record<string, unknown>[] = [
      { ref: "create-heading", role: "heading", name: "Create Your Portfolio" },
      {
        ref: "review-heading",
        role: "heading",
        name: "Step 2: Review Your Portfolio",
      },
      { ref: "deposit-heading", role: "heading", name: "Step 3: Deposit USDC" },
      { ref: "deposit", role: "spinbutton", name: "0", value: amount },
    ];
    if (!connected) {
      nodes.push({ ref: "connect-wallet", role: "button", name: "Connect Wallet" });
    } else {
      nodes.push({ ref: "create", role: "button", name: "Create Portfolio" });
    }
    if (walletModal) {
      nodes.push({
        ref: "metamask-option",
        role: "button",
        name: "metamask MetaMask Installed",
      });
    }
    if (complete) {
      nodes.push({
        ref: "complete",
        role: "heading",
        name: "We're Creating Your Portfolio!",
      });
    }
    return nodes;
  };

  const walletNodes = () => [
    { ref: "origin", role: "heading", name: UI_HOST },
    {
      ref: "approve",
      role: "button",
      name:
        request === "connect" ? "Connect" : request === "sign" ? "Sign" : "Confirm",
    },
  ];

  const instance = {
    snapshot: async (tabId?: string) =>
      tabId ? walletNodes() : mainNodes(),
    targets: async () => [
      {
        id: "ymax",
        type: "page",
        title: "max",
        url: complete ? `${UI_URL}/portfolio/84` : `${UI_URL}/create-portfolio`,
      },
      ...(request
        ? [
            {
              id: `metamask-${request}`,
              type: "page",
              title: "MetaMask",
              url: `chrome-extension://wallet/notification.html#/${request}`,
            },
          ]
        : []),
    ],
    action: async (action: Record<string, unknown>, tabId?: string) => {
      actions.push({ action, tabId });
      if (tabId) {
        assert.strictEqual(action.ref, "approve");
        if (request === "connect") {
          connected = true;
          walletModal = false;
          request = undefined;
        } else if (request === "sign") {
          request = "confirm";
        } else if (request === "confirm") {
          request = undefined;
          complete = true;
        }
      } else if (action.ref === "connect-wallet") {
        walletModal = true;
      } else if (action.kind === "press") {
        request = "connect";
      } else if (action.kind === "fill") {
        amount = String(action.text);
      } else if (action.ref === "create") {
        request = "sign";
      }
      return {};
    },
  } as any;

  const result = await driveOwnerFlow(instance, {
    amount: 3,
    uiUrl: UI_URL,
    delay: async () => undefined,
  });

  assert.deepStrictEqual(result, { approvals: 2 });
  assert.strictEqual(amount, "3");
  assert.deepStrictEqual(
    actions.filter(({ tabId }) => tabId).map(({ action }) => action.ref),
    ["approve", "approve", "approve"],
  );
  assert.ok(
    actions.some(
      ({ action }) => action.kind === "fill" && action.text === "3",
    ),
  );
  assert.ok(actions.some(({ action }) => action.ref === "create"));
});

test("owner flow refuses a MetaMask request from another origin", async () => {
  const instance = {
    snapshot: async (tabId?: string) =>
      tabId
        ? [
            { ref: "origin", role: "heading", name: "attacker.example" },
            { ref: "approve", role: "button", name: "Confirm" },
          ]
        : [
            { ref: "create-heading", role: "heading", name: "Create Your Portfolio" },
            { ref: "review", role: "heading", name: "Review Your Portfolio" },
            { ref: "deposit-heading", role: "heading", name: "Deposit USDC" },
            { ref: "deposit", role: "spinbutton", name: "0" },
            { ref: "create", role: "button", name: "Create Portfolio" },
          ],
    targets: async () => [
      {
        id: "ymax",
        type: "page",
        title: "max",
        url: `${UI_URL}/create-portfolio`,
      },
      {
        id: "metamask-confirm",
        type: "page",
        title: "MetaMask",
        url: "chrome-extension://wallet/notification.html#/confirm",
      },
    ],
    action: async () => ({}),
  } as any;

  await assert.rejects(
    () =>
      driveOwnerFlow(instance, {
        amount: 3,
        uiUrl: UI_URL,
        delay: async () => undefined,
      }),
    /does not identify.*ymax0-ui/,
  );
});
