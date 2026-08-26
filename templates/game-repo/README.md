# Gregeland Godot game repository template

This directory is copied into a private game repository. It validates a Godot
4.6.2 project on ordinary pushes and publishes immutable Web and/or universal
macOS releases only from an exact semantic version tag or an explicitly
dispatched commit.

The template is Gregeland-specific: it publishes to the existing
`gregeland-games-releases` R2 contract consumed by `games.gregeland.com`.
It does not deploy the portal, edit DNS, create repositories, or create tokens.

## Install it in a game repository

1. Copy the contents of this directory, including `.github` and the two
   `.gregeland-release*` files, into the game repository. Do not replace the
   game's existing `.gitignore`; merge any needed generated-output rules.
2. Edit `.gregeland-release.json`:
   - use the slug from the portal release contract;
   - set `projectPath` relative to the repository root;
   - enable only approved targets;
   - match the existing export preset names and Mac bundle name;
   - point `mac.entitlements` at a tracked plist only when the app actually
     needs hardened-runtime exceptions.
3. Ensure `export_presets.cfg` is tracked. A Web preset must be single-threaded,
   use the Compatibility renderer, and not enable extensions or PWA mode. A Mac
   preset needs a unique bundle identifier. The release verifies that the
   exported executable contains both `arm64` and `x86_64` slices.
4. If the project has automated tests, copy `scripts/ci-test.sh.example` to
   `scripts/ci-test.sh` and replace the example command. The workflow supplies
   `GODOT_BIN`.
5. If other development-only content must be removed, copy
   `scripts/ci-sanitize-stage.sh.example` to `scripts/ci-sanitize-stage.sh`.
   Its arguments are a disposable copy under `RUNNER_TEMP` and the target name
   (`web` or `mac`). The built-in
   sanitizer already excludes `addons/godot_ai` and removes its editor plugin
   and `_mcp_game_helper` autoload from the staged `project.godot`; the source
   checkout is never modified. Web and Mac always receive separate fresh
   stages, so a Web-only Compatibility override cannot downgrade the Mac build.

Run the release-tool tests locally with Node 24:

```sh
npm ci --prefix .github/release-tools --ignore-scripts --no-audit
npm test --prefix .github/release-tools
```

## GitHub configuration

Create repository variables:

```text
GAME_SLUG=<same value as .gregeland-release.json>
R2_BUCKET=gregeland-games-releases
R2_PUBLIC_BASE=https://play.games.gregeland.com
```

Create these encrypted secrets, preferably on a `production` environment:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
APPLE_DEVELOPER_ID_P12_BASE64       # Mac target only
APPLE_DEVELOPER_ID_P12_PASSWORD     # Mac target only
APPLE_TEAM_ID                       # Mac target only
APPLE_NOTARY_KEY_P8_BASE64          # Mac target only
APPLE_NOTARY_KEY_ID                 # Mac target only
APPLE_NOTARY_ISSUER_ID              # Mac target only
```

Use a different Object Read & Write R2 token for each private game repository,
limited to `gregeland-games-releases`. At publish time the tool derives a
two-hour session credential limited further to `HeadObject`, `GetObject`, and
`PutObject` under only that game's release/version, download/version, and
manifest prefixes. The long-lived parent token is passed only to the publish
step. Do not reuse another application's Cloudflare token.

Configure the `production` environment with the strongest protections
available on the GitHub plan. GitHub does not offer required reviewers for
private repositories on every plan; an exact tag is still an explicit release,
and `workflow_dispatch` remains a deliberate manual gate. Review the release
commit because its workflow code receives signing and publication credentials.

## Release

For the normal path, tag the exact reviewed commit:

```sh
git tag v1.0.0 <full-commit-sha>
git push origin v1.0.0
```

The tag glob is deliberately broad because GitHub workflow globs are not
regular expressions; the authorization job rejects anything that is not
exactly `vMAJOR.MINOR.PATCH` (with no leading zeroes or suffix). A manual run
requires both that exact version and the full 40-character commit SHA.

Normal publication fails before uploading if any immutable key already exists.
Its version must also be strictly newer than every version already recorded in
the stable manifest or version index; moving stable to an older release is a
separate explicit rollback operation.
The complete release manifest must fit the portal's 32 KiB routing limit and
the version index must fit the publisher's 1 MiB readback limit; both checks
happen before any immutable upload begins.
The R2 custom origin must also remain uncached: preflight missing-object probes
cover every advertised directory/extension combination and fail closed if
Cloudflare reports cached or ambiguous behavior. The probe filename namespace
is reserved and rejected in real artifacts. Do not enable CDN caching until a
managed zero-TTL rule for 404/410 responses and an updated release recovery
contract are in place.
Each new object is also written with `If-None-Match: *`, checked through R2 by
size and a full SHA-256 readback, then the immutable version manifest is
written. Every file is next smoke-checked with its MIME type through the public
custom domain using bounded retry/backoff. The conditional version index
follows, and `stable.json` is the final write. Writing the immutable manifest
before the public smoke check makes a transient origin failure safely resumable
without trying to reproduce notarized ZIP bytes.

### Safely resume a partial release

If a transient failure occurred after one or more immutable objects uploaded,
manually dispatch the same version and commit with `resume_existing=true`.
Resume mode never overwrites an immutable key. It may finish promoting a
strictly newer verified partial release when no still-newer version is indexed,
but never moves stable backward; rollback is separate. If an immutable version
manifest exists, the publisher validates its slug, version, source commit,
targets, and every file descriptor, then treats it as authoritative and reads
every advertised remote artifact back to verify its complete SHA-256 digest.
This deliberately does not
compare a newly signed Mac ZIP with the prior ZIP because signing and
notarization are not reproducible byte-for-byte. The existing index entry and
same-version stable manifest must exactly match that authoritative manifest.

Without an immutable version manifest, automatic resume can fill gaps only
after existing Web artifacts match the rebuilt bytes. If a signed Mac ZIP
already exists, stop: automatic resume cannot establish which notarized bytes
are authoritative. Preserve/use the original notarized artifact through an
explicitly approved manual recovery procedure. Any mismatch stops for manual
investigation before mutable release pointers are written.

Do not delete partial release keys just to make a run green. Object removal is
an exceptional, separately approved operation after inspecting the failed run
and the bucket.

## What the workflow verifies

- Official Godot 4.6.2 editor and templates are downloaded from
  `godotengine/godot-builds` and checked against pinned SHA-256 digests.
- Release configuration, renderer, presets, and dev-secret hygiene are checked.
- Import and project-specific headless tests run against a sanitized stage.
- Web output must include non-empty HTML, JavaScript, PCK, and valid WebAssembly.
- Mac output is signed inside-out with a Developer ID Application identity in
  an ephemeral keychain, hardened runtime and timestamp, then notarized with
  `notarytool`, stapled, checked by `codesign`, `stapler`, and `spctl`, and ZIP
  tested before upload.
- Only successfully built targets appear in the release manifest.

The automated checks do not replace real Safari/iPhone/iPad, controller, audio,
camera, LAN, or fresh-Mac launch acceptance tests. Native iOS/TestFlight/App
Store distribution is outside this template.
