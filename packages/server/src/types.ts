import type { Config } from "./config.js";
import type { DB } from "./db.js";

export type Ctx = {
  config: Config;
  db: DB;
  adminHash: Buffer;
};
