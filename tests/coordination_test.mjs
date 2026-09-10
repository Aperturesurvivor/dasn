import assert from "node:assert/strict";
import { SqliteD1 } from "../src/sqlite.mjs";
import { seed } from "../src/seed.mjs";
import { hash, Store, uid } from "../src/store.mjs";
import { callTool, TOOLS } from "../src/tools.mjs";
import { handle } from "../src/worker.mjs";

const schema = await Deno.readTextFile(new URL("../migrations/0001.sql", import.meta.url));

Deno.test("joining can recover a lost response without creating another membership or reviving a revoked key", async () => {
  const db = new SqliteD1();
  db.sql.exec(schema);
  const store = new Store(db);
  try {
    const code = await seed(db), request = uid();
    const first = await store.join(code, "Recoverable owner", request);
    const again = await store.join(code, "Recoverable owner", request);
    assert.deepEqual(first, again);
    const actor = await store.auth(first.session, "agent");
    await store.revoke(actor, actor.credential_id);
    await rejects(() => store.join(code, "Recoverable owner", request), 410);
  } finally {
    db.close();
  }
});
async function fixture() {
  const db = new SqliteD1();
  db.sql.exec(schema);
  let now = 1800000000000;
  const store = new Store(db, () => now),
    code = await seed(db, now),
    owner = await store.join(code, "Owner");
  const oa = await store.auth(owner.session, "agent");
  async function member(name) {
    const invite = await store.invite(oa);
    const joined = await store.join(invite.token, name);
    return { key: joined.session, actor: await store.auth(joined.session, "agent") };
  }
  const a = await member("Contributor A"), b = await member("Contributor B");
  return {
    db,
    store,
    owner: oa,
    ownerKey: owner.session,
    a,
    b,
    member,
    advance: (ms) => now += ms,
    now: () => now,
    close: () => db.close(),
  };
}
const command = (store, actor, action, args) =>
  store.mutate(actor, action, { idempotency_key: uid(), ...args });
async function claim(f, who = f.a, task_id = "first-contribution", extra = {}) {
  const t = await f.store.task(task_id, who.actor);
  return command(f.store, who.actor, "claim_work", {
    task_id,
    expected_version: t.version,
    ...extra,
  });
}
async function submit(f, who = f.a, id = "first-contribution") {
  const c = await claim(f, who, id);
  return command(f.store, who.actor, "submit_work", {
    task_id: id,
    expected_version: c.version,
    lease_token: c.lease_token,
    summary: "Completed bounded contribution",
    evidence: "Observed expected behavior in a reproducible check.",
  });
}
async function rejects(fn, status) {
  await assert.rejects(fn, (e) => e.status === status);
}
function test(name, fn) {
  Deno.test(name, async () => {
    const f = await fixture();
    try {
      await fn(f);
    } finally {
      f.close();
    }
  });
}

test("single-use invitations are atomic under two simultaneous joins", async (f) => {
  const invite = await f.store.invite(f.owner);
  const results = await Promise.allSettled([
    f.store.join(invite.token, "First"),
    f.store.join(invite.token, "Second"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 410);
  const stored = await f.store.one("SELECT hash FROM invites WHERE id=?", invite.id);
  assert.notEqual(stored.hash, invite.token);
});
test("expired or revoked invitations cannot join", async (f) => {
  const i = await f.store.invite(f.owner);
  f.advance(8 * 86400000);
  await rejects(() => f.store.join(i.token, "Late"), 410);
  const j = await f.store.invite(f.owner);
  await f.store.stmt("UPDATE invites SET revoked=1 WHERE id=?", j.id).run();
  await rejects(() => f.store.join(j.token, "Revoked"), 410);
});
test("only one agent can claim a task, with no extra successful event", async (f) => {
  const results = await Promise.allSettled([claim(f, f.a), claim(f, f.b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const events = await f.store.events();
  assert.equal(events.filter((e) => e.action === "claim_work").length, 1);
});
test("overlapping conflict scopes exclude separate tasks and submitted work", async (f) => {
  await f.store.stmt("UPDATE work SET conflict_scope='onboarding' WHERE id='contributor-guide'")
    .run();
  await submit(f);
  await rejects(() => claim(f, f.b, "contributor-guide"), 409);
});
test("expired leases are visibly ready, reclaimable, and old holders are fenced", async (f) => {
  const c = await claim(f, f.a, "first-contribution", { minutes: 5 });
  f.advance(300001);
  assert.equal((await f.store.task(c.task_id, f.b.actor)).effective_state, "ready");
  const next = await claim(f, f.b);
  assert.notEqual(c.lease_token, next.lease_token);
  await rejects(
    () =>
      command(f.store, f.a.actor, "submit_work", {
        task_id: c.task_id,
        expected_version: c.version,
        lease_token: c.lease_token,
        summary: "Stale result",
        evidence: "Old work",
      }),
    409,
  );
});
test("expired leases cannot be renewed or submitted even before reclamation", async (f) => {
  const c = await claim(f, f.a, "first-contribution", { minutes: 5 });
  f.advance(300001);
  await rejects(
    () =>
      command(f.store, f.a.actor, "renew_lease", {
        task_id: c.task_id,
        expected_version: c.version,
        lease_token: c.lease_token,
      }),
    409,
  );
});
test("claim retries preserve exact lease response and reject key reuse with different payload", async (f) => {
  const args = {
    task_id: "first-contribution",
    expected_version: 1,
    minutes: 10,
    idempotency_key: uid(),
  };
  const one = await f.store.mutate(f.a.actor, "claim_work", args),
    two = await f.store.mutate(f.a.actor, "claim_work", args);
  assert.deepEqual(one, two);
  await rejects(() => f.store.mutate(f.a.actor, "claim_work", { ...args, minutes: 20 }), 409);
  const log = await f.store.one("SELECT count(*) n FROM events WHERE action=?", "claim_work");
  assert.equal(log.n, 1);
});
test("concurrent identical retries commit once and return the same response", async (f) => {
  const args = { task_id: "first-contribution", expected_version: 1, idempotency_key: uid() };
  const results = await Promise.all([
    f.store.mutate(f.a.actor, "claim_work", args),
    f.store.mutate(f.a.actor, "claim_work", args),
  ]);
  assert.deepEqual(results[0], results[1]);
});
test("a non-holder cannot release a lease even with its handle", async (f) => {
  const c = await claim(f);
  await rejects(
    () =>
      command(f.store, f.b.actor, "release_work", {
        task_id: c.task_id,
        expected_version: c.version,
        lease_token: c.lease_token,
      }),
    409,
  );
  assert.equal((await f.store.task(c.task_id, f.a.actor)).claimant, f.a.actor.id);
});
test("renewal changes version and stale release fails", async (f) => {
  const c = await claim(f);
  const renewed = await command(f.store, f.a.actor, "renew_lease", {
    task_id: c.task_id,
    expected_version: c.version,
    lease_token: c.lease_token,
    minutes: 60,
  });
  assert.equal(renewed.version, c.version + 1);
  await rejects(
    () =>
      command(f.store, f.a.actor, "release_work", {
        task_id: c.task_id,
        expected_version: c.version,
        lease_token: c.lease_token,
      }),
    409,
  );
});
test("members cannot grant invitations or approve proposed work", async (f) => {
  await rejects(() => f.store.invite(f.a.actor), 403);
  const p = await command(f.store, f.a.actor, "propose_work", {
    title: "A specific change",
    description: "Narrow implementation",
    criteria: "Observable result",
    kind: "coding",
    conflict_scope: "new-scope",
  });
  await rejects(
    () => command(f.store, f.a.actor, "approve_work", { task_id: p.task_id, expected_version: 1 }),
    403,
  );
  await rejects(() => claim(f, f.b, p.task_id), 409);
  await command(f.store, f.owner, "approve_work", { task_id: p.task_id, expected_version: 1 });
  assert.equal((await f.store.task(p.task_id, f.b.actor)).effective_state, "ready");
});
test("full contribution lifecycle requires independent review and produces immutable receipt", async (f) => {
  const s = await submit(f),
    accept = {
      task_id: s.task_id,
      expected_version: s.version,
      submission_id: s.submission_id,
      statement: "I inspected the result and accept this contribution.",
    };
  await rejects(
    () =>
      command(f.store, f.a.actor, "review_submission", {
        submission_id: s.submission_id,
        verdict: "approve",
        rationale: "My own work",
      }),
    403,
  );
  await rejects(() => command(f.store, f.owner, "accept_submission", accept), 409);
  await command(f.store, f.b.actor, "review_submission", {
    submission_id: s.submission_id,
    verdict: "approve",
    rationale: "Independently reproduced the evidence.",
  });
  await rejects(() => command(f.store, f.a.actor, "accept_submission", accept), 403);
  await command(f.store, f.owner, "accept_submission", accept);
  const receipts = await f.store.receipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].contributor_id, f.a.actor.id);
  assert.equal(receipts[0].accepted_by, f.owner.id);
  await assert.rejects(() => f.store.stmt("UPDATE receipts SET statement=?", "changed").run());
  await assert.rejects(() => f.store.stmt("DELETE FROM receipts").run());
  assert.equal((await f.store.task(s.task_id, f.a.actor)).state, "accepted");
});
test("outstanding change requests block acceptance; revisions do not reuse old approval", async (f) => {
  const s = await submit(f);
  await command(f.store, f.b.actor, "review_submission", {
    submission_id: s.submission_id,
    verdict: "changes_requested",
    rationale: "Missing reproducible evidence.",
  });
  await rejects(
    () =>
      command(f.store, f.owner, "accept_submission", {
        task_id: s.task_id,
        expected_version: s.version,
        submission_id: s.submission_id,
        statement: "Accept",
      }),
    409,
  );
  await command(f.store, f.owner, "request_changes", {
    task_id: s.task_id,
    expected_version: s.version,
    submission_id: s.submission_id,
    statement: "Please supply the missing check.",
  });
  const next = await submit(f);
  assert.notEqual(s.submission_id, next.submission_id);
  await rejects(
    () =>
      command(f.store, f.owner, "accept_submission", {
        task_id: next.task_id,
        expected_version: next.version,
        submission_id: next.submission_id,
        statement: "Accept new",
      }),
    409,
  );
});
test("failed submission transaction rolls back task transition and command", async (f) => {
  const c = await claim(f);
  f.db.sql.exec(
    "CREATE TRIGGER fail_submission BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT,'test failure'); END;",
  );
  const key = uid();
  await assert.rejects(() =>
    command(f.store, f.a.actor, "submit_work", {
      idempotency_key: key,
      task_id: c.task_id,
      expected_version: c.version,
      lease_token: c.lease_token,
      summary: "Result",
      evidence: "Evidence",
    })
  );
  assert.equal((await f.store.task(c.task_id, f.a.actor)).state, "leased");
  assert.equal(await f.store.one("SELECT id FROM commands WHERE key=?", key), null);
});
test("blockers stop work and owner can reopen the task", async (f) => {
  const c = await claim(f);
  const b = await command(f.store, f.a.actor, "report_blocker", {
    task_id: c.task_id,
    expected_version: c.version,
    lease_token: c.lease_token,
    reason: "Need the approved repository URL.",
  });
  assert.equal((await f.store.task(c.task_id, f.a.actor)).effective_state, "blocked");
  await command(f.store, f.owner, "approve_work", {
    task_id: c.task_id,
    expected_version: b.version,
  });
  assert.equal((await f.store.task(c.task_id, f.a.actor)).effective_state, "ready");
});
test("agent keys are hashed, revocable, expired, and owner can disable members", async (f) => {
  assert.equal(await f.store.one("SELECT id FROM credentials WHERE hash=?", f.a.key), null);
  assert.ok(await f.store.one("SELECT id FROM credentials WHERE hash=?", await hash(f.a.key)));
  await f.store.revoke(f.a.actor, f.a.actor.credential_id);
  await rejects(() => f.store.auth(f.a.key, "agent"), 401);
  await callTool(f.store, "disable_member", { member_key: f.ownerKey, principal_id: f.b.actor.id });
  await rejects(() => f.store.auth(f.b.key, "agent"), 401);
  await rejects(
    () => callTool(f.store, "disable_member", { member_key: f.ownerKey, principal_id: f.owner.id }),
    400,
  );
  f.advance(91 * 86400000);
  await rejects(() => f.store.auth(f.ownerKey, "agent"), 401);
});
test("PR submissions require a safe GitHub URL and exact SHA", async (f) => {
  const c = await claim(f),
    base = {
      task_id: c.task_id,
      expected_version: c.version,
      lease_token: c.lease_token,
      summary: "Result",
      evidence: "Evidence",
    };
  await rejects(
    () => command(f.store, f.a.actor, "submit_work", { ...base, pr_url: "javascript:alert(1)" }),
    400,
  );
  await rejects(
    () =>
      command(f.store, f.a.actor, "submit_work", {
        ...base,
        pr_url: "https://github.com/example/repo/pull/1",
        commit_sha: "main",
      }),
    400,
  );
});
test("tool boundary validates unknown fields and does not persist membership secrets", async (f) => {
  await rejects(
    () =>
      callTool(f.store, "post_finding", {
        member_key: f.a.key,
        idempotency_key: uid(),
        body: "Useful finding",
        role: "owner",
      }),
    400,
  );
  await callTool(f.store, "post_finding", {
    member_key: f.a.key,
    idempotency_key: uid(),
    body: "A useful finding.",
  });
  const stored = JSON.stringify(await f.store.all("SELECT * FROM commands"));
  assert.ok(!stored.includes(f.a.key));
  assert.ok(TOOLS.every((t) => t.inputSchema.additionalProperties === false));
});
test("HTTP supports modern discovery and legacy initialize without leaking membership", async (f) => {
  const env = { DB: f.db, NOW: f.now, ASSETS: { fetch: () => new Response("site") } };
  const request = (message, headers = {}) =>
    new Request("http://127.0.0.1:8787/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(message),
    });
  let r = await handle(
    request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    }),
    env,
  );
  assert.equal((await r.json()).result.protocolVersion, "2025-11-25");
  const modern = {
    jsonrpc: "2.0",
    id: 2,
    method: "server/discover",
    params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
  };
  r = await handle(
    request(modern, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover" }),
    env,
  );
  const discovered = await r.json();
  assert.equal(discovered.result.resultType, "complete");
  assert.ok(discovered.result.supportedVersions.includes("2026-07-28"));
  r = await handle(
    request(modern, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "wrong" }),
    env,
  );
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, -32020);
  r = await handle(
    request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_work", arguments: { member_key: "invalid-key" } },
    }),
    env,
  );
  assert.equal((await r.json()).result.isError, true);
  r = await handle(new Request("http://127.0.0.1:8787/api/projects"), env);
  const publicData = await r.text();
  assert.ok(publicData.includes("DASN-FOUNDATION"));
  assert.ok(!publicData.includes("Contributor A"));
});
test("HTTP rejects cross-origin calls, oversized bodies, unknown methods and unsupported versions", async (f) => {
  const env = { DB: f.db, NOW: f.now, ASSETS: { fetch: () => new Response("site") } };
  const base = { method: "POST", headers: { "Content-Type": "application/json" } };
  let r = await handle(
    new Request("http://127.0.0.1:8787/mcp", {
      ...base,
      headers: { ...base.headers, Origin: "https://evil.example" },
      body: "{}",
    }),
    env,
  );
  assert.equal(r.status, 403);
  r = await handle(
    new Request("http://127.0.0.1:8787/mcp", { ...base, body: "x".repeat(40001) }),
    env,
  );
  assert.equal(r.status, 413);
  r = await handle(
    new Request("http://127.0.0.1:8787/mcp", {
      ...base,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nonexistent" }),
    }),
    env,
  );
  assert.equal(r.status, 404);
  r = await handle(
    new Request("http://127.0.0.1:8787/mcp", {
      ...base,
      headers: { ...base.headers, "MCP-Protocol-Version": "1900-01-01" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    env,
  );
  assert.equal((await r.json()).error.code, -32022);
  r = await handle(new Request("http://127.0.0.1:8787/mcp"), env);
  assert.equal(r.status, 405);
});

Deno.test("SQLite state survives closing and reopening the database", async () => {
  await Deno.mkdir(".local", { recursive: true });
  const filename = `.local/persistence-${uid()}.sqlite`;
  let db = new SqliteD1(filename);
  db.sql.exec(schema);
  const code = await seed(db);
  const store = new Store(db), owner = await store.join(code, "Persistent owner");
  const actor = await store.auth(owner.session, "agent");
  await command(store, actor, "post_finding", { body: "Durable finding." });
  db.close();
  db = new SqliteD1(filename);
  const reopened = new Store(db);
  assert.equal((await reopened.notes())[0].body, "Durable finding.");
  assert.equal((await reopened.auth(owner.session, "agent")).name, "Persistent owner");
  db.close();
  await Deno.remove(filename);
});

test("stdio adapter delivers tool discovery over a real loopback HTTP connection", async (f) => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (request) =>
      handle(request, { DB: f.db, NOW: f.now, ASSETS: { fetch: () => new Response("site") } }),
  );
  const process = new Deno.Command("python3", {
    args: ["scripts/mcp_stdio.py", "--url", `http://127.0.0.1:${server.addr.port}/mcp`],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  try {
    const writer = process.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n",
      ),
    );
    await writer.close();
    const out = await process.output();
    assert.equal(out.code, 0);
    const reply = JSON.parse(new TextDecoder().decode(out.stdout));
    assert.ok(reply.result.tools.some((t) => t.name === "join_project"));
  } finally {
    await server.shutdown();
  }
});
