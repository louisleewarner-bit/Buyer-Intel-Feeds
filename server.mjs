// Buyer Intel Feeds: a small remote MCP server for Public Ledg3r.
// Tools: feeds_fetch {url, chunk} and feeds_status {}.
// A feed page is fetched on chunk 0, gzipped, base64'd, held for a few minutes and served in slices.
import express from "express";
import { gzipSync } from "node:zlib";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.FEEDS_TOKEN || "";          // optional: require ?token=... or Bearer
const SLICE = 400_000;                                  // base64 characters per slice
const HOLD_MS = 5 * 60_000;
const ALLOWED = new Set(["www.find-tender.service.gov.uk", "www.contractsfinder.service.gov.uk", "www.planning.data.gov.uk", "planning.data.gov.uk"]);
const store = new Map();                                // url -> {parts, at}
const started = Date.now();
let fetched = 0;

function checkUrl(u) {
  let x; try { x = new URL(u); } catch { throw new Error("site_error: not a valid URL"); }
  if (x.protocol !== "https:" || !ALLOWED.has(x.hostname)) throw new Error("site_error: host not allowed: " + x.hostname);
  return x.href;
}
const sweep = () => { const t = Date.now(); for (const [k, v] of store) if (t - v.at > HOLD_MS) store.delete(k); };
const ok = obj => ({ structuredContent: obj, content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = msg => ({ isError: true, content: [{ type: "text", text: msg }] });

function build() {
  const s = new McpServer({ name: "Buyer Intel Feeds", version: "2.0.0" });
  s.registerTool("feeds_status", { description: "Health check for the connector.", inputSchema: {} }, async () =>
    ok({ ok: true, version: "2.0.0", uptimeSeconds: Math.round((Date.now() - started) / 1000), fetched, hosts: [...ALLOWED] }));
  s.registerTool("feeds_fetch", {
    description: "Fetch one public feed page. Chunk 0 fetches it afresh; later chunks read the rest from the held copy. Returns {data, encoding:'gzip+base64', chunks}.",
    inputSchema: { url: z.string(), chunk: z.number().int().min(0).default(0) },
  }, async ({ url, chunk }) => {
    sweep();
    let href; try { href = checkUrl(url); } catch (e) { return fail(e.message); }
    if (chunk === 0) {
      let res;
      try { res = await fetch(href, { headers: { accept: "application/json", "user-agent": "BuyerIntelFeeds/2.0" }, signal: AbortSignal.timeout(90_000) }); }
      catch (e) { return fail((e.name === "TimeoutError" ? "timeout: " : "network: ") + (e.message || e)); }
      if (res.status === 429) return fail("rate_limited: the site asked us to wait");
      if (!res.ok && res.status >= 500) return fail("site_error: HTTP " + res.status);
      const body = Buffer.from(await res.arrayBuffer());
      const b64 = gzipSync(body).toString("base64");
      const parts = []; for (let i = 0; i < b64.length; i += SLICE) parts.push(b64.slice(i, i + SLICE));
      if (!parts.length) parts.push("");
      store.set(href, { parts, at: Date.now() }); fetched++;
    }
    const held = store.get(href);
    if (!held) return fail("expired: this page is no longer held, fetch it again");
    if (chunk >= held.parts.length) return fail("expired: no such slice");
    return ok({ data: held.parts[chunk], encoding: "gzip+base64", chunks: held.parts.length, chunk });
  });
  return s;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.get("/healthz", (_q, r) => r.type("text").send("ok"));
app.post("/mcp", async (req, res) => {
  if (TOKEN) {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.query.token;
    if (got !== TOKEN) return res.status(401).json({ error: "unauthorised" });
  }
  const server = build(), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_q, r) => r.status(405).json({ error: "POST only" }));
app.listen(PORT, () => console.log("Buyer Intel Feeds listening on :" + PORT));
