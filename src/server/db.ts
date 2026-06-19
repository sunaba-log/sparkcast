import "server-only";

import {
  Connector,
  GoogleAuth,
  IpAddressTypes,
} from "@google-cloud/cloud-sql-connector";
import { Pool } from "pg";
import {
  getCloudSqlConnectionName,
  getDatabaseName,
  getDatabasePassword,
  getDatabaseUrl,
  getDatabaseUser,
  getGoogleCloudProject,
  getGoogleServiceAccountCredentials,
} from "@/server/env";

declare global {
  var podcastDbPoolPromise: Promise<Pool> | undefined;
  var podcastCloudSqlConnector: Connector | undefined;
}

async function createPool(): Promise<Pool> {
  const connectionName = getCloudSqlConnectionName();
  if (!connectionName) {
    const databaseUrl = getDatabaseUrl();
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL or CLOUD_SQL_INSTANCE_CONNECTION_NAME is required",
      );
    }
    return new Pool({ connectionString: databaseUrl, max: 10 });
  }

  const credentials = getGoogleServiceAccountCredentials();
  const auth = credentials
    ? new GoogleAuth({
        projectId: getGoogleCloudProject(),
        credentials,
      })
    : undefined;
  const connector = new Connector(auth ? { auth } : undefined);
  globalThis.podcastCloudSqlConnector = connector;
  const connectorOptions = await connector.getOptions({
    instanceConnectionName: connectionName,
    ipType: IpAddressTypes.PUBLIC,
  });
  return new Pool({
    ...connectorOptions,
    user: getDatabaseUser(),
    password: getDatabasePassword(),
    database: getDatabaseName(),
    max: 10,
  });
}

export async function getDbPool(): Promise<Pool> {
  globalThis.podcastDbPoolPromise ??= createPool();
  return globalThis.podcastDbPoolPromise;
}
