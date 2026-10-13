// Exits 0 when this copy has been set up, 1 when it has not.
import { hasConfig, resolveDataDir } from "../server/core/config.ts";
import { appDir } from "./lib.mjs";

process.exit(hasConfig(resolveDataDir(appDir)) ? 0 : 1);
