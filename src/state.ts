import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export interface WatchStateEntry {
  active: boolean;
  missing: boolean;
  address: string;
  market: string;
  side: "long" | "short";
  warnWithinPct: number;
  recoverAbovePct: number;
  lastObservedAt: string;
  lastTransitionAt: string | null;
  missingSince: string | null;
}

export interface WatchState {
  version: 1;
  watches: Record<string, WatchStateEntry>;
}

function stateDirectory(): string {
  const raw = process.env.SUWAPPU_PERPS_STATE_DIR ?? ".suwappu-perps";
  if (!raw.trim()) throw new Error("SUWAPPU_PERPS_STATE_DIR must not be empty");
  return resolve(raw);
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Perps state path must be a real directory, not a symlink: ${path}`);
  }
  chmodSync(path, 0o700);
}

function statePath(): string {
  return resolve(stateDirectory(), "watch-state.json");
}

function lockPath(): string {
  return resolve(stateDirectory(), "watch.lock");
}

function validEntry(value: unknown): value is WatchStateEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.active === "boolean" &&
    typeof row.missing === "boolean" &&
    typeof row.address === "string" &&
    typeof row.market === "string" &&
    (row.side === "long" || row.side === "short") &&
    typeof row.warnWithinPct === "number" && Number.isFinite(row.warnWithinPct) &&
    typeof row.recoverAbovePct === "number" && Number.isFinite(row.recoverAbovePct) &&
    typeof row.lastObservedAt === "string" &&
    (row.lastTransitionAt === null || typeof row.lastTransitionAt === "string") &&
    (row.missingSince === null || typeof row.missingSince === "string")
  );
}

export function loadWatchState(): WatchState {
  const path = statePath();
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, watches: {} };
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Perps watch state must be a regular file, not a symlink: ${path}`);
  }
  chmodSync(path, 0o600);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Perps watch state is unreadable or invalid JSON: ${path}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Perps watch state has an invalid shape: ${path}`);
  }
  const root = value as Record<string, unknown>;
  if (root.version !== 1 || !root.watches || typeof root.watches !== "object" || Array.isArray(root.watches)) {
    throw new Error(`Perps watch state has an unsupported schema: ${path}`);
  }
  for (const entry of Object.values(root.watches as Record<string, unknown>)) {
    if (!validEntry(entry)) throw new Error(`Perps watch state contains an invalid entry: ${path}`);
  }
  return value as WatchState;
}

export function saveWatchState(state: WatchState): void {
  const path = statePath();
  ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    try {
      const directoryFd = openSync(dirname(path), "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } catch {
      // Some filesystems do not permit directory fsync; the file itself is durable.
    }
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export interface StateLock {
  release(): void;
}

interface LockIdentity {
  dev: number;
  ino: number;
}

function unlinkMatchingLock(path: string, identity: LockIdentity, token?: string): void {
  try {
    const current = lstatSync(path);
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    ) {
      return;
    }
    if (token !== undefined && readFileSync(path, "utf8").trim() !== token) return;
    unlinkSync(path);
  } catch {
    // Never delete a lock whose file identity cannot be proven.
  }
}

export function acquireStateLock(): StateLock {
  const directory = stateDirectory();
  ensurePrivateDirectory(directory);
  const path = lockPath();
  const token = `${process.pid}:${randomUUID()}`;
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Another perps watch process owns ${path}; stop it or inspect the lock before retrying`,
      );
    }
    throw error;
  }
  const identity = fstatSync(fd);
  try {
    writeFileSync(fd, `${token}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // The descriptor may already have been closed by a failed close operation.
    }
    // The O_EXCL-created inode is ours even if its token write was partial.
    // Delete only if the path still resolves to that exact inode.
    unlinkMatchingLock(path, identity);
    throw error;
  }

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      unlinkMatchingLock(path, identity, token);
    },
  };
}
