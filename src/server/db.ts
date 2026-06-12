import "server-only";

import { Pool } from "pg";
import { getDatabaseUrl } from "@/server/env";

declare global {
  var podcastDbPool: Pool | undefined;
}

export function getDbPool(): Pool {
  if (!globalThis.podcastDbPool) {
    globalThis.podcastDbPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 10,
    });
  }
  return globalThis.podcastDbPool;
}

