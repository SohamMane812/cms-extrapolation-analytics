import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/bigquery/query";

export async function POST(req: NextRequest) {
  try {
    const { sql } = await req.json();

    if (!sql || typeof sql !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid sql parameter" },
        { status: 400 }
      );
    }

    const rows = await runQuery(sql);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("BigQuery API error:", error);
    return NextResponse.json(
      { error: "Query failed", details: String(error) },
      { status: 500 }
    );
  }
}
