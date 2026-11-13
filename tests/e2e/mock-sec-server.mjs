/**
 * Local stand-in for SEC EDGAR used ONLY by end-to-end tests. Serves the test fixtures
 * (tests/fixtures/sec) at the same paths as www.sec.gov / data.sec.gov, and, like SEC,
 * refuses requests without a User-Agent that includes a contact email.
 * The app reaches it through SEC_BASE_URL_OVERRIDE, which only accepts localhost.
 */
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/sec");
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
const byCik = new Map(fixtures.map((f) => [String(f.companyfacts.cik).padStart(10, "0"), f]));
const tickers = Object.fromEntries(fixtures.map((f, i) => [String(i), { cik_str: f.companyfacts.cik, ticker: f.ticker, title: f.profile.name }]));

const port = Number(process.env.MOCK_SEC_PORT ?? 3199);
createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!/@/.test(req.headers["user-agent"] ?? "")) return send(403, { error: "Undeclared automated tool" });
  const url = req.url ?? "";
  if (url === "/files/company_tickers.json") return send(200, tickers);
  const m = /^\/(submissions|api\/xbrl\/companyfacts)\/CIK(\d{10})\.json$/.exec(url);
  const f = m && byCik.get(m[2]);
  if (!f) return send(404, { error: "not found" });
  return send(200, m[1] === "submissions" ? f.profile : f.companyfacts);
}).listen(port, () => console.log(`mock SEC listening on ${port}`));
