import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireStateLock, loadWatchState, saveWatchState, type WatchState } from "../src/state.js";

let temporary: string | null = null;
const originalStateDir = process.env.SUWAPPU_PERPS_STATE_DIR;

afterEach(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
  temporary = null;
  if (originalStateDir === undefined) delete process.env.SUWAPPU_PERPS_STATE_DIR;
  else process.env.SUWAPPU_PERPS_STATE_DIR = originalStateDir;
});

function stateDir(): string {
  temporary = mkdtempSync(join(tmpdir(), "suwappu-perps-test-"));
  const path = join(temporary, "state");
  process.env.SUWAPPU_PERPS_STATE_DIR = path;
  return path;
}

describe("watch state persistence", () => {
  it("writes private state atomically and reloads it", () => {
    const directory = stateDir();
    const state: WatchState = { version: 1, watches: {} };
    saveWatchState(state);
    expect(loadWatchState()).toEqual(state);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, "watch-state.json")).mode & 0o777).toBe(0o600);
  });

  it("fails closed on corrupt state", () => {
    const directory = stateDir();
    saveWatchState({ version: 1, watches: {} });
    writeFileSync(join(directory, "watch-state.json"), "not-json\n", "utf8");
    expect(() => loadWatchState()).toThrow("invalid JSON");
  });

  it("refuses a symlinked state file", () => {
    const directory = stateDir();
    saveWatchState({ version: 1, watches: {} });
    const target = join(temporary!, "outside.json");
    writeFileSync(target, '{"version":1,"watches":{}}\n', "utf8");
    rmSync(join(directory, "watch-state.json"));
    symlinkSync(target, join(directory, "watch-state.json"));
    expect(() => loadWatchState()).toThrow("regular file");
  });

  it("refuses a dangling symlinked state file instead of treating it as fresh state", () => {
    const directory = stateDir();
    saveWatchState({ version: 1, watches: {} });
    rmSync(join(directory, "watch-state.json"));
    symlinkSync(join(temporary!, "missing-target.json"), join(directory, "watch-state.json"));
    expect(() => loadWatchState()).toThrow("regular file");
  });

  it("does not steal an existing lock and releases only its own lock", () => {
    const directory = stateDir();
    const first = acquireStateLock();
    expect(() => acquireStateLock()).toThrow("Another perps watch process owns");
    expect(readFileSync(join(directory, "watch.lock"), "utf8").trim()).not.toBe("");
    first.release();
    const second = acquireStateLock();
    second.release();
  });

  it("does not release a replacement lock even if its contents copy the owner token", () => {
    const directory = stateDir();
    const lock = acquireStateLock();
    const path = join(directory, "watch.lock");
    const token = readFileSync(path, "utf8");
    rmSync(path);
    writeFileSync(path, token, { encoding: "utf8", mode: 0o600 });
    lock.release();
    expect(existsSync(path)).toBe(true);
  });
});
