import test from "node:test";
import assert from "node:assert/strict";
import {
  finishRecording,
  makePinchTabEndpoint,
} from "./pinchtab-api.ts";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("recording finalization stops, polls, and validates the artifact", async () => {
  const events: string[] = [];
  let polls = 0;
  const recording = {
    toString: () => "/tmp/profile/recordings/flow.gif",
    stat: async () => ({ isFile: () => true, size: 42 }),
  };
  const recordings = {
    toString: () => "/tmp/profile/recordings",
    join: (name: string) => {
      assert.strictEqual(name, "flow.gif");
      return recording;
    },
  };

  const result = await finishRecording({
    recorder: {
      stop: async () => {
        events.push("stop");
      },
      status: async () => {
        polls += 1;
        events.push(`poll:${polls}`);
        return polls === 1
          ? { state: "encoding" }
          : {
              state: "finished",
              outputPath: "/tmp/profile/recordings/flow.gif",
            };
      },
    } as any,
    recordings: recordings as any,
    delay: async () => events.push("delay"),
  });

  assert.strictEqual(result, recording);
  assert.deepStrictEqual(events, ["stop", "poll:1", "delay", "poll:2"]);
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
      return response({ id: "instance-1", port: 9870 }, 201);
    }
    if (href === "http://pinchtab/instances")
      return response([{ id: "instance-1", port: 9870, status: "running" }]);
    if (href.endsWith("/tabs/metamask/snapshot?filter=interactive")) {
      return response([{ ref: "approve", role: "button", name: "Confirm" }]);
    }
    if (href.endsWith("/tabs/metamask/action")) return response({ ok: true });
    if (href === "http://127.0.0.1:9871/json/list") {
      return response([{ id: "metamask", title: "MetaMask" }]);
    }
    throw Error(`unexpected URL: ${href}`);
  }) as typeof globalThis.fetch;

  const pinchtab = makePinchTabEndpoint(
    fetch,
    "http://pinchtab",
    "token",
    {
      join: () => ({}) as any,
    } as any,
    { delay: async () => undefined },
  );
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

test("profile start waits for the exact instance to become running", async () => {
  const events: string[] = [];
  let polls = 0;
  const fetch = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href === "http://pinchtab/profiles") {
      return response([{ id: "profile-1", name: "flow", path: "/tmp/flow" }]);
    }
    if (href === "http://pinchtab/profiles/profile-1/start") {
      return response({ id: "instance-new", port: 9870, status: "starting" }, 201);
    }
    if (href === "http://pinchtab/instances") {
      polls += 1;
      events.push(`poll:${polls}`);
      return response([
        { id: "instance-old", port: 9872, status: "running" },
        {
          id: "instance-new",
          port: 9870,
          status: polls === 1 ? "starting" : "running",
        },
      ]);
    }
    if (href === "http://127.0.0.1:9870/navigate") {
      events.push("navigate");
      return response({ ok: true });
    }
    throw Error(`unexpected URL: ${href}`);
  }) as typeof globalThis.fetch;

  const pinchtab = makePinchTabEndpoint(
    fetch,
    "http://pinchtab",
    "token",
    { join: () => ({}) as any } as any,
    { delay: async () => events.push("delay") },
  );
  const profile = await pinchtab.provideProfile("flow");
  const instance = await profile.provideInstance();
  await instance.navigate("https://main0.ymax.app");

  assert.deepStrictEqual(events, ["poll:1", "delay", "poll:2", "navigate"]);
});
