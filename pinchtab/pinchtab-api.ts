import type { WritableFile } from "./pola-io.ts";

export const makePinchTabEndpoint = (
  fetch: typeof globalThis.fetch,
  baseUrl: string,
  token: string,
  files: WritableFile,
) => {
  const request = (url: string, init?: RequestInit) => {
    const options = init || {};
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  };

  const json = async (path: string, init?: RequestInit) => {
    const url = `${baseUrl}${path}`;
    const response = await request(url, init);
    if (!response.ok) {
      const body = await response.text();
      throw Error(`PinchTab API ${url} failed (${response.status}): ${body}`);
    }
    return response.json();
  };

  const status = async (path: string, init?: RequestInit) => {
    const response = await request(`${baseUrl}${path}`, init);
    return {
      status: response.status,
      body: await response.text(),
    };
  };

  const makeInstance = (instance: JsonRecord) => {
    const { port } = instance;
    if (!port) {
      throw Error(
        `PinchTab did not return an instance port:\n${JSON.stringify(instance)}`,
      );
    }
    const instanceUrl = `http://127.0.0.1:${port}`;
    const instanceJson = async (path: string, init?: RequestInit) => {
      const url = `${instanceUrl}${path}`;
      const response = await request(url, init);
      if (!response.ok) {
        const body = await response.text();
        throw Error(`PinchTab API ${url} failed (${response.status}): ${body}`);
      }
      return response.json();
    };

    return {
      async navigate(url: string) {
        return instanceJson("/navigate", {
          method: "POST",
          body: JSON.stringify({ url }),
        });
      },
      async snapshot() {
        return instanceJson("/snapshot?filter=interactive", undefined);
      },
      recorder: {
        async startGif() {
          return instanceJson("/record/start", {
            method: "POST",
            body: JSON.stringify({
              format: "gif",
              fps: 5,
              quality: 70,
              scale: 1,
            }),
          });
        },
        async stop() {
          const stopped = await instanceJson("/record/stop", {
            method: "POST",
            body: "{}",
          });
          if (stopped.error) {
            throw Error(`PinchTab recording failed:\n${stopped.error}`);
          }
        },
        async status() {
          return instanceJson("/record/status", undefined);
        },
      },
    };
  };

  const makeProfile = (profile: JsonRecord) => ({
    id: profile.id,
    getFiles() {
      if (!profile.path) {
        throw Error(
          `PinchTab profile ${profile.name || profile.id} did not include a path`,
        );
      }
      return files.join(profile.path);
    },
    getRecordingsDir() {
      return this.getFiles().join(".pinchtab-state", "recordings");
    },
    async provideInstance() {
      const start = await status(`/profiles/${profile.id}/start`, {
        method: "POST",
        body: JSON.stringify({
          headless: false,
          securityPolicy: { allowedDomains: ["main0.ymax.app"] },
        }),
      });

      if ([200, 201, 202].includes(start.status)) {
        return makeInstance(JSON.parse(start.body));
      }
      if (start.status === 409) {
        return makeInstance(
          await json(`/profiles/${profile.id}/instance`, undefined),
        );
      }

      throw Error(
        `PinchTab profile start failed with HTTP ${start.status}:\n${start.body}`,
      );
    },
  });

  return {
    async health() {
      return json("/health", undefined);
    },
    async provideProfile(name: string) {
      const profiles = await json("/profiles", undefined);
      const existing = profiles.find(
        (profile: JsonRecord) => profile.name === name,
      );
      if (existing) {
        return makeProfile(existing);
      }

      const created = await json("/profiles", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "Dedicated YMax Flow 1 recording profile",
          useWhen: "Use only for operator-supervised YMax recordings",
        }),
      });
      return makeProfile(created);
    },
  };
};

export type PinchTabEndpoint = ReturnType<typeof makePinchTabEndpoint>;
export type PinchTabProfile = Awaited<
  ReturnType<PinchTabEndpoint["provideProfile"]>
>;
export type PinchTabInstance = Awaited<
  ReturnType<PinchTabProfile["provideInstance"]>
>;
export type JsonRecord = Record<string, any>;
