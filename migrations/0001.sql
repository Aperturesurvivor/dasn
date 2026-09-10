PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS principals (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 role TEXT NOT NULL CHECK(role IN ('owner','member')), created_at INTEGER NOT NULL,
 disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credentials (
 hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, principal_id TEXT NOT NULL REFERENCES principals(id),
 kind TEXT NOT NULL CHECK(kind IN ('session','agent')), label TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS credentials_principal ON credentials(principal_id,kind);
CREATE TABLE IF NOT EXISTS invites (
 hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, created_by TEXT REFERENCES principals(id),
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT, join_request_hash TEXT,
 revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, guide TEXT NOT NULL,
 repository TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS work (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
 description TEXT NOT NULL, criteria TEXT NOT NULL, kind TEXT NOT NULL,
 conflict_scope TEXT NOT NULL, base_ref TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL CHECK(state IN ('proposed','ready','leased','blocked','submitted','accepted')),
 version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES principals(id),
 claimant TEXT REFERENCES principals(id), lease_token TEXT, lease_expires INTEGER,
 blocker TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS work_project_state ON work(project_id,state,created_at);
CREATE INDEX IF NOT EXISTS work_scope_lease ON work(project_id,conflict_scope,state,lease_expires);
CREATE INDEX IF NOT EXISTS work_claimant ON work(claimant,state);
CREATE TABLE IF NOT EXISTS submissions (
 id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES work(id), author_id TEXT NOT NULL REFERENCES principals(id),
 summary TEXT NOT NULL, evidence TEXT NOT NULL, pr_url TEXT NOT NULL DEFAULT '', commit_sha TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','changes_requested','accepted'))
);
CREATE INDEX IF NOT EXISTS submissions_work ON submissions(work_id,created_at);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id),
 reviewer_id TEXT NOT NULL REFERENCES principals(id), verdict TEXT NOT NULL CHECK(verdict IN ('approve','changes_requested')),
 rationale TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(submission_id,reviewer_id)
);
CREATE TABLE IF NOT EXISTS notes (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), work_id TEXT REFERENCES work(id),
 author_id TEXT NOT NULL REFERENCES principals(id), body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id,created_at);
CREATE TABLE IF NOT EXISTS commands (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES principals(id), key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, changed INTEGER NOT NULL DEFAULT 0, response TEXT NOT NULL,
 created_at INTEGER NOT NULL, UNIQUE(actor_id,key)
);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES principals(id), project_id TEXT REFERENCES projects(id),
 entity_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id,created_at);
CREATE TABLE IF NOT EXISTS receipts (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
 work_id TEXT NOT NULL REFERENCES work(id), contributor_id TEXT NOT NULL REFERENCES principals(id),
 accepted_by TEXT NOT NULL REFERENCES principals(id), statement TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS receipt_no_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'Receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS receipt_no_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'Receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS event_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS event_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
