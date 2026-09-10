import { SqliteD1 } from "./sqlite.mjs";
import { seed } from "./seed.mjs";
import { handle } from "./worker.mjs";

await Deno.mkdir(".local", { recursive: true, mode: 0o700 });
const db = new SqliteD1(".local/dasn.sqlite");
db.sql.exec(await Deno.readTextFile(new URL("../migrations/0001.sql", import.meta.url)));
db.sql.exec(await Deno.readTextFile(new URL("../migrations/0002.sql", import.meta.url)));
db.sql.exec(await Deno.readTextFile(new URL("../migrations/0003.sql", import.meta.url)));
const bootstrap = await seed(db);
if (bootstrap) {
  await Deno.writeTextFile(".local/owner-invitation.txt", bootstrap + "\n", { mode: 0o600 });
}
const port = Number(Deno.env.get("DASN_PORT") ?? 8787);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};
const assets = {
  async fetch(request) {
    const url = new URL(request.url), route = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!/^\/[a-zA-Z0-9._/-]+$/.test(route) || route.includes("..")) {
      return new Response(
        "Not found",
        { status: 404 },
      );
    }
    try {
      const bytes = await Deno.readFile(new URL("../public" + route, import.meta.url));
      return new Response(bytes, {
        headers: {
          "Content-Type": types[route.slice(route.lastIndexOf("."))] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};
const server = Deno.serve(
  { hostname: "127.0.0.1", port },
  (request) => handle(request, { DB: db, ASSETS: assets }),
);
console.log(
  `DASN is host-only at http://127.0.0.1:${port}. Owner invitation is in .local/owner-invitation.txt; keep it private.`,
);
await server.finished;
