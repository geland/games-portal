# Private-source release handoff

Private game repositories build exact tagged commits without production
credentials. Their candidate workflow publishes constrained Gregeland data
packages as GitHub prerelease assets, which do not consume Actions artifact
storage. It does not sign or publish the playable game.

The manual portal workflow accepts only the fixed repositories in
`registry.json`, a successful tag-triggered candidate run, its exact source
SHA, and an approved release profile. The production runner verifies the
repository, workflow path, run conclusion, source SHA, fully resolved version
tag, absence of an ambiguous same-named branch, complete
release-asset set, release-asset digests, and the identity and byte layout inside every
package before signing or publication. It never checks out or executes private
source.

`web-dodge` and `motion-tracker` share one `geland/motion-games` tag workflow
run and one private `${version}-static-candidates` prerelease. Each central release selects only its exact SHA-qualified package, while
the verifier requires both expected release assets to be present and rejects
any extra, missing, renamed, incomplete, or digest-mismatched asset. `balloon` and `labyrinth`
use the same fail-closed pattern in a separate `${version}-native-candidates`
prerelease: one exact-tag run must contain both SHA-qualified Mac packages, while a central
release selects and signs only the requested app. The native contract was
integrated against `geland/motion-games` commit
`56947de9ea16e9e4884295488101e9bb11f0e08e` and requires these exact bundle
identities:

- `Motion Balloon.app` — `com.gregeland.motionballoon`
- `Motion Labyrinth.app` — `com.gregeland.motionlabyrinth`

Both are Mac-only releases; their shared hosted tracker remains the independent
`motion-tracker` Web release.

Commanders uses the standard Web+Mac candidate contract from
`geland/commanders`. Its source workflow first stages the exact tracked runtime
allowlist, excluding local experiments and source-only assets, then verifies
the payload and size budgets before creating the constrained candidates. Its
approved bundle identity is `com.gregeland.commanders`.

Lines Drawn uses the standard Web+Mac candidate contract from
`geland/lines-drawn`. Its approved bundle identity is
`com.gregeland.linesdrawn`.

A manually dispatched candidate is useful for validation but is deliberately
ineligible for publication and creates no release assets. Publishable candidates
must come from an exact `vMAJOR.MINOR.PATCH` tag so GitHub independently records
the source SHA used by the run. Candidate prereleases remain private with their
private source repositories; public downloads continue to come only from R2.

The `game-release-production` environment must remain restricted to `main`.
The owner explicitly approved single-operator releases without an independent
GitHub environment reviewer on 2026-08-25. That accepted risk does not relax
manual dispatch, exact-tag/SHA checks, fresh production runners, or credential
separation. Its private-repository token needs only Actions read, Contents
read, and metadata read for the allowlisted repositories. Contents read covers
the approved tag and candidate prerelease assets. R2 and Apple credentials
remain separate from all game source repositories.

## Operator runbook

This is the canonical procedure for private `geland/*` game releases. Source
repositories may summarize their own validation gates and target profile, but
must link here instead of maintaining a second publication procedure.

Publishing is a production mutation. An agent must have explicit user approval
for the specific release before pushing the source commit, creating or pushing
the version tag, dispatching the protected publisher, or changing a stable
release. Approval to edit release automation is not approval to publish a game.

### Approved targets

| Game input | Source repository | Candidate workflow | Profile |
|---|---|---|---|
| `butts` | `geland/butts` | `release.yml` | `web` or `web+mac` |
| `lines-drawn` | `geland/lines-drawn` | `release.yml` | `web` or `web+mac` |
| `blend-in` | `geland/blend-in` | `release.yml` | `mac` |
| `commanders` | `geland/commanders` | `release.yml` | `web` or `web+mac` |
| `web-dodge` | `geland/motion-games` | `static-release-candidates.yml` | `web` |
| `motion-tracker` | `geland/motion-games` | `static-release-candidates.yml` | `web` |
| `balloon` | `geland/motion-games` | `native-release-candidates.yml` | `mac` |
| `labyrinth` | `geland/motion-games` | `native-release-candidates.yml` | `mac` |

The selected profile must be allowed by `registry.json` and match what the
owner approved. Do not broaden a Mac-only or Web-only release while operating
the workflow.

### 1. Freeze and validate the source

1. Read the source repository's `AGENTS.md`, `RELEASING.md`, and current status
   documentation. Inspect `git status --short`, the active branch, remotes,
   existing tags, and the release configuration.
2. Resolve unrelated or concurrent work by exclusion, not by absorbing it.
   Release only an explicitly approved, committed snapshot. A dirty worktree is
   never evidence for what a tag contains.
3. Run the repository-specific local gate from its `RELEASING.md`, plus release
   tooling tests and `git diff --check`. Push the approved commit to the source
   repository's `main` and wait for its ordinary validation workflow.
4. Record the full lowercase 40-character source SHA. Confirm remote `main`
   resolves to that SHA before tagging.

### 2. Create the immutable candidate

1. Choose a new `vMAJOR.MINOR.PATCH` greater than every stable or indexed
   version. Search both Git tags and GitHub releases first. Never move, delete,
   recreate, or reuse an existing version tag to repair a failed release.
2. Create an annotated tag at the recorded SHA and push only that tag:

   ```sh
   git tag -a <version> <40-character-source-sha> -m "<game> <version>"
   git push <source-remote> refs/tags/<version>
   ```

3. Wait for the tag-triggered candidate workflow and record its numeric run ID.
   The run must be a successful `push` run whose tag, head SHA, workflow path,
   and workflow name match the intended release.
4. Inspect the private prerelease and its complete `.gpkg` asset set. Standard
   games use candidate tag `<version>`. Motion uses
   `<version>-static-candidates` or `<version>-native-candidates`; each synthetic
   candidate tag must resolve to the same recorded source SHA. Confirm the
   candidate run's Actions artifact count is zero.

If the tag workflow fails, stop. Fix forward in a new commit and new semantic
version; do not weaken identity checks or mutate the failed tag.

### 3. Publish through the protected portal

Dispatch from protected `games-portal` `main` with the exact recorded identity:

```sh
gh workflow run release-private-game.yml \
  --repo geland/games-portal \
  --ref main \
  -f game=<game-input> \
  -f source_sha=<40-character-source-sha> \
  -f version=<version> \
  -f release_profile=<profile> \
  -f build_run_id=<candidate-run-id> \
  -f resume_existing=false
```

Wait for `Publish approved private-source game` to finish. The protected job
must verify the exact tag, candidate tag, source run, release asset set, outer
GitHub digests, and inner package identity before it signs or uploads anything.
For Mac targets it must then pass Developer ID signing, Apple notarization,
stapling, and final archive round-trip verification. Publication writes
immutable files and version metadata before promoting `stable.json` last.

Use `resume_existing=true` only to continue the same immutable identity after
inspecting the prior publisher failure and all already-written bytes. It is not
a general retry switch and must never move stable backward.

### 4. Prove production

Do not call a release complete merely because the source candidate passed.
After the protected publisher succeeds:

1. Fetch `https://play.games.gregeland.com/manifests/<slug>/stable.json` with a
   unique query string and verify its version and source commit.
2. Fetch the immutable version manifest and verify advertised Web/Mac objects,
   sizes, hashes, content types, and cache policy.
3. Open `https://games.gregeland.com/play/<slug>` for Web releases and verify a
   real game screen, not only a redirect. Check browser console errors.
4. Open `https://games.gregeland.com/download/<slug>/mac` for Mac releases and
   verify it resolves to the intended immutable archive. Signing/notarization
   automation is not a substitute for a physical Mac launch when player-facing
   acceptance is part of the release request.
5. Record the source SHA, annotated tag, candidate run, protected publisher run,
   stable version, and remaining physical-device caveats in the source handoff
   and `/Users/greg/Projects/PROJECT_CATALOG.md`.

The catalog Worker does not need redeployment for an existing managed game's
version change; cards read `stable.json`. If a game card, route, or portal code
changed, merge that portal change first and explicitly dispatch `deploy.yml` on
`main`, then verify the production deployment separately.

### Safe stop conditions

Stop without publishing if approval, source cleanliness, remote SHA, tag
identity, candidate completeness, token repository access, protected workflow
identity, notarization, immutable preflight, or live verification is uncertain.
Never work around those failures by copying credentials into a source repo,
uploading an ad hoc build, broadening a token beyond the required repository,
or overwriting an existing release.
