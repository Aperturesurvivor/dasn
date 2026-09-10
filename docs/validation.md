# Validation — 2026-09-09

## Demonstrated

- `deno task check`: formatting and lint passed.
- Service suite: **23 tests passed**, covering join recovery, single-use/expired/revoked invitations, concurrent claims, conflict scopes, expired-lease fencing, identical retries, idempotency-key misuse, non-holder/stale mutations, owner role boundaries, independent reviews, acceptance and immutable receipts, revisions, transactional rollback, blockers, key revocation, PR input validation, HTTP protocol versions/origin/body limits, SQLite restart persistence, and the Python stdio bridge over real loopback HTTP.
- Release suite: **2 tests passed**, executing the actual deployment script against simulated Cloudflare responses and real SQLite. Verified the documented REST batch envelope, bootstrap saved before seeding, module upload metadata, and refusal to overwrite an unrelated Worker. Uses fixture modules and no credentials/network; it does not prove a live Cloudflare deployment.
- `deno task build`: five standalone Worker modules and a SHA-256 manifest produced without project dependencies or private data.
- Installed Claude Code: an isolated `CLAUDE_CONFIG_DIR` containing only DASN was created under ignored `.local/`; `claude mcp list` connected to the running HTTP endpoint and reported **Connected**. Existing user MCP settings were preserved. This checks a real harness handshake, not a model completing a task.
- Installed Codex accepted the server through a command-scoped configuration override and returned its `streamable_http` transport. No persistent Codex settings were changed. Cursor's current official MCP documentation confirms the URL configuration format; Cursor is not installed here.
- Codex in-app browser: public project directory, all three setup tabs, all connection copy buttons, and the complete project prompt tested. Clipboard contents were inspected against intended config and restored afterward.
- Desktop viewport 1536×1024 and mobile viewport 390×844: readable layout and no horizontal overflow. Cursor configuration renders and copies as valid JSON. Browser viewport override reset afterward.

## Visual comparison

The first generated work-board app was superseded by the user's harness-only clarification. The implementation target is [project-directory.png](design/project-directory.png), generated with the built-in image tool. Latest browser screenshots: [desktop](qa/desktop.png), [mobile](qa/mobile.png). All three were opened through `view_image` in the same QA pass.

| Comparison | Result |
|---|---|
| Primary heading and subtitle | Matches the directory concept; no extra hero labels |
| Header and navigation | Text DASN logo; Projects and Connect links; simple horizontal rule |
| Project presentation | One open row, D monogram, code, invitation requirement, copy button |
| Colors and typography | White, dark navy, blue actions, gray secondary copy; consistent native font |
| Setup interaction | Three harness tabs and numbered steps; working copy actions |
| Mobile | Full-width copy button, readable project metadata, reflowed heading/code; no overflow |

Intentional functional differences from the concept: actual endpoint replaces the mock hostname; each harness adds explicit setup/restart instructions and official links; local preview shows a host-only notice; a disclosure explains joining/key handling. These lengthen the page below the concept's compact viewport. No raster mockup is shipped as UI. The generated directory's visual direction was implemented and compared; the user has not explicitly approved a final pixel-exact design.

## Not yet demonstrated

- Production Cloudflare deployment, account Free plan, actual D1 transaction behavior, quota behavior, or a live public URL.
- An actual model session using DASN tools in Codex, Claude Code, or Cursor, or a friend completing a contribution. The Claude Code health handshake and protocol tests are not all-client acceptance testing.
- License selection, GitHub integration, or a real accepted software PR. Source publication is authorized and tracked separately from service deployment.

## Environment issue

The initial Documents checkout was automatically offloaded (`compressed,dataless`), stalling reads. This task's own text files were recovered from its write history into `/Users/josiahwilson/dasn`; the original offloaded path was not deleted. Available disk space later fell below 5 GB due to unrelated machine activity; DASN is about 2 MB. Avoid dependency restoration or other disk-heavy workflows until adequate space is available.
