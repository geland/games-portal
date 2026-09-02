# Geland Games

The family game shelf at `games.gregeland.com`.

The portal itself is served as free Cloudflare Worker static assets. Versioned
Godot Web exports and notarized macOS downloads live in the
`gregeland-games-releases` R2 bucket and are served from its public custom
domain, `play.games.gregeland.com`. Stable `/play/:game` and
`/download/:game/mac` routes resolve small validated release manifests in R2.

## Local development

```sh
npm install
npm run types
npm test
npm run dev
```

Local Wrangler uses an isolated R2 simulation. Production credentials belong in
Cloudflare/GitHub secret stores, never in this repository.

## Automatic library metadata

Managed game cards load version and update date from `/api/releases/:slug` on
page load and back/forward restoration. The read-only, same-origin endpoint
reads the same `stable.json` as Play/Download, with `no-store` caching. Promoting
a game release updates its card on the next page load without a portal deploy.
There is no GitHub token or private-repository request in the browser or Worker.

“Updated” means the published source commit's **committer date**, displayed in
America/Los_Angeles, not the newest development commit or upload time. Protected
public/private publishers fetch the exact approved SHA's date from GitHub and
require `SOURCE_COMMITTED_AT` before publication. New manifests include it as
`sourceCommittedAt`; the verified legacy SHA/date map in `src/release-metadata.ts`
supports older immutable manifests without rewriting them. An unknown legacy
commit displays its version without an invented update date.

Static card text remains the no-JavaScript/offline/error fallback. New cards
still need normal catalog edits and a portal deploy, including their managed
slug in the API allowlist. Dognado, Snake Arena, and Woberia remain external
GitHub Pages games with manually maintained build/date metadata.

Deploy the timestamp-aware portal before using the updated game publishers;
older portal validators reject the new manifest field. Do not roll the portal
back to a pre-timestamp validator after such a game release. Existing immutable
manifests remain valid and resume operations retain their original contents.

## Release layout

```text
manifests/<slug>/stable.json
manifests/<slug>/versions/<version>.json
releases/<slug>/<version>/web/<web export files>
downloads/<slug>/<version>/<notarized macOS archive>
```

Versioned objects are immutable. Update the manifest only after every object in
the new release has uploaded and passed its smoke checks.

Every `main` push and pull request runs type generation, tests, and a Wrangler
dry run. A portal deployment is a separate manual action from protected `main`.
Its `portal-production` environment uses a dedicated, account-scoped
Cloudflare Workers token. Game publication uses the separate
`game-release-production` environment and bucket-scoped R2 credentials, so a
game release cannot deploy the portal or edit DNS.

This public repository is the release authority. Game source repositories do
not receive Apple or R2 credentials. Credential-free jobs build exact source
commits and emit bounded data packages. The public-source workflow builds its
fixed Judah-owned allowlist directly; the private-source workflow accepts only
successful exact-tag candidate runs from its separate fixed allowlist. A fresh
protected runner validates package and GitHub run identity before running only
portal-owned signing and publication code.

See [`docs/ci-credentials.md`](docs/ci-credentials.md) for the exact secret and
Apple signing setup, and [`docs/release-contract.md`](docs/release-contract.md)
for the immutable artifact layout.

Reusable private Godot repository validation and unsigned-candidate files live in
[`templates/game-repo`](templates/game-repo/README.md). Copy and configure the
template only after choosing the exact release commit for a game. Private game
repositories must not receive production release credentials, and the template
never absorbs a local dirty working tree automatically.

The protected private-source handoff is documented in
[`release/private-games`](release/private-games/README.md). A manually built
candidate is validation evidence only; centrally publishable provenance
requires the exact semantic-version tag run recorded by GitHub.
The shared Motion repository has separate exact-tag workflows for its static
browser pair and its native Balloon/Labyrinth pair; central verification
requires the complete same-run pair before selecting one package to publish.

Do not copy privileged credentials into any game repository. Public-source
release configuration and its trust-boundary details
live in [`release/public-games`](release/public-games/README.md); only
credential-free validation belongs with the public source. Production release
secrets require protected `main`, a main-only `game-release-production`
environment, and the single-operator risk controls documented there.
