import {
  getSnapshotNodes,
  type JsonRecord,
  type PinchTabInstance,
} from "./pinchtab-api.ts";

const nodeNamed = (snapshot: JsonRecord, role: string, name: RegExp) =>
  getSnapshotNodes(snapshot).find(
    (node: JsonRecord) => node.role === role && name.test(node.name || ""),
  );

const requireRef = (node: JsonRecord | undefined, description: string) => {
  if (!node?.ref) {
    throw Error(`Flow 1 could not find ${description}.`);
  }
  return node.ref as string;
};

const poll = async <T>(
  read: () => Promise<T | undefined>,
  delay: (milliseconds: number) => Promise<void>,
  description: string,
  attempts = 60,
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(1_000);
  }
  throw Error(`Timed out waiting for ${description}.`);
};

const getMetaMaskTarget = async (instance: PinchTabInstance) => {
  const targets = (await instance.targets()) as JsonRecord[];
  return targets.find(
    (target) =>
      target.type === "page" &&
      target.title === "MetaMask" &&
      /^chrome-extension:\/\/[^/]+\/notification\.html#\//.test(target.url),
  );
};

// Pattern: Origin-Bound Wallet Approval. Approve only a recognized action in a
// MetaMask notification that visibly identifies the configured YMax host.
const approveMetaMask = async (
  instance: PinchTabInstance,
  target: JsonRecord,
  uiHostname: string,
) => {
  const snapshot = await instance.snapshot(target.id);
  const nodes = getSnapshotNodes(snapshot);
  if (!nodes.some((node: JsonRecord) => (node.name || "").includes(uiHostname))) {
    throw Error(
      `Refusing a MetaMask request that does not identify ${uiHostname}.`,
    );
  }
  const approval = nodes.find(
    (node: JsonRecord) =>
      node.role === "button" &&
      /^(Connect|Sign|Confirm|Approve|Switch network)$/i.test(node.name || ""),
  );
  await instance.action(
    { kind: "click", ref: requireRef(approval, "a MetaMask approval action") },
    target.id,
  );
};

const proposalIsComplete = async (
  instance: PinchTabInstance,
  uiOrigin: string,
) => {
  const snapshot = await instance.snapshot();
  if (
    nodeNamed(
      snapshot,
      "heading",
      /Creating Your Portfolio|Portfolio (?:Created|Ready)|Congratulations/i,
    ) ||
    nodeNamed(snapshot, "button", /View|Go to.*Portfolio/i)
  ) {
    return true;
  }
  const targets = (await instance.targets()) as JsonRecord[];
  return targets.some((target) => {
    if (target.type !== "page") return false;
    const url = new URL(target.url);
    return url.origin === uiOrigin && url.pathname !== "/create-portfolio";
  });
};

export const driveOwnerFlow = async (
  instance: PinchTabInstance,
  {
    amount,
    uiUrl,
    delay,
  }: {
    amount: number;
    uiUrl: string;
    delay: (milliseconds: number) => Promise<void>;
  },
) => {
  const ui = new URL(uiUrl);
  let snapshot = await instance.snapshot();
  if (!nodeNamed(snapshot, "heading", /Create Your Portfolio/i)) {
    throw Error("Flow 1 did not reach the Create Your Portfolio page.");
  }
  if (
    !nodeNamed(snapshot, "heading", /Review Your Portfolio/i) ||
    !nodeNamed(snapshot, "heading", /Deposit USDC/i) ||
    !nodeNamed(snapshot, "spinbutton", /^0(?:\.0+)?$/)
  ) {
    throw Error("Flow 1 proposal did not reach the review and deposit steps.");
  }

  const connectWallet = nodeNamed(snapshot, "button", /^Connect Wallet$/i);
  if (connectWallet) {
    await instance.action({
      kind: "click",
      ref: requireRef(connectWallet, "Connect Wallet"),
    });
    snapshot = await poll(
      async () => {
        const current = await instance.snapshot();
        return nodeNamed(current, "button", /MetaMask.*Installed/i)
          ? current
          : undefined;
      },
      delay,
      "the wallet selector",
    );
    const metamask = nodeNamed(snapshot, "button", /MetaMask.*Installed/i);
    await instance.action({
      kind: "focus",
      ref: requireRef(metamask, "the MetaMask wallet option"),
    });
    await instance.action({ kind: "press", key: "Enter" });

    const connectTarget = await poll(
      () => getMetaMaskTarget(instance),
      delay,
      "the MetaMask connection request",
    );
    await approveMetaMask(instance, connectTarget, ui.hostname);
    snapshot = await poll(
      async () => {
        const current = await instance.snapshot();
        return nodeNamed(current, "button", /^Create Portfolio$/i)
          ? current
          : undefined;
      },
      delay,
      "YMax to recognize the connected wallet",
    );
  }

  const depositInput = nodeNamed(snapshot, "spinbutton", /^0(?:\.0+)?$/);
  await instance.action({
    kind: "fill",
    ref: requireRef(depositInput, "the USDC deposit input"),
    text: String(amount),
  });
  snapshot = await instance.snapshot();
  const create = nodeNamed(snapshot, "button", /^Create Portfolio$/i);
  if (create?.disabled) {
    throw Error("Flow 1 deposit did not enable Create Portfolio.");
  }
  await instance.action({
    kind: "click",
    ref: requireRef(create, "the enabled Create Portfolio action"),
  });

  let approvals = 0;
  for (;;) {
    if (approvals >= 12) {
      throw Error("Flow 1 exceeded the 12-request MetaMask safety limit.");
    }
    const next = await poll<
      { complete: true } | { complete: false; target: JsonRecord }
    >(
      async () => {
        if (await proposalIsComplete(instance, ui.origin)) {
          return { complete: true as const };
        }
        const target = await getMetaMaskTarget(instance);
        return target ? { complete: false as const, target } : undefined;
      },
      delay,
      "the next MetaMask request or YMax completion",
    );
    if (next.complete) break;
    await approveMetaMask(instance, next.target, ui.hostname);
    approvals += 1;
    await delay(1_000);
  }
  if (approvals === 0) {
    throw Error("Flow 1 completed without observing a MetaMask approval.");
  }
  return { approvals };
};
