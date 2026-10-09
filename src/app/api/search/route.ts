import { NextResponse } from "next/server";
import { searchCompanies } from "@/lib/data/provider";
import { SecHttpError } from "@/lib/sec/client";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length > 64) return NextResponse.json({ error: "Query too long." }, { status: 400 });
  try {
    return NextResponse.json({ results: await searchCompanies(q) });
  } catch (err) {
    const diagnosis = err instanceof SecHttpError ? err.diagnosis : undefined;
    return NextResponse.json({ error: "Search is temporarily unavailable.", diagnosis }, { status: 502 });
  }
}
