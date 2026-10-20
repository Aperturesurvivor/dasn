// Explicit release operation. This script never purchases or upgrades a plan.
// Run `plan` first; `deploy --confirm-free-plan` is an authorized external action.
import { seed } from "../src/seed.mjs";
import { hash } from "../src/store.mjs";
const action = Deno.args[0] ?? "plan", scriptName = "dasn-friends", databaseName = "dasn-friends";
const instructions = {
  worker: scriptName,
  database: databaseName,
  plan: "Workers Free only",
  modules: ["entry.mjs", "assets.mjs", "store.mjs", "tools.mjs", "workspace.mjs", "worker.mjs"],
  external_actions: [
    "Create the dedicated D1 database if absent",
    "Apply the reviewed schema and seed only an empty database",
    "Upload the reviewed Worker modules",
    "Enable its workers.dev URL",
  ],
  never: [
    "Change billing plans",
    "Upload local development data",
    "Publish a GitHub repository",
    "Send invitations to anyone",
  ],
};
if (action === "plan") {
  console.log(JSON.stringify(instructions, null, 2));
  Deno.exit(0);
}
if (action !== "deploy" || !Deno.args.includes("--confirm-free-plan")) {
  throw new Error(
    "Use plan, or deploy --confirm-free-plan after checking Workers Free and authorizing the exact release.",
  );
}
const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID"), token = Deno.env.get("CLOUDFLARE_API_TOKEN");
if (!account || !/^[a-f0-9]{32}$/.test(account) || !token) {
  throw new Error(
    "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN locally. Never paste credentials into chat.",
  );
}
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(path, method = "GET", body) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + path, {
    method,
    headers,
    body: payload,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(
      `Cloudflare ${method} ${
        path.split("?")[0]
      } failed (HTTP ${response.status}). Check account permissions. No automatic retry was made.`,
    );
  }
  return result.result;
}
const manifest = JSON.parse(await Deno.readTextFile("dist/manifest.json"));
for (const file of instructions.modules) {
  if (await hash(await Deno.readTextFile(`dist/${file}`)) !== manifest.files[file].sha256) {
    throw new Error("Build changed after manifest creation. Rebuild and review before deployment.");
  }
}
// Existing release metadata must match this account to prevent cross-account database reuse.
await Deno.mkdir(".local", { recursive: true, mode: 0o700 });
let prior = null;
try {
  prior = JSON.parse(await Deno.readTextFile(".local/cloudflare-release.json"));
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}
if (prior && prior.account !== account) {
  throw new Error(
    "Release metadata belongs to another account. Stop and choose the correct account.",
  );
}
const existingWorkers = await api("/workers/scripts");
if (!prior && existingWorkers.some((w) => w.id === scriptName)) {
  throw new Error(
    "A Worker with this name already exists outside this release. Refusing to overwrite it.",
  );
}
const subdomain = await api("/workers/subdomain");
if (!subdomain.subdomain) {
  throw new Error("Set up a workers.dev subdomain in the Cloudflare dashboard first.");
}
const databases = await api(`/d1/database?name=${databaseName}`);
let database = databases.find((d) => d.name === databaseName);
if (database && !prior) {
  throw new Error(
    "A database with this name already exists and is not owned by this release record. Stop to review it before adopting.",
  );
}
if (!database) {
  database = await api("/d1/database", "POST", { name: databaseName });
  await Deno.writeTextFile(
    ".local/cloudflare-release.json",
    JSON.stringify(
      { account, database: database.uuid, script: scriptName, stage: "database_created" },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
if (prior && database.uuid !== prior.database) {
  throw new Error("Database identity changed. Refusing to continue.");
}
const query = async (sql, params = []) => {
  const results = await api(`/d1/database/${database.uuid}/query`, "POST", { sql, params });
  if (results.some((r) => !r.success)) {
    throw new Error("D1 rejected a query. Stop and inspect the release record.");
  }
  return results;
};
await query(await Deno.readTextFile("migrations/0001.sql"));
await query(await Deno.readTextFile("migrations/0002.sql"));
await query(await Deno.readTextFile("migrations/0003.sql"));
await query(await Deno.readTextFile("migrations/0004.sql"));
const make = (sql) => {
  const bound = (params) => ({
    bind: (...a) => bound(a),
    first: async () => ((await query(sql, params))[0].results[0] ?? null),
    _sql: sql,
    _params: params,
  });
  return bound([]);
};
const db = {
  prepare: make,
  async batch(statements) {
    const result = await api(
      `/d1/database/${database.uuid}/query`,
      "POST",
      { batch: statements.map((s) => ({ sql: s._sql, params: s._params })) },
    );
    if (result.some((r) => !r.success)) throw new Error("D1 seed failed.");
    return result;
  },
};
// Persist the owner invitation locally before creating it remotely, so a lost HTTP response is recoverable.
const bootstrapPath = ".local/cloudflare-owner-invitation.txt";
const ownerCode = await seed(
  db,
  Date.now(),
  (code) => Deno.writeTextFile(bootstrapPath, code + "\n", { mode: 0o600 }),
);
const form = new FormData();
form.set(
  "metadata",
  new Blob([
    JSON.stringify({
      main_module: "entry.mjs",
      compatibility_date: "2026-09-09",
      bindings: [{ type: "d1", name: "DB", id: database.uuid }],
      observability: { enabled: false },
    }),
  ], { type: "application/json" }),
);
for (const file of instructions.modules) {
  form.set(
    file,
    new Blob([await Deno.readTextFile(`dist/${file}`)], { type: "application/javascript+module" }),
    file,
  );
}
await api(`/workers/scripts/${scriptName}`, "PUT", form);
await api(`/workers/scripts/${scriptName}/subdomain`, "POST", {
  enabled: true,
  previews_enabled: false,
});
const url = `https://${scriptName}.${subdomain.subdomain}.workers.dev`;
await Deno.writeTextFile(
  ".local/cloudflare-release.json",
  JSON.stringify(
    { account, database: database.uuid, script: scriptName, url, stage: "deployed", manifest },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `Deployed ${url}. Verify health, MCP, and joining from a second device before sharing. ${
    ownerCode ? "Owner invitation saved privately in " + bootstrapPath + "." : ""
  }`,
);
