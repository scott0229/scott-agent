import { D1Database, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    DB_SCOTT: D1Database;
    R2: R2Bucket;
  }
}

export { };
