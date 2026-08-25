# Cloudflare resources

The production layout uses two public hostnames:

- `games.gregeland.com`: Worker `gregeland-games` plus Workers Static Assets;
  its custom domain is lifecycle-managed by Terraform.
- `play.games.gregeland.com`: custom domain for R2 bucket
  `gregeland-games-releases`.

The Worker executes only for stable play/download redirects and the motion
tracker redirect. Ordinary portal assets are served as static assets. Large
Godot artifacts are served directly by R2 so they do not consume Worker
requests or hit the Workers 25 MiB static-file limit.

The R2-managed `r2.dev` URL stays disabled. Versioned objects have immutable
one-year cache metadata. Stable manifests are read through the Worker's R2
binding so their redirects change immediately without depending on edge-cache
invalidation.

Before managing cache or response-header rules with Terraform, inventory and
import the existing zone phase ruleset. A `cloudflare_ruleset` resource owns the
entire phase; applying an incomplete resource can remove unrelated rules.

Default Godot Web builds should be single-threaded for the broadest Safari and
iOS compatibility. If a game later needs threaded Web exports, reserve a
separate path and add COOP/COEP only there. Do not apply COEP to the motion
tracker paths because their MediaPipe dependencies come from CDNs.
