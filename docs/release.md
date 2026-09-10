# Friends-alpha release

The 0.2.0 friends alpha is deployed at [DASN](https://dasn-friends.aperturesurvivor.workers.dev), with [MCP](https://dasn-friends.aperturesurvivor.workers.dev/mcp) on the same host. Its dedicated Worker and D1 database are named `dasn-friends`. Workers Free was verified in the signed-in dashboard before deployment on 2026-09-09.

Live health, project listing, MCP discovery, operator joining, two-client claim contention, identical retry recovery, task release, and test-credential revocation passed. Claude Code's installed HTTP connection check and the Python stdio bridge both connected to the public endpoint. The operator key is stored privately in `.local/cloudflare-owner-membership.json`. The two verification identities are disabled; all three starter tasks remain ready. No fake contribution, review, or acceptance was created.

## Deployment scope

1. Use Josiah's chosen Cloudflare account on **Workers Free**.
2. Create a dedicated D1 database named `dasn-friends` and initialize the reviewed schema and starter tasks.
3. Deploy a Worker named `dasn-friends` and expose its `workers.dev` HTTPS address.
4. Bootstrap the operator membership privately. Create one invitation per friend from the operator's harness when requested. No messages are sent automatically.
5. Source publication is authorized at `Aperturesurvivor/dasn` as a public repository. Keep invitations and the database private. Select a license separately; do not infer a license grant from public visibility.

The Worker publishes only the directory and MCP service. It receives no local development database, personal wiki, model credentials, or contact list. The deploy script rejects preexisting resources outside its own release record and never changes billing plans.

## Operator commands

Review the plan without any credentials or network access:

```sh
deno run scripts/cloudflare.mjs plan
```

Once the release is authorized, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` **locally**, not in chat or a tracked file. The token needs Workers Scripts edit, D1 edit, and the necessary account/subdomain read access, scoped to the chosen account. Check the actual account plan in the Cloudflare dashboard; the script's confirmation flag records that check but cannot itself prove billing state.

```sh
deno run --allow-env=CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_API_TOKEN \
  --allow-read=dist,migrations,.local --allow-write=.local \
  --allow-net=api.cloudflare.com \
  scripts/cloudflare.mjs deploy --confirm-free-plan
```

The package in `dist/` must match its SHA-256 manifest and current source. The deploy script applies both `0001.sql` and the additive `0002.sql` migration before seeding. Back up any existing D1 database before its first multi-project upgrade; the local development database has a pre-upgrade backup. Deployment metadata is saved in `.local/cloudflare-release.json`; the initial owner invitation is saved before remote creation in `.local/cloudflare-owner-invitation.txt` so an uncertain response can be recovered. Stop on deployment errors and inspect the named resource instead of recreating it blindly.

## Verification and first-use follow-up

- Completed: `/health`, `/api/projects`, and MCP discovery at the real HTTPS URL.
- Completed: operator join, private key storage, and two temporary test-member invitations through MCP.
- Completed: separate clients contended for one task; one succeeded, one was rejected, a retry recovered the same lease, and the task was released. Test identities were disabled afterward.
- Complete one real bounded submission, independent review, and owner acceptance.
- Test Codex, Claude Code, and Cursor individually; record versions and failures honestly.
- Completed: directory copy buttons use the public URL; source repository is public.
- Verify Workers Free/D1 quotas and default failure behavior. No automatic paid upgrade.

To withdraw the service, disable the Worker's workers.dev route in the dashboard, preserving D1 for recovery. A code rollback redeploys a reviewed prior bundle while preserving the database. Export/back up D1 before any future destructive migration; no destructive migrations are included here.

## Sources checked

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing and behavior at Free limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [Worker script uploads](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
- [workers.dev enable/disable API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/)
- [MCP 2026-07-28 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

Runtime quotas and prices may change; confirm the account's live plan at deployment.
