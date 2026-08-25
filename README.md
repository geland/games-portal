# Gregeland Games

The public family arcade at `games.gregeland.com`.

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

## Release layout

```text
manifests/<slug>/stable.json
manifests/<slug>/versions/<version>.json
releases/<slug>/<version>/web/<web export files>
downloads/<slug>/<version>/<notarized macOS archive>
```

Versioned objects are immutable. Update the manifest only after every object in
the new release has uploaded and passed its smoke checks.

The `main` branch deploys after type generation, tests, and a Wrangler dry run
all pass. Pull requests run the same quality gate without production access.
Production uses a dedicated, account-scoped Cloudflare Workers token; game
release jobs use bucket-scoped R2 credentials and cannot deploy the portal or
edit DNS. Private game repositories may run their own privileged release job.
Judah's public repositories receive credential-free validation only; their
Apple signing and R2 publication will run from this private repository against
an explicit public source commit SHA once the central workflow is installed.

See [`docs/ci-credentials.md`](docs/ci-credentials.md) for the exact secret and
Apple signing setup, and [`docs/release-contract.md`](docs/release-contract.md)
for the immutable artifact layout.

Reusable private Godot repository CI/release files live in
[`templates/game-repo`](templates/game-repo/README.md). Copy and configure the
template only after choosing the exact release commit for a game; it never
absorbs a local dirty working tree automatically.

Do not copy the privileged release workflow or credentials into a public game
repository. Public-source releases will use the central private release
workflow; only their non-secret validation job belongs with the public source.
