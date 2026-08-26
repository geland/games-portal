# CI credentials

No production credential belongs in source control. Add these only as encrypted
GitHub Actions environment secrets in the public release-authority repository.

## Catalog repository

Use a dedicated Cloudflare API token for `games-portal`:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token needs account-level Workers Scripts write access and read access to
the `gregeland-games-releases` R2 binding. Terraform, not the deploy workflow,
owns both custom domains, so routine catalog deploys do not need DNS or Workers
Routes write access.

Store these only in the protected `portal-production` environment.

## Private game repositories

Private game repositories receive no Apple, Cloudflare, or R2 credential. Their
workflows validate source and may upload short-lived unsigned release
candidates using only the default read-only `GITHUB_TOKEN`. The central
private-source handoff uses:

- `PRIVATE_ACTIONS_READ_TOKEN`

Store it only in `game-release-production`. Use a fine-grained token or GitHub
App installation token restricted to the fixed private repositories with
Actions read, Contents read, and metadata read only. Contents read is used only
to resolve the exact Git tag and reject a same-named branch; private source is
never checked out or executed by the production job. The token must not grant
contents write, workflow write, administration, or production access. The
current repository set is exactly `geland/butts`, `geland/blend-in`, and
`geland/motion-games`; Commanders is intentionally excluded. The central workflow accepts only
a successful exact-version-tag run whose GitHub-recorded repository, workflow
path, tag, and source SHA match the approved release, then downloads artifacts
by immutable ID and verifies their server digest and constrained package
contents without executing them.

## Judah's public repositories

`judaheland-dev/astrobro`, `judaheland-dev/tower-defense`, and
`judaheland-dev/race-maze` remain public on Judah's account. Their repository
workflows may import, test, and build source, but receive no Apple certificate,
notary key, or R2 credential.

Privileged releases for enabled games run from this public repository through
`.github/workflows/release-public-game.yml`. The dispatcher must select one of
the fixed enabled repositories, an exact lowercase 40-character source commit,
and an immutable semantic version. Tower Defense is held and is not selectable.

The public commit is imported, tested, and exported only in a job with no
GitHub environment and no Apple or R2 secret. It uploads constrained data
packages containing the Web output and unsigned Mac app. The production job
runs on a fresh runner, checks out only the trusted portal commit, rejects
unsafe or mismatched packages, and executes only portal-owned signing and
publishing scripts. It never checks out the public source. See
[`../release/public-games`](../release/public-games/README.md) for the exact
boundary and allowlist.

The main-ref and workflow-SHA checks in YAML are defense in depth; they do not
prove GitHub branch or environment protection. Before any central release
secret is stored, the repository **MUST** protect `main` and the
`game-release-production` environment **MUST** allow deployment from
selected branch `main` only, require at least one reviewer, prevent self-review, and
disallow administrator bypass.

## macOS release jobs

The signing job runs on a GitHub-hosted macOS runner and imports a Developer ID
Application certificate into an ephemeral keychain. Use:

- `APPLE_DEVELOPER_ID_P12_BASE64`
- `APPLE_DEVELOPER_ID_P12_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_NOTARY_KEY_P8_BASE64`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`

Prefer an App Store Connect API key for `notarytool` rather than storing an
Apple ID and app-specific password. Limit the key's role to what notarization
needs, keep the original `.p8` offline, and rotate the CI copy if repository
access changes.

Developer ID notarization is an automated malware/signature review, not an App
Store editorial approval. A successful job must sign with hardened runtime,
submit and wait for notarization, staple the ticket to the `.app`, verify with
`codesign` and `spctl`, and only then create the downloadable ZIP.

Native iPhone/iPad distribution is a different workflow. TestFlight and App
Store releases involve provisioning profiles and Apple review; the initial
phone/tablet path for Gregeland Games is the browser build.

The privileged game workflows reference the protected
`game-release-production` environment. Portal deployment uses the distinct
`portal-production` environment. Always review workflow changes before
approving a release because trusted portal code in the approved commit receives
these credentials. Exact tags, full commit SHAs, and in-workflow ref checks
supplement—but never replace—the required GitHub branch and environment
protections.
