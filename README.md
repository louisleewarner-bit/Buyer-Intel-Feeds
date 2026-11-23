# Buyer Intel Feeds connector

Remote MCP server used by Public Ledg3r. Tools: `feeds_fetch {url, chunk}` and `feeds_status {}`.
Only Find a Tender, Contracts Finder and Planning Data URLs are fetched.

Run: `npm install && FEEDS_TOKEN=<secret> npm start` (port 8787, endpoint `/mcp`, health `/healthz`).
Host it at a public HTTPS address (Render, Fly, Railway, Vercel Functions, a tunnel), then in claude.ai:
Settings > Connectors > Add custom connector, named exactly `Buyer Intel Feeds`, URL `https://<host>/mcp?token=<secret>`.
