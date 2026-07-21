import type { ReadableFile } from "./pola-io.ts";

const { freeze } = Object;

export type FsPower = Pick<
  typeof import("node:fs/promises"),
  "mkdir" | "readFile" | "stat" | "writeFile"
>;
export type PathPower = Pick<typeof import("node:path"), "basename" | "join">;

export const hasErrorCode = (error: unknown, code: string) =>
  error && typeof error === "object" && "code" in error && error.code === code;

export const makeFileRd = (
  root: string,
  powers: { fsp: FsPower; path: PathPower },
) => {
  const { fsp, path } = powers;
  const make = (there: string) =>
    freeze({
      toString: () => there,
      basename: () => path.basename(there),
      join: (...segments: string[]) => make(path.join(there, ...segments)),
      stat: () => fsp.stat(there),
      readText: () => fsp.readFile(there, "utf8"),
      readJSON: () => fsp.readFile(there, "utf8").then(JSON.parse),
      withExtension: (extension: string) =>
        make(there.replace(/\.[^.]*$/, `.${extension}`)),
    });
  return make(root);
};

export type ReadableFile = ReturnType<typeof makeFileRd>;

export const makeFileRW = (
  root: string,
  powers: { fsp: FsPower; path: PathPower },
) => {
  const { fsp, path } = powers;
  const make = (there: string) => {
    const rd = makeFileRd(there, { fsp, path });
    return freeze({
      ...rd,
      readOnly: () => rd,
      basename: () => path.basename(there),
      join: (...segments: string[]) => make(path.join(there, ...segments)),
      writeText: (text: string) => fsp.writeFile(there, text, "utf8"),
      mkdir: () => fsp.mkdir(there, { recursive: true }),
      withExtension: (extension: string) =>
        make(there.replace(/\.[^.]*$/, `.${extension}`)),
    });
  };
  return make(root);
};

export type WritableFile = ReturnType<typeof makeFileRW>;

export const makeCommand =
  (
    execFile: (
      file: string,
      args: readonly string[],
    ) => Promise<{ stdout: string; stderr: string }>,
    file: string,
  ) =>
  (args: readonly string[]) =>
    execFile(file, args);
export const joinTailUnder = (
  file: { toString(): string },
  directory: ReadableFile,
) => {
  const directoryPath = directory.toString().replace(/\/+$/, "");
  const filePath = file.toString();
  const prefix = `${directoryPath}/`;
  if (filePath !== directoryPath && !filePath.startsWith(prefix)) {
    throw Error(
      `PinchTab returned a recording outside the expected directory: ${filePath}`,
    );
  }
  const tail = filePath.slice(prefix.length);
  if (tail.split("/").includes("..")) {
    throw Error(`PinchTab returned an unsafe recording path: ${filePath}`);
  }
  return tail ? directory.join(tail) : directory;
};
