# Friends-alpha release

The package is locally built and tested. **No production deployment has been performed.**

## Exact proposed external actions

1. Use Josiah's chosen Cloudflare account on **Workers Free**.
2. Create a dedicated D1 database named `dasn-friends` and initialize the reviewed schema and starter tasks.
3. Deploy a Worker named `dasn-friends` and expose its `workers.dev` HTTPS address.
4. Privately give the owner the bootstrap invitation. The owner joins from their harness and creates one invitation per friend. No messages are sent automatically.
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

The package in `dist/` must match its SHA-256 manifest. Deployment metadata is saved in `.local/cloudflare-release.json`; the initial owner invitation is saved before remote creation in `.local/cloudflare-owner-invitation.txt` so an uncertain response can be recovered. Stop on deployment errors and inspect the named resource instead of recreating it blindly.

## Live verification before inviting friends

- Check `/health`, `/api/projects`, and MCP discovery at the real HTTPS URL.
- Join with an owner invitation, save the membership key privately, and create two test member invitations through MCP.
- From separate clients, verify that only one can claim a task; release it.
- Complete one real bounded submission, independent review, and owner acceptance.
- Test Codex, Claude Code, and Cursor individually; record versions and failures honestly.
- Confirm the directory copy buttons use the public URL and the source repository is accessible to friends.
- Verify Workers Free/D1 quotas and default failure behavior. No automatic paid upgrade.

To withdraw the service, disable the Worker's workers.dev route in the dashboard, preserving D1 for recovery. A code rollback redeploys a reviewed prior bundle while preserving the database. Export/back up D1 before any future destructive migration; no destructive migrations are included here.

## Sources checked

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing and behavior at Free limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [Worker script uploads](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
- [workers.dev enable/disable API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/)
- [MCP 2026-07-28 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

Runtime quotas and prices may change; confirm the account's live plan at deployment.
