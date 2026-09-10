import assert from "node:assert/strict";
import { SqliteD1 } from "../src/sqlite.mjs";
import { seed } from "../src/seed.mjs";
import { Store, uid } from "../src/store.mjs";
import { callTool, TOOLS } from "../src/tools.mjs";
import { handle } from "../src/worker.mjs";

const schema = (await Promise.all(
  [1, 2, 3].map((v) => Deno.readTextFile(new URL(`../migrations/000${v}.sql`, import.meta.url))),
)).join("\n");
function test(name, body) {
  Deno.test(name, async () => {
    const db = new SqliteD1();
    db.sql.exec(schema);
    let now = 1800000000000;
    const store = new Store(db, () => now), token = await seed(db, now);
    const owner = await store.join(token, "Owner"),
      ownerActor = await store.auth(owner.session, "agent");
    const keys = { owner: owner.session };
    for (const who of ["a", "b"]) {
      const invitation = await store.invite(ownerActor);
      keys[who] = (await store.join(invitation.token, who)).session;
    }
    const call = (who, name, args = {}, project = "DASN-FOUNDATION") =>
      callTool(store, name, {
        member_key: keys[who],
        project_code: project,
        ...(!TOOLS.find((t) => t.name === name).annotations.readOnlyHint
          ? { idempotency_key: uid() }
          : {}),
        ...args,
      });
    const register = (who, name = who) =>
      call(who, "register_agent", { name, harness: "test harness" });
    const write = (who, body, expected_version = 0, extra = {}) =>
      call(who, "write_workspace", { path: "draft.txt", body, expected_version, ...extra });
    try {
      await body({ db, store, keys, call, register, write, advance: (ms) => now += ms });
    } finally {
      db.close();
    }
  });
}
const rejects = (fn, status) => assert.rejects(fn, (e) => e.status === status);

test("two contributors share exact text, optional spaces and immutable revision history without claims", async (f) => {
  const agent = await f.register("a");
  await f.write("a", "  first\n\n", 0, {
    agent_id: agent.agent_id,
    metadata: { purpose: "draft" },
  });
  assert.equal(
    (await f.call("b", "read_workspace", { path: "draft.txt" })).untrusted_entry.body,
    "  first\n\n",
  );
  await f.write("b", "second", 1);
  const old =
    (await f.call("a", "read_workspace", { path: "draft.txt", revision: 1 })).untrusted_entry;
  assert.equal(old.body, "  first\n\n");
  assert.equal(old.agent_id, agent.agent_id);
  assert.deepEqual(
    (await f.call("a", "read_workspace", { path: "draft.txt" })).untrusted_entry.metadata,
    { purpose: "draft" },
  );
  assert.throws(
    () => f.db.sql.exec("UPDATE workspace_revisions SET body='overwrite'"),
    /immutable/,
  );
  await f.write("b", "", 2, { archived: true });
  assert.equal((await f.call("a", "list_workspace")).entries.length, 0);
  await f.write("a", "restored", 3, { archived: false });
  await f.call("a", "write_workspace", {
    path: "design",
    kind: "space",
    expected_version: 0,
    body: "We can organize here.",
  });
  assert.equal((await f.store.one("SELECT count(*) AS n FROM work WHERE state='leased'")).n, 0);
});

test("concurrent writes and creates have one winner with no lost history or extra successful events", async (f) => {
  const raced = await Promise.allSettled([f.write("a", "A"), f.write("b", "B")]);
  assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(raced.find((r) => r.status === "rejected").reason.status, 409);
  const second = await Promise.allSettled([f.write("a", "AA", 1), f.write("b", "BB", 1)]);
  assert.equal(second.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await f.store.one("SELECT count(*) AS n FROM workspace_revisions")).n, 2);
  assert.equal(
    (await f.store.one("SELECT count(*) AS n FROM events WHERE action='write_workspace'")).n,
    2,
  );
});

test("workspace retries recover original response after later edits, while changed payload reuse fails", async (f) => {
  const args = { idempotency_key: uid() };
  const first = await f.write("a", "original", 0, args);
  await f.write("b", "later", 1);
  assert.deepEqual(await f.write("a", "original", 0, args), first);
  await rejects(() => f.write("a", "different", 0, args), 409);
  assert.equal((await f.store.one("SELECT count(*) AS n FROM workspace_revisions")).n, 2);
});

test("paths, literal prefix paging and nested input validation reject ambiguous or oversized writes", async (f) => {
  for (const path of ["/root", "a/../b", "a//b", "a/./b", "a\\b", "a\u0000b", " a"]) {
    await rejects(() => f.write("a", "x", 0, { path }), 400);
  }
  await rejects(() => f.write("a", "x", 0, { metadata: [] }), 400);
  await rejects(() => f.write("a", "x", 0, { metadata: { big: "x".repeat(4000) } }), 400);
  await rejects(() => f.write("a", "x".repeat(24001)), 400);
  for (const path of ["a%/1", "a%/2", "abc/1"]) await f.write("a", "x", 0, { path });
  const page = await f.call("a", "list_workspace", { prefix: "a%/", limit: 1 });
  assert.equal(page.entries[0].path, "a%/1");
  const next = await f.call("a", "list_workspace", {
    prefix: "a%/",
    limit: 1,
    after: page.next_after,
  });
  assert.equal(next.entries[0].path, "a%/2");
  assert.equal(next.next_after, null);
});

test("agents choose roles and self-report presence but cannot impersonate or stop another contributor", async (f) => {
  const a = await f.register("a"), b = await f.register("b");
  await f.call("a", "update_agent", {
    agent_id: a.agent_id,
    expected_version: 1,
    role: "Editor",
    intent: "Clean up drafts",
  });
  await rejects(
    () =>
      f.call("b", "update_agent", { agent_id: a.agent_id, expected_version: 2, state: "offline" }),
    403,
  );
  await rejects(
    () => f.call("a", "send_message", { agent_id: b.agent_id, body: "Impersonation" }),
    403,
  );
  await f.call("a", "send_message", {
    agent_id: a.agent_id,
    to_agent_id: b.agent_id,
    kind: "stop",
    body: "Please pause overlapping edits.",
  });
  const agents = (await f.call("a", "list_agents")).agents;
  assert.equal(agents.find((x) => x.id === b.agent_id).effective_state, "active");
  f.advance(600001);
  assert((await f.call("a", "list_agents")).agents.every((a) => a.effective_state === "stale"));
});

test("messages have project-visible routing, replies, incremental cursors and idempotent delivery", async (f) => {
  const a = await f.register("a"), b = await f.register("b");
  const args = {
    idempotency_key: uid(),
    agent_id: a.agent_id,
    to_agent_id: b.agent_id,
    kind: "start",
    body: "Could you review the copy?",
  };
  const sent = await f.call("a", "send_message", args);
  assert.deepEqual(await f.call("a", "send_message", args), sent);
  const inbox = await f.call("b", "read_messages", { agent_id: b.agent_id });
  assert.equal(inbox.untrusted_messages.length, 1);
  await f.call("b", "send_message", {
    agent_id: b.agent_id,
    to_agent_id: a.agent_id,
    in_reply_to: sent.message_id,
    kind: "response",
    body: "Starting within my session budget.",
  });
  const updates = await f.call("owner", "read_messages", { after_seq: inbox.next_after_seq });
  assert.equal(updates.untrusted_messages.length, 1);
  assert.equal(updates.untrusted_messages[0].in_reply_to, sent.message_id);
  assert.equal(
    (await f.call("a", "read_messages", { after_seq: updates.next_after_seq })).untrusted_messages
      .length,
    0,
  );
  assert.throws(() => f.db.sql.exec("DELETE FROM workspace_messages"), /immutable/);
});

test("direct contributions need no task claim and freeze exact workspace revisions through independent acceptance", async (f) => {
  const a = await f.register("a");
  await f.write("a", "Proposed copy");
  const submitted = await f.call("a", "submit_contribution", {
    agent_id: a.agent_id,
    title: "Copy",
    summary: "Updated copy",
    evidence: "Read through for clarity",
    artifacts: [{ path: "draft.txt", version: 1 }],
  });
  const cid = submitted.contribution_id;
  await f.write("b", "Later copy", 1);
  const details = await f.call("b", "read_contribution", { contribution_id: cid });
  assert.deepEqual(details.contribution.artifacts, [{ path: "draft.txt", version: 1 }]);
  assert.equal((await f.call("a", "list_work")).work.length, 3);
  await rejects(
    () =>
      f.call("owner", "decide_contribution", {
        contribution_id: cid,
        expected_version: 1,
        decision: "accept",
        statement: "Accept",
      }),
    409,
  );
  await f.register("a", "Another agent of A");
  await rejects(
    () =>
      f.call("a", "review_contribution", {
        contribution_id: cid,
        verdict: "approve",
        rationale: "Same principal",
      }),
    403,
  );
  await f.call("b", "review_contribution", {
    contribution_id: cid,
    verdict: "approve",
    rationale: "Read the exact first revision.",
  });
  await rejects(
    () =>
      f.call("b", "decide_contribution", {
        contribution_id: cid,
        expected_version: 1,
        decision: "accept",
        statement: "Accept",
      }),
    403,
  );
  await f.call("owner", "decide_contribution", {
    contribution_id: cid,
    expected_version: 1,
    decision: "accept",
    statement: "Operator accepts reviewed copy.",
  });
  assert.equal(
    (await f.call("a", "read_contribution", { contribution_id: cid })).contribution.status,
    "accepted",
  );
});

test("direct contribution retry, malformed references, mismatched repository and missing revision are handled", async (f) => {
  const args = {
    title: "Research",
    summary: "Result",
    evidence: "Observed evidence",
    idempotency_key: uid(),
  };
  const a = await f.call("a", "submit_contribution", args);
  assert.deepEqual(await f.call("a", "submit_contribution", args), a);
  await rejects(
    () =>
      f.call("a", "submit_contribution", {
        ...args,
        idempotency_key: uid(),
        artifacts: [{ path: "missing", version: 1 }],
      }),
    404,
  );
  await rejects(
    () =>
      f.call("a", "submit_contribution", { ...args, idempotency_key: uid(), artifacts: [null] }),
    400,
  );
  await rejects(
    () =>
      f.call("a", "submit_contribution", {
        ...args,
        idempotency_key: uid(),
        artifacts: [{ path: "x", version: 1, other: true }],
      }),
    400,
  );
  await rejects(
    () =>
      f.call("a", "submit_contribution", {
        ...args,
        idempotency_key: uid(),
        pr_url: "https://github.com/other/repo/pull/1",
        commit_sha: "a".repeat(40),
      }),
    400,
  );
  assert.equal((await f.store.one("SELECT count(*) AS n FROM direct_contributions")).n, 1);
});

test("advisory voting counts contributor identities, supports ballot replacement and never changes policy", async (f) => {
  const a = await f.register("a"), another = await f.register("a", "second A");
  const vote = await f.call("a", "open_vote", {
    question: "Choose a direction?",
    options: ["Explore", "Refine"],
  });
  await f.call("a", "cast_vote", { vote_id: vote.vote_id, agent_id: a.agent_id, choice: 0 });
  await f.call("a", "cast_vote", { vote_id: vote.vote_id, agent_id: another.agent_id, choice: 1 });
  await f.call("b", "cast_vote", { vote_id: vote.vote_id, choice: 1 });
  const result = await f.call("a", "read_vote", { vote_id: vote.vote_id });
  assert.deepEqual(result.tally.map((x) => x.count), [0, 2]);
  assert.equal(result.ballots.length, 2);
  await f.call("b", "close_vote", { vote_id: vote.vote_id, expected_version: result.vote.version });
  await rejects(() => f.call("a", "cast_vote", { vote_id: vote.vote_id, choice: 0 }), 409);
  assert.equal((await f.store.project()).governance, "maintainers");
});

test("votes reject bad choices, stale closure, expired voting and recover successful ballot retries", async (f) => {
  await rejects(() => f.call("a", "open_vote", { question: "Q?", options: ["A", "a"] }), 400);
  await rejects(() => f.call("a", "open_vote", { question: "Q?", options: ["A", {}] }), 400);
  const vote = await f.call("a", "open_vote", { question: "Q?", options: ["A", "B"], minutes: 1 });
  await rejects(() => f.call("a", "cast_vote", { vote_id: vote.vote_id, choice: 2 }), 400);
  const args = { idempotency_key: uid(), vote_id: vote.vote_id, choice: 0 };
  const ballot = await f.call("a", "cast_vote", args);
  await rejects(
    () => f.call("b", "close_vote", { vote_id: vote.vote_id, expected_version: 1 }),
    409,
  );
  f.advance(60001);
  assert.deepEqual(await f.call("a", "cast_vote", args), ballot);
  assert.equal((await f.call("b", "read_vote", { vote_id: vote.vote_id })).vote.open, false);
  await rejects(() => f.call("b", "cast_vote", { vote_id: vote.vote_id, choice: 1 }), 409);
});

test("all workspace surfaces enforce membership and project boundaries", async (f) => {
  await f.call("a", "create_project", {
    name: "Other",
    description: "Other goal",
    guide: "Decide together",
  }, "OTHER-PROJECT");
  const a = await f.register("a");
  const vote = await f.call("a", "open_vote", { question: "Q?", options: ["A", "B"] });
  const c = await f.call("a", "submit_contribution", {
    title: "C",
    summary: "Summary",
    evidence: "Evidence",
  });
  for (
    const name of [
      "get_workspace",
      "list_workspace",
      "list_agents",
      "read_messages",
      "list_votes",
      "list_contributions",
    ]
  ) await rejects(() => f.call("b", name, {}, "OTHER-PROJECT"), 403);
  await rejects(() => f.call("a", "read_vote", { vote_id: vote.vote_id }, "OTHER-PROJECT"), 404);
  await rejects(
    () => f.call("a", "read_contribution", { contribution_id: c.contribution_id }, "OTHER-PROJECT"),
    404,
  );
  await rejects(
    () =>
      f.call(
        "a",
        "send_message",
        { to_agent_id: a.agent_id, body: "Cross-project" },
        "OTHER-PROJECT",
      ),
    404,
  );
  await rejects(
    () =>
      f.call("a", "review_contribution", {
        contribution_id: c.contribution_id,
        verdict: "approve",
        rationale: "Wrong project",
      }, "OTHER-PROJECT"),
    404,
  );
});

test("ordinary project members choose goals and process, then freely contribute and accept under those rules", async (f) => {
  const created = await f.call("a", "create_project", {
    name: "Collective",
    description: "Initial goal",
    guide: "Decide together",
  }, "COLLECTIVE");
  await callTool(f.store, "join_project", { member_key: f.keys.b, project_code: "COLLECTIVE" });
  await f.call("b", "configure_project", {
    expected_version: created.version,
    description: "Our revised goal",
    guide: "Shared editing; no mandatory review.",
    reviews_required: 0,
    allow_self_accept: true,
  }, "COLLECTIVE");
  await f.call("b", "write_workspace", {
    path: "experiments/idea.md",
    expected_version: 0,
    body: "Try something useful.",
  }, "COLLECTIVE");
  const c = await f.call("b", "submit_contribution", {
    title: "Experiment",
    summary: "Tried it",
    evidence: "Documented observations",
  }, "COLLECTIVE");
  await f.call("b", "decide_contribution", {
    contribution_id: c.contribution_id,
    expected_version: 1,
    decision: "accept",
    statement: "Per our rules",
  }, "COLLECTIVE");
  assert.equal(
    (await f.call("a", "get_workspace", {}, "COLLECTIVE")).project.description,
    "Our revised goal",
  );
});

test("permission revocation racing a workspace write rolls back all writes", async (f) => {
  const original = f.db.batch.bind(f.db);
  let intercepted = false;
  f.db.batch = (statements) => {
    if (!intercepted && statements.some((s) => s._sql.includes("INSERT INTO workspace_entries"))) {
      intercepted = true;
      f.db.sql.exec(
        "UPDATE project_members SET active=0 WHERE principal_id=(SELECT id FROM principals WHERE name='a')",
      );
    }
    return original(statements);
  };
  await rejects(() => f.write("a", "Should roll back"), 409);
  assert.equal((await f.store.one("SELECT count(*) AS n FROM workspace_entries")).n, 0);
  assert.equal((await f.store.one("SELECT count(*) AS n FROM commands")).n, 0);
});

test("additive migration preserves old submitted work and repeated startup preserves shared data", async (f) => {
  const before = await f.store.all("SELECT * FROM work ORDER BY id");
  await f.write("a", "Keep this");
  f.db.sql.exec(await Deno.readTextFile(new URL("../migrations/0003.sql", import.meta.url)));
  assert.deepEqual(await f.store.all("SELECT * FROM work ORDER BY id"), before);
  assert.equal(
    (await f.call("b", "read_workspace", { path: "draft.txt" })).untrusted_entry.body,
    "Keep this",
  );
});

test("HTTP advertises workspace tools and supports contribution without a lease", async (f) => {
  const env = { DB: f.db };
  const rpc = async (method, params) => {
    const response = await handle(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: uid(), method, params }),
      }),
      env,
    );
    assert.equal(response.status, 200);
    return await response.json();
  };
  const listed = await rpc("tools/list", {});
  assert(listed.result.tools.some((t) => t.name === "write_workspace"));
  const result = await rpc("tools/call", {
    name: "submit_contribution",
    arguments: {
      member_key: f.keys.a,
      project_code: "DASN-FOUNDATION",
      idempotency_key: uid(),
      title: "HTTP result",
      summary: "Useful work",
      evidence: "No lease required",
    },
  });
  assert.equal(result.result.isError, false);
  assert(result.result.structuredContent.contribution_id);
  const context = await f.call("a", "get_context_bundle");
  assert(context.untrusted_community_data.contributions.length === 1);
  assert(context.session_contract.includes("No task claim is required"));
});

test("public HTML includes live project metadata and MCP URL without JavaScript, escaping contributed text", async (f) => {
  await f.call("a", "create_project", {
    name: '<img src=x onerror="bad()">',
    description: "<script>bad()</script>",
    guide: "Useful goal",
  }, "HTML-TEST");
  const response = await handle(new Request("https://example.test/"), {
    DB: f.db,
    ASSETS: {
      fetch: async () =>
        new Response(await Deno.readTextFile(new URL("../public/index.html", import.meta.url)), {
          headers: { "Content-Type": "text/html" },
        }),
    },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert(html.includes("https://example.test/mcp"));
  assert(html.includes("DASN-FOUNDATION"));
  assert(html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  assert(!html.includes('<img src=x onerror="bad()">'));
  assert(!html.includes("Loading projects"));
  assert(!html.includes("<!--DASN_"));
});
