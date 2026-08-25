# CI credentials

No production credential belongs in source control. Add these only as encrypted
GitHub Actions secrets after each private repository exists.

## Catalog repository

Use a dedicated Cloudflare API token for `games-portal`:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token needs account-level Workers Scripts write access and read access to
the `gregeland-games-releases` R2 binding. Terraform, not the deploy workflow,
owns both custom domains, so routine catalog deploys do not need DNS or Workers
Routes write access.

## Game repositories

Give every game repository its own R2 S3 token, limited to Object Read & Write
on only `gregeland-games-releases`:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_ACCOUNT_ID`

Repository variables, which are not secrets:

- `GAME_SLUG`
- `R2_BUCKET=gregeland-games-releases`
- `R2_PUBLIC_BASE=https://play.games.gregeland.com`

The reusable workflow in [`../templates/game-repo`](../templates/game-repo/README.md)
checks `GAME_SLUG` against the tracked release config. It immediately derives a
two-hour R2 session credential constrained to only `HeadObject`, `GetObject`,
and `PutObject` under the selected game's version and manifest prefixes. This
limits accidental cross-game writes while keeping the persistent token limited
to the one release bucket. The persistent parent credential is still highly
sensitive and is passed only to the final publish step.

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

The workflow references a `production` GitHub environment so environment
secrets and an approval gate can be used when the account plan supports them.
GitHub's required-reviewer protection is not available for private repositories
on every plan; exact tags and manually dispatched full commit SHAs remain the
minimum release gates. Always review workflow changes before approving a release
because the selected commit's workflow code receives these credentials.
