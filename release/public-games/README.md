# Public-source game releases

The public portal repository is the protected release authority for the
currently approved releasable games in Judah's existing public repositories.
The source repositories stay public and never receive Apple or Cloudflare
credentials. Public visibility grants no write or release authority.

`registry.json` is the complete allowlist. The manual workflow does not accept
an arbitrary repository, slug, configuration path, or branch name. A release
operator selects one of the fixed enabled games and supplies:

- the exact lowercase 40-character commit SHA already present in that public
  repository;
- an unused `vMAJOR.MINOR.PATCH` version; and
- `resume_existing=true` only when continuing the same verified partial
  release.

## Trust boundary

The `build-public-game` job has no GitHub environment and receives no Apple or
R2 secret. It checks trusted portal tooling and public source out to separate
directories, verifies both exact commits, stages disposable project copies,
and builds Web and unsigned universal Mac outputs. Astro Bro receives a
trusted, single-threaded Compatibility Web preset in the disposable stage
because its selected public commit contains only a Mac preset.
Astro Bro's same release also builds that committed `macOS` preset as
`Astro Bro.app`. The trusted Mac stage replaces `com.local.*` bundle
identifiers and version metadata without modifying the public repository.

The build job packages outputs into a constrained Gregeland container and
uploads only those explicitly named package files. The container format stores
regular files only and records every path, size, mode, and SHA-256 digest.

The `sign-and-publish` production-environment job runs on a fresh runner. It
checks out only the exact portal commit that defined the workflow; it never
checks out public source and never runs source-provided scripts. Trusted
unpacking rejects absolute/traversing paths, symlinks, hardlinks,
multiple/renamed app roots, unexpected downloaded files, oversized artifacts,
identity mismatches, and byte-digest mismatches before signing. It then signs,
notarizes, staples, archives, and publishes with the existing conditional R2
publisher. Immutable objects are verified byte-for-byte and `stable.json`
remains the final write.

These workflow checks are defense in depth, not the production trust anchor.
Before adding any release secret, the public portal repository **MUST** protect
the `main` branch and configure the `game-release-production` environment to deploy from
selected branch `main` only. The owner explicitly approved single-operator
releases without an independent GitHub environment reviewer on 2026-08-25.
That accepted risk does not relax manual dispatch, exact source identity,
fresh-runner isolation, or separate least-privilege credentials. If the
repository cannot enforce the branch and environment restrictions, do not
store the release secrets or run this privileged workflow. Code in this
repository cannot prove that those external GitHub settings are enabled.

Astro Bro and Tower Defense are enabled for both Web and signed/notarized Mac
releases. Racing Maze is Mac-only; Web additionally requires its separate
compatibility/performance gate. A Web configuration does not replace physical
Safari/controller/audio acceptance testing.
Tower Defense's source repository runs its placement regression during the
unprivileged build, before any production credential is available. Racing
Maze's selected baseline is present on its public remote.

## Required protected environment

After the protected-`main` and main-only deployment-branch controls above are
enabled, configure the `game-release-production` environment on this public
repository with:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
APPLE_DEVELOPER_ID_P12_BASE64
APPLE_DEVELOPER_ID_P12_PASSWORD
APPLE_TEAM_ID
APPLE_NOTARY_KEY_P8_BASE64
APPLE_NOTARY_KEY_ID
APPLE_NOTARY_ISSUER_ID
```

Repository variables:

```text
R2_BUCKET=gregeland-games-releases
R2_PUBLIC_BASE=https://play.games.gregeland.com
```

Use one dedicated bucket-scoped R2 parent credential for this central release
workflow. The publisher derives a two-hour credential scoped further to only
the selected game's version/download/manifest prefixes.

## Operator runbook

Publishing is a production mutation. Obtain explicit user approval for the
specific game, exact source SHA, version, and enabled targets before dispatch.
Approval to edit release automation is not approval to publish a game.

1. Read the selected public source repository's instructions, inspect its
   current status, and validate the exact committed snapshot. Preserve its
   ownership and visibility; do not create a private mirror or push release
   machinery or credentials into Judah's repository.
2. Record the full lowercase 40-character public source SHA. Confirm it exists
   in the fixed repository from `registry.json`. Choose an unused
   `vMAJOR.MINOR.PATCH` greater than every stable or indexed version. Never
   overwrite an existing version or use an uncommitted local tree.
3. Dispatch the protected workflow from portal `main`:

   ```sh
   gh workflow run release-public-game.yml \
     --repo geland/games-portal \
     --ref main \
     -f game=<astro-bro|racing-maze|tower-defense> \
     -f source_sha=<40-character-source-sha> \
     -f version=<version> \
     -f resume_existing=false
   ```

4. Wait for `Publish approved public-source game`. The unprivileged job must
   build and test the fixed source SHA without production credentials. The
   fresh protected job must verify the constrained handoff before any signing,
   notarization, or immutable R2 publication. `stable.json` must be last.
5. Prove production using the same cache-busted stable/immutable manifest,
   real Web screen, immutable Mac download, and physical-device caveats defined
   in the private runbook's **Prove production** section. Record the source SHA,
   workflow run, version, and evidence in `/Users/greg/Projects/PROJECT_CATALOG.md`.

Use `resume_existing=true` only after inspecting a partial failure for the same
immutable identity and verifying every existing byte. Stop on any uncertainty
about approval, repository identity, source SHA, version availability,
protected workflow identity, signing/notarization, or live results.
