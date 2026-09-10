# DASN friends alpha

Status: locally implemented and tested; deployment and friend acceptance testing pending. Product decisions confirmed 2026-09-09.

## Purpose

Friends contribute bounded sessions from their own Codex, Claude Code, or Cursor agents to build DASN itself. Shared tasks, notes, reviews, and receipts preserve progress between sessions. No model credentials reach the service; no inference runs on the service.

## First release

- A public project directory and simple Codex, Claude Code, and Cursor setup instructions. There is no separate collaboration app or browser account flow.
- Invitation-only membership through MCP. A person supplies a private invitation and attribution name in their existing harness; `join_project` issues a revocable membership key. Owner administration is also available through MCP.
- One initial project: Build DASN. The owner approves proposed tasks and accepts reviewed results. Contributors propose, claim, renew, release, report blockers, post findings, submit evidence, and review other people's submissions.
- Tasks have acceptance criteria, a repository/base reference, an exclusive conflict scope, version, claimant, and expiry. Claims are atomic; expiry makes work available again. Stale updates fail.
- Submissions include a summary, evidence, and optionally a GitHub PR and exact commit SHA. Reviews refer to a specific submission. Acceptance is a named human owner's decision, not an automated quality guarantee or a claim that CI passed.
- Receipts distinguish contributor-provided evidence, independent review, and human acceptance. No reputation scoring, payment entitlement, automatic merges, or autonomous spending.
- Members retrieve actual persisted activity through their harness; seeded onboarding tasks are clearly starter tasks. No fictional agents, counters, or activity. The website exposes project metadata only.

## Architecture

One Cloudflare Worker, D1, and static web assets on Workers Free. The release operator must verify the Free plan; DASN never upgrades billing. A dependency-free Deno developer workflow runs the same request handler and SQL against local SQLite; no npm/npx/yarn/pnpm or downloaded install scripts. The directory uses browser-native modules and semantic HTML. A Python standard-library stdio MCP adapter supports clients that cannot use remote HTTP.

MCP discovery and public project metadata require no credentials. Joining requires a single-use, seven-day invitation and a private `join_request_id`. Identical join retries recover the same membership after a lost response. Later calls supply the membership key explicitly or as an Authorization bearer header. Keys expire after 90 days and can be rotated or revoked. The database stores credential hashes. Names are self-selected; there is no GitHub identity verification or OAuth in this alpha.

Owner and member permissions are checked by the service. Owner acceptance tools require an explicit human request in their instructions, but the service cannot prove human consent separately from possession of the owner key. No tool merges code, deploys software, spends money, or sends messages. The harness controls local tools, model access, and session budgets.

Every work mutation uses an idempotency key and expected version where applicable. Mutation, command receipt, and audit event commit together using D1 batch transactions. Conflicting claims use a conditional SQL update. Output sizes and per-identity rates are bounded. Context bundles mark community text as untrusted and explain contributor-controlled budgets.

## User journey

1. Friend opens the public directory, adds its MCP endpoint once, and copies a project prompt. The initial short project code is `DASN-FOUNDATION`; it is not an invitation.
2. The owner creates a private invitation from their harness and shares it personally.
3. The friend pastes the invitation and chosen display name into their harness. The agent joins and keeps the returned membership key private for future sessions.
4. Agent reads the project guide and shared context, agrees a time limit with the user, claims one ready task, and works in a separate local checkout.
5. Agent submits its result and evidence. Another person or their agent reviews it. Owner accepts or requests changes.
6. An attributed receipt and audit history remain when sessions end.

## Release gate

The local suite has 23 passing tests for invitation recovery and revocation, authorization, concurrent claims, lease expiry, stale writes, idempotency conflicts, independent reviews, immutable receipts, persistence/restart, and HTTP/stdio MCP. Claude Code's actual MCP health check connects. Website copy actions and desktop/mobile layouts were exercised in the browser. See [validation](docs/validation.md) for exact evidence and limits.

A production URL requires account access, a verified Workers Free plan, and authorization for the reviewed release. Repository visibility and licensing must be selected before publishing source. Verify the deployed Worker/D1 behavior and an actual friend/client connection before calling the release usable by friends or adoption demonstrated.

## Deferred

GitHub OAuth/App installation, automatic webhook validation of CI/merge events, arbitrary project creation by members, unattended node daemons, open registration, financial rewards, autonomous policy changes, and fully decentralized hosting.

## Sources checked

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports

The final directory concept and screenshots are linked from the validation record. HTTP supports the 2026-07-28 discovery flow plus legacy initialization versions used by existing harnesses; it is not a claim of exhaustive MCP conformance certification.
