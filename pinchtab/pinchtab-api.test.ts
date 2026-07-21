import test from "node:test";
import assert from "node:assert/strict";
import { makePinchTabEndpoint } from "./pinchtab-api.ts";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("instance addresses extension targets through PinchTab and Chromium", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href === "http://pinchtab/profiles") {
      return response([{ id: "profile-1", name: "flow", path: "/tmp/flow" }]);
    }
    if (href === "http://pinchtab/profiles/profile-1/start") {
      return response({ port: 9870 }, 201);
    }
    if (href.endsWith("/tabs/metamask/snapshot?filter=interactive")) {
      return response([{ ref: "approve", role: "button", name: "Confirm" }]);
    }
    if (href.endsWith("/tabs/metamask/action")) return response({ ok: true });
    if (href === "http://127.0.0.1:9871/json/list") {
      return response([{ id: "metamask", title: "MetaMask" }]);
    }
    throw Error(`unexpected URL: ${href}`);
  }) as typeof globalThis.fetch;

  const pinchtab = makePinchTabEndpoint(fetch, "http://pinchtab", "token", {
    join: () => ({}) as any,
  } as any);
  const profile = await pinchtab.provideProfile("flow");
  const instance = await profile.provideInstance(["main0.ymax.app"]);

  assert.deepStrictEqual(await instance.snapshot("metamask"), [
    { ref: "approve", role: "button", name: "Confirm" },
  ]);
  await instance.action({ kind: "click", ref: "approve" }, "metamask");
  assert.deepStrictEqual(await instance.targets(), [
    { id: "metamask", title: "MetaMask" },
  ]);

  const action = calls.find(({ url }) => url.endsWith("/action"));
  assert.deepStrictEqual(JSON.parse(String(action?.init?.body)), {
    kind: "click",
    ref: "approve",
  });
  const debug = calls.find(({ url }) => url.includes("9871/json/list"));
  assert.strictEqual(debug?.init, undefined);
});
