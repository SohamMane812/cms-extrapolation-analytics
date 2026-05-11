import { BigQuery } from "@google-cloud/bigquery";
import path from "path";

function createBigQueryClient() {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const location = process.env.BIGQUERY_LOCATION ?? "US";

  // Vercel: credentials passed as JSON string in env var
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new BigQuery({ projectId, location, credentials });
  }

  // Local: credentials from key file path
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const keyFilename = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    return new BigQuery({ projectId, location, keyFilename });
  }

  // Fallback: ADC
  return new BigQuery({ projectId, location });
}

const bigquery = createBigQueryClient();
export default bigquery;
