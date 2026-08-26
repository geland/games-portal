# Cloudflare resources

The production layout uses two public hostnames and one authenticated service:

- `games.gregeland.com`: Worker `gregeland-games` plus Workers Static Assets;
  its custom domain is lifecycle-managed by Terraform.
- `play.games.gregeland.com`: custom domain for R2 bucket
  `gregeland-games-releases`.
- `games-release-probe.geland.workers.dev`: Worker
  `games-release-probe`, used only by the protected release environment for
  authenticated, fixed-origin `HEAD` checks.

The Worker executes only for stable play/download redirects and the motion
tracker redirect. Ordinary portal assets are served as static assets. Large
Godot artifacts are served directly by R2 so they do not consume Worker
requests or hit the Workers 25 MiB static-file limit.

The R2-managed `r2.dev` URL stays disabled. Versioned objects have immutable
one-year cache metadata. Stable manifests are read through the Worker's R2
binding so their redirects change immediately without depending on edge-cache
invalidation.

Bot Fight Mode challenges direct GitHub-hosted probes to the public R2 origin
and cannot be skipped on the current Cloudflare plan. The release probe Worker
keeps Bot Fight Mode enabled while preserving fail-closed publication checks.
It accepts only allowlisted immutable release/download keys, fetches only the
fixed R2 custom origin, never returns object bodies, and relays bounded response
metadata. Its bearer token exists only as a Worker secret and protected GitHub
environment secret.

The current zone cache rule caches successful `play.games.gregeland.com`
responses at the edge for one day and bypasses status 300-599. Missing-object
checks must return 404 with `CF-Cache-Status: BYPASS` or `DYNAMIC` and no `Age`.
Versioned objects also retain one-year immutable browser cache metadata.

Before managing cache or response-header rules with Terraform, inventory and
import the existing zone phase ruleset. A `cloudflare_ruleset` resource owns the
entire phase; applying an incomplete resource can remove unrelated rules.

Default Godot Web builds should be single-threaded for the broadest Safari and
iOS compatibility. If a game later needs threaded Web exports, reserve a
separate path and add COOP/COEP only there. Do not apply COEP to the motion
tracker paths because their MediaPipe dependencies come from CDNs.

## Cost guardrails

- Portal static-asset requests do not invoke the Worker and are free. Only the
  small stable play/download/tracker routes run Worker code.
- Keep releases in R2 Standard. Its monthly free tier includes 10 GB-month of
  storage, 1 million Class A operations, and 10 million Class B operations;
  direct R2 Internet egress has no transfer charge.
- Preserve immutable versions, but report total bucket storage after every
  release. Ask before adding a lifecycle deletion policy or spending alert.
- Do not proxy game binaries through the Worker. The direct R2 origin avoids
  Worker request usage and the 25 MiB Workers Static Assets per-file limit.
- If family usage ever approaches a free-tier limit, measure actual bucket and
  Worker analytics before changing plans or architecture.

Post-release baseline on 2026-08-26: 87 objects and 731,929,964 bytes (about
698 MiB / 0.732 GB). The Wrangler bucket-info aggregate was still stale at one
object and 115 bytes; use an S3 object inventory or wait for analytics
convergence before drawing cost conclusions from that aggregate.
