PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS project_settings (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), code TEXT NOT NULL UNIQUE,
 creator_id TEXT REFERENCES principals(id), protected INTEGER NOT NULL DEFAULT 0 CHECK(protected IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 governance TEXT NOT NULL DEFAULT 'members' CHECK(governance IN ('members','maintainers')),
 joining TEXT NOT NULL DEFAULT 'network' CHECK(joining IN ('network','invitation')),
 task_approval TEXT NOT NULL DEFAULT 'members' CHECK(task_approval IN ('members','maintainers')),
 acceptance TEXT NOT NULL DEFAULT 'members' CHECK(acceptance IN ('members','maintainers')),
 reviews_required INTEGER NOT NULL DEFAULT 1 CHECK(reviews_required BETWEEN 0 AND 5),
 allow_self_accept INTEGER NOT NULL DEFAULT 0 CHECK(allow_self_accept IN (0,1))
);
CREATE TABLE IF NOT EXISTS project_members (
 project_id TEXT NOT NULL REFERENCES projects(id), principal_id TEXT NOT NULL REFERENCES principals(id),
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','maintainer')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), joined_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,principal_id)
);
CREATE INDEX IF NOT EXISTS project_members_principal ON project_members(principal_id,active);
CREATE TABLE IF NOT EXISTS project_invites (
 invite_id TEXT PRIMARY KEY REFERENCES invites(id), project_id TEXT NOT NULL REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS mutation_guards (
 command_id TEXT PRIMARY KEY, allowed INTEGER NOT NULL CHECK(allowed=1)
);
CREATE TABLE IF NOT EXISTS receipt_policies (
 receipt_id TEXT PRIMARY KEY REFERENCES receipts(id), policy_json TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS receipt_policy_no_update BEFORE UPDATE ON receipt_policies BEGIN SELECT RAISE(ABORT,'Receipt policies are immutable'); END;
CREATE TRIGGER IF NOT EXISTS receipt_policy_no_delete BEFORE DELETE ON receipt_policies BEGIN SELECT RAISE(ABORT,'Receipt policies are immutable'); END;
INSERT OR IGNORE INTO project_settings(project_id,code,protected,governance,joining,task_approval,acceptance)
 SELECT id,'DASN-FOUNDATION',1,'maintainers','invitation','maintainers','maintainers' FROM projects
 WHERE id='dasn' AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2);
INSERT OR IGNORE INTO project_members(project_id,principal_id,role,active,joined_at)
 SELECT 'dasn',id,CASE WHEN role='owner' THEN 'maintainer' ELSE 'member' END,1-disabled,created_at FROM principals
 WHERE EXISTS(SELECT 1 FROM projects WHERE id='dasn') AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2);
INSERT OR IGNORE INTO project_invites(invite_id,project_id)
 SELECT id,'dasn' FROM invites WHERE EXISTS(SELECT 1 FROM projects WHERE id='dasn')
 AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
