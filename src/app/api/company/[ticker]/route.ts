import { NextResponse } from "next/server";
import { getCompanyDataset } from "@/lib/data/provider";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const result = await getCompanyDataset(ticker);
  if (!result.ok) return NextResponse.json({ error: result.error, diagnosis: result.diagnosis }, { status: result.status });
  return NextResponse.json(result.dataset, { headers: { "Cache-Control": "private, max-age=300" } });
}
