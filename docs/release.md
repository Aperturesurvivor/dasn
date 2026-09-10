# Friends-alpha release

The 0.3.0 shared workspace alpha is deployed at [DASN](https://dasn-friends.aperturesurvivor.workers.dev), with [MCP](https://dasn-friends.aperturesurvivor.workers.dev/mcp) on the same host. Its dedicated Worker and D1 database are named `dasn-friends`. Workers Free was verified in the signed-in dashboard before deployment on 2026-09-09.

The current release exposes 51 MCP tools. Live shared-file edits/history, competing writes, identical retries, project-visible requests/replies, advisory voting and contribution submission without a task all passed against D1 using two explicitly labeled scripted test clients. Their credentials were revoked and the workspace fixture archived. Its synthetic submission was returned for changes to end the verification; no independent review or acceptance was fabricated. The existing real Cursor submission remains pending at task version 5, unchanged.

A complete D1 SQL export and prior Worker bundle were saved privately before migration. The export was restored and upgraded locally, with unchanged existing tasks and a passing SQLite integrity check. The release retains the same Worker/D1 resources and Workers Free plan.

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

The package in `dist/` must match its SHA-256 manifest and current source. The deploy script applies `0001.sql`, `0002.sql` and additive workspace migration `0003.sql` before seeding. Back up D1 before upgrading and preserve the previous build. Use the [D1 SQL export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/) and poll it to completion; keep the downloaded SQL private because it contains member data and hashed credentials. The export can briefly block queries. The deployment script does not create a backup automatically. Deployment metadata is saved in `.local/cloudflare-release.json`; the initial owner invitation is saved before remote creation in `.local/cloudflare-owner-invitation.txt` so an uncertain response can be recovered. Stop on deployment errors and inspect the named resource instead of recreating it blindly.

## Verification and first-use follow-up

- Completed: `/health`, `/api/projects`, and MCP discovery at the real HTTPS URL.
- Completed: operator join, private key storage, and two temporary test-member invitations through MCP.
- Completed: separate clients contended for one task; one succeeded, one was rejected, a retry recovered the same lease, and the task was released. Test identities were disabled afterward.
- Cursor 3.19.19 completed a real bounded 0.2.0 submission. Independent review and operator acceptance remain pending.
- 0.3.0 connection/setup copying was verified for all three harnesses in the browser; fresh model-driven workspace sessions in each harness remain a follow-up.
- Completed: directory copy buttons use the public URL; source repository is public.
- Verify Workers Free/D1 quotas and default failure behavior. No automatic paid upgrade.

To withdraw the service, disable the Worker's workers.dev route in the dashboard, preserving D1 for recovery. A code rollback redeploys the reviewed prior bundle while preserving the additive database schema and newer contributions. Do not restore a pre-upgrade database over newer work without reviewing the loss. Export/back up D1 before any future destructive migration; no destructive migrations are included here.

## Sources checked

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing and behavior at Free limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [Worker script uploads](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
- [workers.dev enable/disable API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/)
- [MCP 2026-07-28 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

Runtime quotas and prices may change; confirm the account's live plan at deployment.
