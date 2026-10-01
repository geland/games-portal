# Rising to Ultima v1.0.0 private Mac release

Status: published September 30, 2026. Mac download and catalog are live; source remains private.

The initial public-source proposal merged in PR #27. Run `36803534160` failed
at checkout before signing/publication because the source is private. The user
then chose to keep it private. Protected read-only check `36804660647` returned
200 for Butts and 404 for Judah's repository, approved commit, and Actions
metadata. That attempt published no objects and did not deploy the portal.

Private portal onboarding PR #29 merged as
`303c3770b48ed23b07c93b66a2e0457cde61ffa5`; source onboarding PR #1 merged as
`6ef5b5b832dfb3520a4831c464056043dbe7a31d`. Source PR CI `36805143989` and exact merged-source main CI `36805408195` passed.
The merged source differs from the approved gameplay baseline only by release
scaffolding, ignore rules, export presets, and the Apple Silicon texture setting;
GDScript gameplay, scenes, audio and game tests are unchanged. Local private
staging/import, all 44 regression checks, universal export and packaged startup
passed. Annotated tag `v1.0.0` now resolves to that exact merged source.

The private publisher now selects `JUDAH_PRIVATE_ACTIONS_READ_TOKEN` only for
Rising to Ultima, with no fallback to the existing default read token. It was
created under Judah’s account on September 30, 2026 and saved in
`game-release-production`, with Contents read, Actions read, and metadata read
for this repository only; it expires December 29, 2026. Protected access check
`36806490683` passed all four HTTP 200 checks. Never copy local collaborator write
credentials into release automation.

- Private source: `judaheland-dev/Rising-to-Ultima`, remote `main`.
- Approved gameplay baseline: `7e8056ac722b7f1c8db5109c41584b718f64c9ab`.
- Gameplay baseline committer date: September 21, 2026 (America/Los_Angeles).
- Released source committer date: September 30, 2026 (America/Los_Angeles).
- Immutable version: `v1.0.0`.
- Target: signed/notarized universal macOS, bundle `com.gregeland.risingtoultima`.
- Catalog route: `/download/rising-to-ultima/mac`.

## Private handoff

The portal has a fixed private registry entry, Mac-only profile, separate source
read token selection, and its existing exact-tag candidate/digest verification.
Rising to Ultima has been removed from the public publisher. The catalog remains
Mac-only with Judah's screenshot and the stable Mac download route.

The source onboarding adds the credential-free repository template, Mac export
preset, Apple Silicon texture imports, disposable raw-audio staging, regression
tests and exported-app startup validation. No gameplay script is modified. This
adds a release-scaffolding commit on top of the approved gameplay snapshot; its
exact merged SHA is `6ef5b5b832dfb3520a4831c464056043dbe7a31d`. The user
authorized completion through the shared browser after choosing private publication.
The source stays private on Judah's account, and receives no Apple, R2 or
Cloudflare credential. The successful tag-triggered candidate run `36806541894` is a private prerelease
with exactly one constrained unsigned Mac package and zero Actions artifacts.
`rising-to-ultima-v1.0.0-mac.gpkg` is 267,816,820 bytes with SHA-256
`cb90d34e2b2063ba2af54b94beea99d4758207bea4e11968ae1297e3997ffd93`.
The annotated tag object is `ff1d3031e942bb36714ac51cec4c8eef9b96aa58`.
Successful protected publisher run: `36806751515` from portal commit
`303c3770b48ed23b07c93b66a2e0457cde61ffa5`, Mac profile, resume disabled.

## Local evidence

- Godot 4.6.2 import and universal Mac export completed.
- Exported executable contains arm64 and x86_64 architectures.
- Packaged-app title startup completed without runtime errors after raw-audio
  staging was applied. This caught an export-only missing audio problem that
  source-only checks did not expose.
- Title/load, save-bank/round-trip, and menu navigation suites: 44 PASS checks,
  zero failures/errors; dedicated restart-autosave suite also passed.
- Portal: 27 Worker tests and seven metadata tests passed; TypeScript and both
  Wrangler deployment dry runs passed.
- Private publisher tools: 25 tests passed; remaining public publisher tools: 23 tests passed.

## Remaining acceptance and source test caveat

The committed `new_game_picker.gd` test disables save-system processing and
then repeatedly requests new games without processing the pending autosave or
clearing its real-time cooldown. It fails waiting for subsequent starts, even
with a 60 FPS cap. Its initial Normal/Dev starts pass. The dedicated
`restart_autosave.gd` explicitly handles cooldown processing and passes. No
source test or gameplay code was edited to hide these results. The stale test
needs maintenance in Judah's source repository.

Browser publication remains disabled: excavation uses `Thread.start()` while
the default hosted Web preset disables threads. Browser work needs a separate
compatibility decision and real gameplay acceptance.

Local startup/headless checks and the verified downloaded-app title screen do
not establish a full graphical playthrough or keyboard/mouse performance acceptance.


## Production proof

- Protected publisher `36806751515` passed Developer ID signing, Apple
  notarization, stapling and the final archive extraction verification before
  immutable publication and stable promotion. No existing version was resumed.
- Manual catalog deployment `36806922561` passed tests, promoted portal commit
  `303c3770b48ed23b07c93b66a2e0457cde61ffa5` to 100 percent, verified its
  production marker and confirmed the origin probe health.
- Cache-busted stable and immutable v1.0.0 manifests agree on source commit
  `6ef5b5b832dfb3520a4831c464056043dbe7a31d`. One Mac archive is advertised,
  with no Web release. Its 138,480,508 public bytes match SHA-256
  `39d6605d62952df3f1f0a152b3cac9742a956dc4d8408785ea37e6a034166f90`,
  `application/zip` and immutable caching. Stable reports `max-age=14400`.
- `/download/rising-to-ultima/mac` returns a no-store 302 to
  `https://play.games.gregeland.com/downloads/rising-to-ultima/v1.0.0/rising-to-ultima-macos-universal.zip`.
- The downloaded and extracted app passes strict/deep `codesign` verification,
  macOS Gatekeeper assessment (`Notarized Developer ID`) and stapler validation.
  Its executable contains arm64 and x86_64. Verification requires host trust
  services; the sandbox cannot resolve the signing authority.
- The downloaded app launched to the Rising to Ultima title screen. A full
  gameplay session was not performed. The live catalog shows Judah’s card,
  v1.0.0, September 30 source date and only the Mac download action; no browser
  console errors were observed.
- Verification artifacts: `/private/tmp/rtu-live/verification.json`,
  `/private/tmp/rtu-live/catalog.jpg`, `/private/tmp/rtu-live/downloaded-title.jpg`.
