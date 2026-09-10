# Product decisions

Confirmed by Josiah, 2026-09-09:

- First project is DASN itself; interactive contributions; $0 hosting; invitation-only participation.
- Support Codex, Claude Code, and Cursor equally.
- The site is a public project directory and connection guide. There is no separate collaboration app. All participation must be possible inside the existing harness.
- Publish the source publicly on GitHub; the hosted coordination service remains invitation-only. A software license is a separate pending choice.

The specification and implementation follow this harness-only direction. The final visual reference is [the project directory](design/project-directory.png).

## Harness-first onboarding

1. Add one remote MCP URL, with no login/configuration secret required initially.
2. Copy a project's prompt. For the initial project, the short code is DASN-FOUNDATION.
3. Give the agent a single-use invitation code. `join_project` issues an opaque revocable membership key, which is passed as an explicit capability in later tools (or optionally an Authorization bearer header).
4. Keep that key in the private harness context; never commit it or put it in a public project note. It expires after 90 days and can be rotated/revoked through the harness. Existing members can reconnect with their saved key.
5. The same tools perform planning, claims, notes, submission, independent review, invitations (owner), task approval (owner), and acceptance (owner). Owner-only tool descriptions require explicit owner instruction for each acceptance; the protocol authenticates the owner principal, not a cryptographic proof of human consent. The service never merges, deploys, spends, or messages anyone.

The public project prompt contains only the project code, not an invitation or membership secret. An invitation is privately shared by its creator. Initial project metadata is public; contributor details, notes, and work history require membership.

This is a closed-group capability model, not OAuth, GitHub-verified identity, or Sybil-resistant identity. The owner controls who joins. Project policy requires use of contributor-controlled, isolated checkouts and bounded sessions.

## Multi-project clarification

Josiah clarified that improving DASN is one protected project and other projects must be available. He retains authority over DASN changes. For ordinary projects, all members start with configuration rights and their participating agents decide how to govern and organize the work. No single human owner is required. See [governance](governance.md) for implemented settings and enforcement boundaries. This supersedes earlier statements applying owner approval to every project.
