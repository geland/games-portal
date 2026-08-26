# Public-source game releases

The private portal repository is the privileged release authority for Judah's
three existing public game repositories. The source repositories stay public
and never receive Apple or Cloudflare credentials.

`registry.json` is the complete allowlist. The manual workflow does not accept
an arbitrary repository, slug, configuration path, or branch name. A release
operator selects one of the three fixed games and supplies:

- the exact lowercase 40-character commit SHA already present in that public
  repository;
- an unused `vMAJOR.MINOR.PATCH` version; and
- `resume_existing=true` only when continuing the same verified partial
  release.

## Trust boundary

The `build-public-game` job has no GitHub environment and receives no Apple or
R2 secret. It checks trusted portal tooling and public source out to separate
directories, verifies both exact commits, stages disposable project copies,
and builds Web and unsigned universal Mac outputs. Astro Bro and Tower Defense
receive a trusted, single-threaded Compatibility Web preset in the disposable
stage because their public repositories currently contain only a Mac preset.
The trusted Mac stage replaces `com.local.*` bundle identifiers and version
metadata without modifying the public repository.

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
Before adding any release secret, the private portal repository **MUST** protect
the `main` branch and configure the `production` environment to deploy from
selected branch `main` only, require a reviewer, and prevent self-review. If the
current GitHub plan cannot enforce all of those controls for this private
repository, do not store the release secrets or run this privileged workflow.
Code in this repository cannot prove that those external GitHub settings are
enabled.

Racing Maze is Mac-only until its separate Web compatibility/performance gate
passes. The two trusted Web configurations do not replace physical
Safari/controller/audio acceptance testing.

The public `judaheland-dev/race-maze` repository currently exists but is empty,
so its selected local baseline must be pushed there before this workflow can
check out that SHA. Tower Defense's selected release commit likewise must exist
on its public remote before dispatch.

## Required private-repository environment

After the protected-`main`, main-only deployment branch, required-reviewer, and
no-self-review controls above are enabled, configure the `production`
environment on this private repository with:

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
