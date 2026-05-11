import { BigQuery } from "@google-cloud/bigquery";
import path from "path";

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : undefined;

const bigquery = new BigQuery({
  projectId: process.env.BIGQUERY_PROJECT_ID,
  keyFilename: credentials,
  location: process.env.BIGQUERY_LOCATION || "us-central1",
});

export default bigquery;
