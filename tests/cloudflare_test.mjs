import assert from "node:assert/strict";
import { SqliteD1 } from "../src/sqlite.mjs";
import { hash } from "../src/store.mjs";

// Exercise the actual release entry point against the documented REST contract.
// No account credentials, external requests, or local release files are used.
async function releaseFixture(existingWorker = false) {
  const database = new SqliteD1(":memory:");
  const files = new Map(), calls = [];
  const fixtureManifest = { files: {} };
  for (const module of ["entry.mjs", "assets.mjs", "store.mjs", "tools.mjs", "worker.mjs"]) {
    const content = `// ${module}\nexport default {};\n`;
    files.set(`dist/${module}`, content);
    fixtureManifest.files[module] = { sha256: await hash(content) };
  }
  files.set("dist/manifest.json", JSON.stringify(fixtureManifest));
  const original = {
    fetch: globalThis.fetch,
    get: Deno.env.get,
    mkdir: Deno.mkdir,
    read: Deno.readTextFile,
    write: Deno.writeTextFile,
    args: [...Deno.args],
    log: console.log,
  };
  Deno.args.splice(0, Deno.args.length, "deploy", "--confirm-free-plan");
  Deno.env.get = (key) => key === "CLOUDFLARE_ACCOUNT_ID" ? "a".repeat(32) : "test-token";
  Deno.mkdir = () => Promise.resolve();
  Deno.readTextFile = (file) => {
    if (files.has(file)) return Promise.resolve(files.get(file));
    if (String(file).startsWith(".local/")) {
      return Promise.reject(new Deno.errors.NotFound());
    }
    return original.read(file);
  };
  Deno.writeTextFile = (file, content, options) => {
    assert.ok(file.startsWith(".local/"));
    assert.equal(options.mode, 0o600);
    files.set(file, content);
    return Promise.resolve();
  };
  console.log = () => {};
  globalThis.fetch = async (url, options) => {
    assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}`));
    const route = new URL(url).pathname.split("/accounts/" + "a".repeat(32))[1];
    calls.push({ route, method: options.method });
    let result;
    if (route === "/workers/scripts") result = existingWorker ? [{ id: "dasn-friends" }] : [];
    else if (route === "/workers/subdomain") result = { subdomain: "fixture" };
    else if (route === "/d1/database") {
      result = options.method === "GET" ? [] : { uuid: "fixture-db", name: "dasn-friends" };
    } else if (route === "/d1/database/fixture-db/query") {
      const body = JSON.parse(options.body);
      assert.ok(!Array.isArray(body), "D1 REST expects an object, not a raw query array");
      if (body.batch) {
        assert.ok(
          files.has(".local/cloudflare-owner-invitation.txt"),
          "Save bootstrap before seeding",
        );
        result = await database.batch(
          body.batch.map((s) => database.prepare(s.sql).bind(...s.params)),
        );
      } else if (body.sql.startsWith("PRAGMA")) {
        database.sql.exec(body.sql);
        result = [{ success: true, results: [] }];
      } else {
        result = [await database.prepare(body.sql).bind(...body.params).all()];
      }
    } else if (route === "/workers/scripts/dasn-friends") {
      assert.ok(options.body instanceof FormData);
      const metadata = JSON.parse(await options.body.get("metadata").text());
      assert.equal(metadata.bindings[0].id, "fixture-db");
      assert.equal(metadata.main_module, "entry.mjs");
      assert.equal([...options.body.keys()].length, 6);
      result = {};
    } else if (route === "/workers/scripts/dasn-friends/subdomain") {
      assert.deepEqual(JSON.parse(options.body), { enabled: true, previews_enabled: false });
      result = {};
    } else throw new Error("Unexpected Cloudflare route");
    return Response.json({ success: true, result });
  };
  try {
    await import(`../scripts/cloudflare.mjs?test=${crypto.randomUUID()}`);
    assert.equal((await database.prepare("SELECT count(*) AS n FROM work").first()).n, 3);
    assert.equal((await database.prepare("SELECT count(*) AS n FROM invites").first()).n, 1);
    const record = JSON.parse(files.get(".local/cloudflare-release.json"));
    assert.equal(record.stage, "deployed");
    assert.equal(record.url, "https://dasn-friends.fixture.workers.dev");
    assert.ok(calls.some((c) => c.route === "/workers/scripts/dasn-friends" && c.method === "PUT"));
  } finally {
    globalThis.fetch = original.fetch;
    Deno.env.get = original.get;
    Deno.mkdir = original.mkdir;
    Deno.readTextFile = original.read;
    Deno.writeTextFile = original.write;
    Deno.args.splice(0, Deno.args.length, ...original.args);
    console.log = original.log;
    database.close();
  }
}

Deno.test("Cloudflare release seeds via the REST batch envelope and uploads declared modules", async () => {
  await releaseFixture();
});

Deno.test("Cloudflare release refuses to overwrite an unrelated existing Worker", async () => {
  await assert.rejects(() => releaseFixture(true), /Refusing to overwrite/);
});
