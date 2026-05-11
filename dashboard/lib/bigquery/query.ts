import bigquery from "./client";

export async function runQuery<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const [rows] = await bigquery.query({
    query: sql,
    location: process.env.BIGQUERY_LOCATION || "us-central1",
  });
  return rows as T[];
}
