PRAGMA foreign_keys = ON;

-- Project-scoped co-operators avoid expanding the global principal owner role.
CREATE TABLE IF NOT EXISTS project_operators (
 project_id TEXT NOT NULL REFERENCES projects(id),
 principal_id TEXT NOT NULL REFERENCES principals(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,principal_id)
);
CREATE TABLE IF NOT EXISTS project_invite_operators (
 invite_id TEXT PRIMARY KEY REFERENCES invites(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 co_operator INTEGER NOT NULL DEFAULT 0 CHECK(co_operator IN (0,1))
);

-- Preserve the existing DASN operator's project authority after the additive migration.
INSERT OR IGNORE INTO project_operators(project_id,principal_id,created_at)
 SELECT 'dasn',id,created_at FROM principals WHERE role='owner' AND disabled=0
 AND EXISTS(SELECT 1 FROM project_members WHERE project_id='dasn' AND principal_id=principals.id);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (4);
