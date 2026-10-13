import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  CONFIG_FILE,
  readConfig,
  resolveDataDir,
  writeConfig,
  type SiteConfig,
} from "./core/config.ts";
import { openDatabase, type Db } from "./core/db.ts";

// Process-wide singletons. They hang off globalThis so that Next's dev-mode
// module reloading reuses the open database instead of opening it again on
// every edit.
type Runtime = {
  dataDir: string;
  db: Db;
  config: SiteConfig;
  configMtime: number;
  events: EventEmitter;
};

const globalRef = globalThis as unknown as { __nopostnow?: Runtime };

function boot(): Runtime {
  const dataDir = resolveDataDir();
  const events = new EventEmitter();
  events.setMaxListeners(0);
  return {
    dataDir,
    db: openDatabase(dataDir),
    config: readConfig(dataDir),
    configMtime: 0,
    events,
  };
}

function runtime(): Runtime {
  return (globalRef.__nopostnow ??= boot());
}

export function db(): Db {
  return runtime().db;
}

export function dataDir(): string {
  return runtime().dataDir;
}

export function filesDir(): string {
  return path.join(runtime().dataDir, "files");
}

// Re-read the config when the file changes on disk, so re-running the setup
// wizard or editing the file by hand takes effect without a restart.
export function config(): SiteConfig {
  const rt = runtime();
  try {
    const mtime = fs.statSync(path.join(rt.dataDir, CONFIG_FILE)).mtimeMs;
    if (mtime !== rt.configMtime) {
      rt.config = readConfig(rt.dataDir);
      rt.configMtime = mtime;
    }
  } catch {
    // No file yet: keep the defaults.
  }
  return rt.config;
}

export function saveConfig(next: SiteConfig) {
  const rt = runtime();
  writeConfig(rt.dataDir, next);
  rt.config = readConfig(rt.dataDir);
  rt.configMtime = 0;
}

// Change feed: every document write announces its collection path here, and
// the /api/store/events stream relays it to browsers that are listening.
export function events(): EventEmitter {
  return runtime().events;
}
