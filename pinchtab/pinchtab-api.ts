import {
  hasErrorCode,
  joinTailUnder,
  type ReadableFile,
  type WritableFile,
} from "./pola-io.ts";

export const getRecordingFormat = (format = "mp4") => {
  switch (format) {
    case "gif":
    case "mp4":
    case "webm":
      return format;
    default:
      throw Error(
        `Unsupported PINCHTAB_RECORDING_FORMAT=${format}. Use gif, mp4, or webm.`,
      );
  }
};

export const makePinchTabEndpoint = (
  fetch: typeof globalThis.fetch,
  baseUrl: string,
  token: string,
  files: WritableFile,
  {
    delay,
    startupAttempts = 30,
  }: {
    delay: (milliseconds: number) => Promise<unknown>;
    startupAttempts?: number;
  },
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
    const debugPort = instance.debugPort || Number(port) + 1;
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
      async snapshot(tabId?: string) {
        const prefix = tabId ? `/tabs/${tabId}` : "";
        return instanceJson(`${prefix}/snapshot?filter=interactive`, undefined);
      },
      async action(action: JsonRecord, tabId?: string) {
        const prefix = tabId ? `/tabs/${tabId}` : "";
        return instanceJson(`${prefix}/action`, {
          method: "POST",
          body: JSON.stringify(action),
        });
      },
      async targets() {
        // Pattern: Extension Target Bridge. PinchTab omits extension popups
        // from /tabs, so use its instance's adjacent Chromium debug port.
        const url = `http://127.0.0.1:${debugPort}/json/list`;
        const response = await fetch(url);
        if (!response.ok) {
          throw Error(
            `Chromium debugging API ${url} failed (${response.status}): ${await response.text()}`,
          );
        }
        return response.json();
      },
      recorder: {
        async startGif(tabId: string) {
          if (!tabId) {
            throw Error("PinchTab navigation did not return a recording tab ID.");
          }
          return instanceJson("/record/start", {
            method: "POST",
            body: JSON.stringify({
              format: "gif",
              fps: 5,
              quality: 70,
              scale: 1,
              tabId,
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

  const makeProfile = (profile: JsonRecord) => {
    const startInstance = (allowedDomains: string[]) =>
      status(`/profiles/${profile.id}/start`, {
        method: "POST",
        body: JSON.stringify({
          headless: false,
          securityPolicy: { allowedDomains },
        }),
      });
    const waitForRunning = async (started: JsonRecord) => {
      if (!started.id) {
        throw Error(
          `PinchTab did not return an instance ID:\n${JSON.stringify(started)}`,
        );
      }
      let lastStatus = started.status;
      for (let attempt = 0; attempt < startupAttempts; attempt += 1) {
        const instances = await json("/instances", undefined);
        const current = instances.find(
          (instance: JsonRecord) => instance.id === started.id,
        );
        lastStatus = current?.status;
        if (lastStatus === "running") {
          return makeInstance(current);
        }
        if (lastStatus === "error") {
          throw Error(`PinchTab instance ${started.id} entered status 'error'.`);
        }
        if (attempt + 1 < startupAttempts) await delay(1000);
      }
      throw Error(
        `PinchTab instance ${started.id} did not become running within ${startupAttempts} seconds; last status: ${lastStatus || "not found"}.`,
      );
    };
    const requireStarted = async (start: Awaited<ReturnType<typeof status>>) => {
      if ([200, 201, 202].includes(start.status)) {
        return waitForRunning(JSON.parse(start.body));
      }
      throw Error(
        `PinchTab profile start failed with HTTP ${start.status}:\n${start.body}`,
      );
    };

    return {
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
      async provideInstance(allowedDomains = ["main0.ymax.app"]) {
        const start = await startInstance(allowedDomains);

        if ([200, 201, 202].includes(start.status)) {
          return requireStarted(start);
        }
        if (start.status === 409) {
          return makeInstance(
            await json(`/profiles/${profile.id}/instance`, undefined),
          );
        }

        return requireStarted(start);
      },
      async provideFreshInstance(allowedDomains = ["main0.ymax.app"]) {
        const start = await startInstance(allowedDomains);
        if (start.status !== 409) return requireStarted(start);

        const stopped = await status(`/profiles/${profile.id}/stop`, {
          method: "POST",
          body: "{}",
        });
        if (![200, 202, 204].includes(stopped.status)) {
          throw Error(
            `PinchTab profile stop failed with HTTP ${stopped.status}:\n${stopped.body}`,
          );
        }
        return requireStarted(await startInstance(allowedDomains));
      },
    };
  };

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
          description: "Dedicated funded YMax recording profile",
          useWhen: "Use only for operator-supervised low-value YMax recordings",
        }),
      });
      return makeProfile(created);
    },
  };
};

// Pattern: Inferred Capability Surface. Keep factories authoritative and derive
// concise public types with ReturnType/Awaited instead of duplicating shapes.
export type PinchTabEndpoint = ReturnType<typeof makePinchTabEndpoint>;
export type PinchTabProfile = Awaited<
  ReturnType<PinchTabEndpoint["provideProfile"]>
>;
export type PinchTabInstance = Awaited<
  ReturnType<PinchTabProfile["provideInstance"]>
>;

export const finishRecording = async ({
  recorder,
  recordings,
  delay,
  attempts = 600,
}: {
  recorder: PinchTabInstance["recorder"];
  recordings: ReadableFile;
  delay(milliseconds: number): Promise<unknown>;
  attempts?: number;
}) => {
  await recorder.stop();
  let lastStatus;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastStatus = await recorder.status();
    if (lastStatus.error) {
      throw Error(`PinchTab recording failed:\n${lastStatus.error}`);
    }
    const path = lastStatus.outputPath || lastStatus.path;
    if (lastStatus.state === "finished" && typeof path === "string") {
      const file = joinTailUnder({ toString: () => path }, recordings);
      const stats = await file.stat();
      if (!stats.isFile() || Number(stats.size) <= 0) {
        throw Error(`PinchTab did not write a non-empty recording: ${file}`);
      }
      return file;
    }
    if (attempt + 1 < attempts) await delay(1000);
  }
  throw Error(
    `PinchTab did not finish writing the recording after ${attempts} attempts. Last status:\n${JSON.stringify(lastStatus, null, 2)}`,
  );
};

export type JsonRecord = Record<string, any>;
export const getSnapshotNodes = (snapshot: JsonRecord | JsonRecord[]) =>
  Array.isArray(snapshot) ? snapshot : snapshot.nodes || [];
export const getPinchtabConfig = async (
  env: NodeJS.ProcessEnv,
  files: ReadableFile,
) => {
  const { PINCHTAB_TOKEN, PINCHTAB_CONFIG, XDG_CONFIG_HOME, HOME } = env;
  let token = PINCHTAB_TOKEN;
  if (PINCHTAB_TOKEN) {
    token = PINCHTAB_TOKEN;
  } else {
    const candidates = [];
    if (PINCHTAB_CONFIG) {
      candidates.push(files.join(PINCHTAB_CONFIG));
    }
    const configBase = XDG_CONFIG_HOME || (HOME && `${HOME}/.config`);
    if (configBase) {
      candidates.push(files.join(configBase, "pinchtab", "config.json"));
    }
    if (HOME) {
      candidates.push(files.join(HOME, ".pinchtab", "config.json"));
    }

    for (const configFile of candidates) {
      try {
        const config = await configFile.readJSON();
        token = config?.server?.token;
        if (typeof token === "string" && token) {
          break;
        }
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
          throw error;
        }
      }
    }
  }

  if (typeof token !== "string" || !token) {
    throw Error(
      "Set PINCHTAB_TOKEN or configure server.token in the local PinchTab config.",
    );
  }

  return {
    token,
    serverUrl: env.PINCHTAB_SERVER_URL || "http://127.0.0.1:9867",
    profileName: env.PINCHTAB_YMAX_PROFILE || "ymax-flow1",
    artifactDir: env.PINCHTAB_ARTIFACT_DIR || "artifacts",
    recordingFormat: getRecordingFormat(env.PINCHTAB_RECORDING_FORMAT),
    ffmpeg: env.PINCHTAB_FFMPEG_BIN || "ffmpeg",
  };
};
