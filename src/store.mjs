export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const uid = () => crypto.randomUUID();
export const secret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0"))
    .join("");
export const hash = async (value) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export function str(value, label, max = 4000, min = 1) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new Problem(400, `${label} must be ${min}–${max} characters.`);
  }
  return value.trim();
}
export function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Problem(400, `${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
export class Store {
  constructor(db, now = Date.now) {
    this.db = db;
    this.now = now;
  }
  stmt(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }
  one(sql, ...args) {
    return this.stmt(sql, ...args).first();
  }
  async all(sql, ...args) {
    return (await this.stmt(sql, ...args).all()).results;
  }
  async rate(identity, write = false) {
    const now = this.now(), window = Math.floor(now / 60000), max = write ? 45 : 240;
    const result = await this.one(
      "INSERT INTO rate_limits(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count",
      `${identity}:${write}:${window}`,
      now + 120000,
      max,
    );
    if (!result) throw new Problem(429, "Please wait a minute before trying again.");
  }
  async auth(token, kind) {
    if (!token || token.length > 256) {
      throw new Problem(401, "Join with an invitation or reconnect your agent.");
    }
    const actor = await this.one(
      "SELECT p.id,p.name,p.role,c.kind,c.id AS credential_id FROM credentials c JOIN principals p ON p.id=c.principal_id WHERE c.hash=? AND c.kind=? AND c.revoked=0 AND p.disabled=0 AND c.expires_at>?",
      await hash(token),
      kind,
      this.now(),
    );
    if (!actor) throw new Problem(401, "This session or agent token has expired or been revoked.");
    return actor;
  }
  human(actor) {
    if (!["session", "agent"].includes(actor.kind)) {
      throw new Problem(403, "A membership key is required.");
    }
  }
  owner(actor) {
    if (actor.role !== "owner") throw new Problem(403, "Only the project owner can do that.");
  }
  async invite(actor) {
    this.owner(actor);
    const token = secret(), id = uid(), now = this.now();
    await this.stmt(
      "INSERT INTO invites(hash,id,created_by,role,created_at,expires_at) VALUES (?,?,?,?,?,?)",
      await hash(token),
      id,
      actor.id,
      "member",
      now,
      now + 7 * 86400000,
    ).run();
    return { id, token, expires_at: now + 7 * 86400000 };
  }
  async join(token, name, requestId = uid()) {
    str(token, "Invitation", 128);
    name = str(name, "Display name", 60);
    requestId = str(requestId, "Join request id", 128, 16);
    const now = this.now(), digest = await hash(token), id = uid();
    const session = await hash(`dasn-join-v1:${token}:${requestId}`);
    const requestHash = await hash(requestId);
    const results = await this.db.batch([
      this.stmt(
        "INSERT INTO principals(id,name,role,created_at) SELECT ?,?,role,? FROM invites WHERE hash=? AND used_by IS NULL AND revoked=0 AND expires_at>?",
        id,
        name,
        now,
        digest,
        now,
      ),
      this.stmt(
        "INSERT INTO credentials(hash,id,principal_id,kind,label,created_at,expires_at) SELECT ?,?,id,?,?,?,? FROM principals WHERE id=?",
        await hash(session),
        uid(),
        "agent",
        "Membership",
        now,
        now + 90 * 86400000,
        id,
      ),
      this.stmt(
        "UPDATE invites SET used_by=?,join_request_hash=? WHERE hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM principals WHERE id=?)",
        id,
        requestHash,
        digest,
        id,
      ),
    ]);
    if (!results[0].meta.changes) {
      const recovered = await this.one(
        "SELECT p.id,p.name,p.role FROM invites i JOIN principals p ON p.id=i.used_by JOIN credentials c ON c.principal_id=p.id WHERE i.hash=? AND i.join_request_hash=? AND p.name=? AND p.disabled=0 AND c.hash=? AND c.revoked=0 AND c.expires_at>?",
        digest,
        requestHash,
        name,
        await hash(session),
        now,
      );
      if (recovered) return { session, principal: recovered };
      throw new Problem(
        410,
        "This invitation was used, revoked, or expired. Ask the owner for a new invitation.",
      );
    }
    return {
      session,
      principal: await this.one("SELECT id,name,role FROM principals WHERE id=?", id),
    };
  }
  async token(actor, label) {
    this.human(actor);
    label = str(label, "Token label", 60);
    const active = await this.one(
      "SELECT count(*) AS n FROM credentials WHERE principal_id=? AND kind=? AND revoked=0 AND expires_at>?",
      actor.id,
      "agent",
      this.now(),
    );
    if (active.n >= 10) {
      throw new Problem(409, "Revoke an old agent token before creating another.");
    }
    const token = secret(), id = uid(), now = this.now(), expires = now + 90 * 86400000;
    await this.stmt(
      "INSERT INTO credentials(hash,id,principal_id,kind,label,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
      await hash(token),
      id,
      actor.id,
      "agent",
      label,
      now,
      expires,
    ).run();
    return { token, id, expires_at: expires };
  }
  async credentials(actor) {
    this.human(actor);
    return await this.all(
      "SELECT id,label,created_at,expires_at,revoked FROM credentials WHERE principal_id=? AND kind=? ORDER BY created_at DESC LIMIT 100",
      actor.id,
      "agent",
    );
  }
  async revoke(actor, id) {
    this.human(actor);
    await this.stmt(
      "UPDATE credentials SET revoked=1 WHERE id=? AND principal_id=? AND kind=?",
      str(id, "Token id", 64),
      actor.id,
      "agent",
    ).run();
    return { ok: true };
  }
  async project(id = "dasn") {
    const p = await this.one("SELECT * FROM projects WHERE id=?", id);
    if (!p) throw new Problem(404, "Project not found.");
    return p;
  }
  async task(id, actor) {
    const task = await this.one(
      "SELECT w.*,p.name AS claimant_name FROM work w LEFT JOIN principals p ON p.id=w.claimant WHERE w.id=?",
      str(id, "Task id", 64),
    );
    if (!task) throw new Problem(404, "Task not found.");
    task.effective_state = task.state === "leased" && task.lease_expires <= this.now()
      ? "ready"
      : task.state;
    if (task.claimant !== actor.id) delete task.lease_token;
    return task;
  }
  async listWork(actor, project = "dasn") {
    const tasks = await this.all(
      "SELECT w.*,p.name AS claimant_name FROM work w LEFT JOIN principals p ON p.id=w.claimant WHERE w.project_id=? ORDER BY w.created_at,w.id LIMIT 200",
      project,
    );
    return tasks.map((t) => {
      t.effective_state = t.state === "leased" && t.lease_expires <= this.now() ? "ready" : t.state;
      if (t.claimant !== actor.id) delete t.lease_token;
      return t;
    });
  }
  async detail(actor, id) {
    const task = await this.task(id, actor);
    const submissions = await this.all(
      "SELECT s.*,p.name AS author_name FROM submissions s JOIN principals p ON p.id=s.author_id WHERE work_id=? ORDER BY s.created_at DESC LIMIT 50",
      id,
    );
    const reviews = await this.all(
      "SELECT r.*,p.name AS reviewer_name FROM reviews r JOIN principals p ON p.id=r.reviewer_id JOIN submissions s ON s.id=r.submission_id WHERE s.work_id=? ORDER BY r.created_at DESC LIMIT 100",
      id,
    );
    return { task, submissions, reviews };
  }
  async command(actor, action, args, build) {
    const key = str(args.idempotency_key, "Idempotency key", 128, 8),
      fingerprint = await hash(JSON.stringify(canonical({ action, args }))),
      now = this.now();
    const existing = await this.one(
      "SELECT * FROM commands WHERE actor_id=? AND key=?",
      actor.id,
      key,
    );
    const replay = (row) => {
      if (row.fingerprint !== fingerprint) {
        throw new Problem(409, "This idempotency key was used for a different request.");
      }
      if (!row.changed) {
        throw new Problem(
          409,
          "The task changed, is unavailable, or conflicts with active work. Refresh and try again with a new idempotency key.",
        );
      }
      return JSON.parse(row.response);
    };
    if (existing) return replay(existing);
    const { steps, response, project = "dasn", entity, detail = action } = await build(now),
      id = uid();
    try {
      await this.db.batch([
        this.stmt(
          "INSERT INTO commands(id,actor_id,key,fingerprint,response,created_at) VALUES (?,?,?,?,?,?)",
          id,
          actor.id,
          key,
          fingerprint,
          JSON.stringify(response),
          now,
        ),
        ...steps,
        this.stmt("UPDATE commands SET changed=changes() WHERE id=?", id),
        this.stmt(
          "INSERT INTO events(id,actor_id,project_id,entity_id,action,detail,created_at) SELECT ?,?,?,?,?,?,? FROM commands WHERE id=? AND changed>0",
          uid(),
          actor.id,
          project,
          entity,
          action,
          detail,
          now,
          id,
        ),
      ]);
    } catch (error) {
      const concurrent = await this.one(
        "SELECT * FROM commands WHERE actor_id=? AND key=?",
        actor.id,
        key,
      );
      if (concurrent) return replay(concurrent);
      throw error;
    }
    return replay(await this.one("SELECT * FROM commands WHERE id=?", id));
  }
  async mutate(actor, action, args) {
    return await this.command(actor, action, args, async (now) => {
      const taskId = () => str(args.task_id, "Task id", 64),
        version = () => integer(args.expected_version, "Expected version", 1, 2147483646);
      const lease = () => str(args.lease_token, "Lease token", 64);
      const changed = (id, v, steps, extra = {}) => ({
        entity: id,
        response: { ok: true, task_id: id, version: v + 1, ...extra },
        steps,
      });
      if (action === "propose_work") {
        const id = uid(),
          project = str(args.project_id ?? "dasn", "Project", 64),
          title = str(args.title, "Title", 160),
          description = str(args.description, "Description", 8000),
          criteria = str(args.criteria, "Acceptance criteria", 4000),
          scope = str(args.conflict_scope, "Conflict scope", 100),
          base = str(args.base_ref ?? "", "Base reference", 100, 0),
          kind = str(args.kind, "Task type", 30);
        if (
          !["coding", "research", "testing", "documentation", "review", "planning"].includes(kind)
        ) throw new Problem(400, "Unknown task type.");
        await this.project(project);
        return {
          entity: id,
          project,
          response: { ok: true, task_id: id, version: 1 },
          detail: title,
          steps: [
            this.stmt(
              "INSERT INTO work(id,project_id,title,description,criteria,kind,conflict_scope,base_ref,state,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
              id,
              project,
              title,
              description,
              criteria,
              kind,
              scope,
              base,
              "proposed",
              actor.id,
              now,
              now,
            ),
          ],
        };
      }
      if (action === "post_finding") {
        const id = uid(),
          project = str(args.project_id ?? "dasn", "Project", 64),
          body = str(args.body, "Finding", 8000);
        await this.project(project);
        return {
          entity: id,
          project,
          response: { ok: true, note_id: id },
          steps: [
            this.stmt(
              "INSERT INTO notes(id,project_id,author_id,body,created_at) VALUES (?,?,?,?,?)",
              id,
              project,
              actor.id,
              body,
              now,
            ),
          ],
        };
      }
      if (action === "review_submission") {
        const id = uid(),
          submission = str(args.submission_id, "Submission", 64),
          rationale = str(args.rationale, "Rationale", 4000),
          verdict = str(args.verdict, "Verdict", 30);
        if (!["approve", "changes_requested"].includes(verdict)) {
          throw new Problem(400, "Invalid verdict.");
        }
        const s = await this.one("SELECT * FROM submissions WHERE id=?", submission);
        if (!s) throw new Problem(404, "Submission not found.");
        if (s.author_id === actor.id) {
          throw new Problem(403, "A different contributor must review this submission.");
        }
        return {
          entity: s.work_id,
          response: { ok: true, submission_id: submission },
          steps: [
            this.stmt(
              "INSERT INTO reviews(id,submission_id,reviewer_id,verdict,rationale,created_at) SELECT ?,id,?,?,?,? FROM submissions WHERE id=? AND author_id!=? AND status='pending' ON CONFLICT(submission_id,reviewer_id) DO UPDATE SET verdict=excluded.verdict,rationale=excluded.rationale,created_at=excluded.created_at",
              id,
              actor.id,
              verdict,
              rationale,
              now,
              submission,
              actor.id,
            ),
          ],
        };
      }
      const id = taskId(), v = version();
      if (action === "approve_work") {
        this.owner(actor);
        return changed(id, v, [
          this.stmt(
            "UPDATE work SET state='ready',version=version+1,updated_at=? WHERE id=? AND version=? AND state IN ('proposed','blocked')",
            now,
            id,
            v,
          ),
        ]);
      }
      if (action === "claim_work") {
        const minutes = integer(args.minutes ?? 30, "Lease minutes", 5, 120),
          token = uid(),
          expires = now + minutes * 60000;
        return changed(id, v, [
          this.stmt(
            "UPDATE work SET state='leased',claimant=?,lease_token=?,lease_expires=?,blocker=NULL,version=version+1,updated_at=? WHERE id=? AND version=? AND (state='ready' OR (state='leased' AND lease_expires<=?)) AND NOT EXISTS(SELECT 1 FROM work other WHERE other.project_id=work.project_id AND other.conflict_scope=work.conflict_scope AND other.id!=work.id AND (other.state='submitted' OR (other.state='leased' AND other.lease_expires>?))) AND (SELECT count(*) FROM work active WHERE active.claimant=? AND active.state='leased' AND active.lease_expires>?)<3",
            actor.id,
            token,
            expires,
            now,
            id,
            v,
            now,
            now,
            actor.id,
            now,
          ),
        ], { lease_token: token, lease_expires: expires });
      }
      if (action === "renew_lease") {
        const expires = now + integer(args.minutes ?? 30, "Lease minutes", 5, 120) * 60000;
        return changed(id, v, [
          this.stmt(
            "UPDATE work SET lease_expires=?,version=version+1,updated_at=? WHERE id=? AND version=? AND state='leased' AND claimant=? AND lease_token=? AND lease_expires>?",
            expires,
            now,
            id,
            v,
            actor.id,
            lease(),
            now,
          ),
        ], { lease_expires: expires });
      }
      if (action === "release_work" || action === "report_blocker") {
        const blocked = action === "report_blocker",
          reason = blocked ? str(args.reason, "Blocker", 4000) : null;
        return changed(id, v, [
          this.stmt(
            "UPDATE work SET state=?,claimant=NULL,lease_token=NULL,lease_expires=NULL,blocker=?,version=version+1,updated_at=? WHERE id=? AND version=? AND state='leased' AND claimant=? AND lease_token=? AND lease_expires>?",
            blocked ? "blocked" : "ready",
            reason,
            now,
            id,
            v,
            actor.id,
            lease(),
            now,
          ),
        ]);
      }
      if (action === "submit_work") {
        const summary = str(args.summary, "Summary", 4000),
          evidence = str(args.evidence, "Evidence", 8000),
          pr = str(args.pr_url ?? "", "PR URL", 250, 0),
          sha = str(args.commit_sha ?? "", "Commit SHA", 64, 0),
          submission = uid();
        if (
          pr &&
          !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(pr)
        ) throw new Problem(400, "Use a full GitHub pull request URL.");
        if ((pr && !/^[0-9a-f]{40}$/.test(sha)) || (!pr && sha)) {
          throw new Problem(400, "A PR submission needs its exact 40-character commit SHA.");
        }
        const task = await this.task(id, actor), project = await this.project(task.project_id);
        if (pr && project.repository && !pr.startsWith(`${project.repository}/pull/`)) {
          throw new Problem(400, "The PR must belong to this project repository.");
        }
        return changed(id, v, [
          this.stmt(
            "UPDATE work SET state='submitted',version=version+1,lease_expires=NULL,lease_token=NULL,updated_at=? WHERE id=? AND version=? AND state='leased' AND claimant=? AND lease_token=? AND lease_expires>?",
            now,
            id,
            v,
            actor.id,
            lease(),
            now,
          ),
          this.stmt(
            "INSERT INTO submissions(id,work_id,author_id,summary,evidence,pr_url,commit_sha,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1",
            submission,
            id,
            actor.id,
            summary,
            evidence,
            pr,
            sha,
            now,
          ),
        ], { submission_id: submission });
      }
      if (action === "accept_submission" || action === "request_changes") {
        this.owner(actor);
        const submission = str(args.submission_id, "Submission", 64),
          statement = str(args.statement, "Decision note", 4000),
          accept = action === "accept_submission";
        const row = await this.one(
          "SELECT * FROM submissions WHERE id=? AND work_id=?",
          submission,
          id,
        );
        if (!row) throw new Problem(404, "Submission not found.");
        const steps = [
          this.stmt(
            `UPDATE work SET state=?,version=version+1,updated_at=?,claimant=NULL WHERE id=? AND version=? AND state='submitted' AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND work_id=? AND status='pending') ${
              accept
                ? "AND EXISTS(SELECT 1 FROM reviews WHERE submission_id=? AND reviewer_id!=? AND verdict='approve') AND NOT EXISTS(SELECT 1 FROM reviews WHERE submission_id=? AND verdict='changes_requested')"
                : ""
            }`,
            accept ? "accepted" : "ready",
            now,
            id,
            v,
            submission,
            id,
            ...(accept ? [submission, row.author_id, submission] : []),
          ),
          this.stmt(
            "UPDATE submissions SET status=? WHERE id=? AND changes()=1",
            accept ? "accepted" : "changes_requested",
            submission,
          ),
        ];
        if (accept) {
          steps.push(
            this.stmt(
              "INSERT INTO receipts(id,submission_id,work_id,contributor_id,accepted_by,statement,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
              uid(),
              submission,
              id,
              row.author_id,
              actor.id,
              statement,
              now,
            ),
          );
        }
        return { ...changed(id, v, steps), detail: statement };
      }
      throw new Problem(404, "Unknown action.");
    });
  }
  async notes(project = "dasn") {
    return await this.all(
      "SELECT n.*,p.name AS author_name FROM notes n JOIN principals p ON p.id=n.author_id WHERE n.project_id=? ORDER BY n.created_at DESC LIMIT 100",
      project,
    );
  }
  async receipts() {
    return await this.all(
      "SELECT r.*,p.name AS contributor_name,o.name AS accepted_by_name,w.title,s.summary,s.pr_url,s.commit_sha FROM receipts r JOIN principals p ON p.id=r.contributor_id JOIN principals o ON o.id=r.accepted_by JOIN work w ON w.id=r.work_id JOIN submissions s ON s.id=r.submission_id ORDER BY r.created_at DESC LIMIT 100",
    );
  }
  async events() {
    return await this.all(
      "SELECT e.*,p.name AS actor_name FROM events e JOIN principals p ON p.id=e.actor_id ORDER BY e.created_at DESC LIMIT 100",
    );
  }
}
