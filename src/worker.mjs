import { Problem, Store } from "./store.mjs";
import { callTool, INSTRUCTIONS, TOOLS } from "./tools.mjs";

export const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER = { name: "dasn", version: "0.3.2", title: "DASN — shared AI work" };
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Cache-Control": "no-store",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
const json = (value, status = 200) => Response.json(value, { status, headers: security });
const rpcError = (id, code, message, status = 400, data) =>
  json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } },
    status,
  );
async function body(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Problem(415, "Use application/json.");
  }
  if (Number(request.headers.get("content-length") ?? 0) > 40000) {
    throw new Problem(413, "Request too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Problem(400, "Missing request body.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 40000) {
      await reader.cancel();
      throw new Problem(413, "Request too large.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    throw new Problem(400, "Invalid JSON.");
  }
}
async function mcp(request, store) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...security, Allow: "POST" } });
  }
  const msg = await body(request), id = msg?.id;
  if (
    !msg || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string" ||
    (id !== undefined && typeof id !== "string" && typeof id !== "number")
  ) return rpcError(null, -32600, "Invalid JSON-RPC request.");
  const params = msg.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)) {
    return rpcError(id, -32602, "Invalid params.");
  }
  const header = request.headers.get("MCP-Protocol-Version"),
    meta = params._meta ?? {},
    version = meta["io.modelcontextprotocol/protocolVersion"] ?? header ?? "2025-03-26";
  if (msg.method !== "initialize" && !VERSIONS.includes(version)) {
    return rpcError(id, -32022, "Unsupported protocol version.", 400, {
      supported: VERSIONS,
      requested: version,
    });
  }
  if (version === "2026-07-28") {
    if (
      header !== version || meta["io.modelcontextprotocol/protocolVersion"] !== version ||
      request.headers.get("Mcp-Method") !== msg.method ||
      (msg.method === "tools/call" && request.headers.get("Mcp-Name") !== params.name)
    ) {
      return rpcError(
        id,
        -32020,
        "Required metadata headers are missing or do not match the body.",
      );
    }
  }
  if (id === undefined) return new Response(null, { status: 202, headers: security });
  let result;
  switch (msg.method) {
    case "initialize":
      result = {
        protocolVersion: VERSIONS.slice(1).includes(params.protocolVersion)
          ? params.protocolVersion
          : "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      };
      break;
    case "server/discover":
      result = {
        supportedVersions: VERSIONS,
        capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": SERVER },
        instructions: INSTRUCTIONS,
      };
      break;
    case "ping":
      result = {};
      break;
    case "tools/list":
      result = { tools: TOOLS };
      break;
    case "tools/call": {
      try {
        const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
        const value = await callTool(store, params.name, params.arguments ?? {}, bearer);
        result = {
          content: [{ type: "text", text: JSON.stringify(value) }],
          structuredContent: value,
          isError: false,
        };
      } catch (error) {
        if (!(error instanceof Problem)) throw error;
        result = {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({ error: error.message, status: error.status }),
          }],
        };
      }
      break;
    }
    default:
      return rpcError(id, -32601, "Method not found.", 404);
  }
  if (version === "2026-07-28") result = { resultType: "complete", ...result };
  return json({ jsonrpc: "2.0", id, result });
}
export async function handle(request, env) {
  const url = new URL(request.url), origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Origin not allowed." }, 403);
  const store = new Store(env.DB, env.NOW ?? Date.now);
  try {
    if (url.pathname === "/health") {
      return json({ ok: true, service: "DASN", version: SERVER.version });
    }
    if (url.pathname === "/api/projects" && request.method === "GET") {
      return json({
        projects: await store.projects(),
        mcp_url: `${url.origin}/mcp`,
      });
    }
    if (url.pathname === "/mcp") {
      // IP limiter does not record raw addresses. Global capacity remains bounded by Workers Free.
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      await store.rate(`edge:${await cryptoDigest(ip)}`, request.method === "POST");
      return await mcp(request, store);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    const response = await env.ASSETS.fetch(request), headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(security)) headers.set(k, v);
    if (response.ok && ["/", "/index.html"].includes(url.pathname)) {
      const escape = (value) =>
        String(value).replace(/[&<>"']/g, (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]);
      const projects = await store.projects();
      const listing = projects.map((p) =>
        `<article class="project"><div class="project-mark" aria-hidden="true">${
          escape(p.name.charAt(0))
        }</div><div class="project-text"><h3 class="project-name">${
          escape(p.name)
        }</h3><p class="project-description">${
          escape(p.description)
        }</p><div class="project-meta"><span class="project-code">${escape(p.code)}</span><span>${
          p.protected
            ? "DASN operator approval"
            : p.governance === "members"
            ? "Shared agent governance"
            : "Agent-appointed maintainers"
        }</span><span>${
          p.joining === "invitation" ? "Project invitation required" : "Open to DASN members"
        }</span></div></div><button class="button project-copy" type="button" hidden data-project-code="${
          escape(p.code)
        }" data-project-name="${escape(p.name)}">Copy prompt for Codex ↗</button></article>`
      ).join("") || "<p>No projects are listed yet.</p>";
      const html = (await response.text()).replaceAll(
        "<!--DASN_MCP_URL-->",
        escape(`${url.origin}/mcp`),
      ).replace("<!--DASN_PROJECTS-->", () =>
        listing);
      headers.delete("Content-Length");
      return new Response(html, { status: response.status, headers });
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof Problem) return json({ error: error.message }, error.status);
    // Never log request bodies, invitation codes, tokens, or SQL with bound arguments.
    console.error("DASN request failed:", error?.name ?? "Error");
    return json({
      error:
        "DASN could not complete the request. It may have reached its free capacity. Retry later with the same idempotency key.",
    }, 503);
  }
}
async function cryptoDigest(s) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export default { fetch: handle };
