# Rising to Ultima private Mac release preparation

Status: private build/publisher onboarding prepared; publication blocked only
on a repository-scoped read credential and the revised exact-tag handoff.

The initial public-source proposal merged in PR #27. Run `36803534160` failed
at checkout before signing/publication because the source is private. The user
then chose to keep it private. Protected read-only check `36804660647` returned
200 for Butts and 404 for Judah's repository, approved commit, and Actions
metadata. No game release or portal deployment has occurred.

The private publisher now selects `JUDAH_PRIVATE_ACTIONS_READ_TOKEN` only for
Rising to Ultima, with no fallback to the existing default read token. Configure
it in `game-release-production` with Contents read, Actions read, and metadata
read for `judaheland-dev/Rising-to-Ultima`. Never copy local collaborator write
credentials into release automation.

- Private source: `judaheland-dev/Rising-to-Ultima`, remote `main`.
- Approved gameplay baseline: `7e8056ac722b7f1c8db5109c41584b718f64c9ab`.
- Source committer date: September 21, 2026 (America/Los_Angeles).
- Proposed first immutable version: `v1.0.0`.
- Target: signed/notarized universal macOS, bundle `com.gregeland.risingtoultima`.
- Proposed catalog route: `/download/rising-to-ultima/mac`.

## Private handoff

The portal has a fixed private registry entry, Mac-only profile, separate source
read token selection, and its existing exact-tag candidate/digest verification.
Rising to Ultima has been removed from the public publisher. The catalog remains
Mac-only with Judah's screenshot and the stable Mac download route.

The source onboarding adds the credential-free repository template, Mac export
preset, Apple Silicon texture imports, disposable raw-audio staging, regression
tests and exported-app startup validation. No gameplay script is modified. This
adds a release-scaffolding commit on top of the approved gameplay snapshot; its
exact merged SHA must be recorded/approved before a v1.0.0 tag is created.
The source stays private on Judah's account, and receives no Apple, R2 or
Cloudflare credential. The tag-triggered candidate remains a private prerelease
with a constrained unsigned Mac package and zero Actions artifacts.

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

Local startup/headless checks do not establish a full downloaded-Mac playthrough
or physical keyboard/mouse performance acceptance. The first release still
requires protected signing, notarization, immutable publication, catalog
deployment, and live source/version/download verification after approval.
