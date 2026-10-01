# Last Man Standing v1.0.0

Requested 2026-09-30: publish Caleb's private `geland/caleb-fps-game` on
`games.gregeland.com`, credited **By Caleb**. Initial preparation targets a
signed/notarized universal Mac download; browser publication is disabled.
The existing browser development preset cannot support native ENet online Explore.

## Source and portal

- Original gameplay baseline: `8776e91fc95523d15df3503f3c285e42974071f1`.
- Source onboarding PR `geland/caleb-fps-game#1` merged as
  `dca8a058baf1b0d6f7f8badd4e4df9460d303916`.
- PR validation `36807779709` passed all 16 game checks and 29 source release-tool
  tests. Exact-main validation `36808129347` passed the same complete gate.
- Release preparation checkout: `/private/tmp/caleb-fps-release`.
- Slug: `last-man-standing`; app: `Last Man Standing.app`;
  bundle ID: `com.gregeland.lastmanstanding`; engine: Godot 4.6.2.
- Portal onboarding PR #30 merged as `3976fa673e6c2a9d762d37b3332b44d49d598767`.
- Card uses an actual arena screenshot and managed stable-manifest metadata.
- Portal source remains public; the game source stays private.

## Validation and packaging

The new source release setup uses the canonical credential-free validation and
exact-tag candidate workflow. The portal alone may sign, notarize and publish.

Universal export required enabling ETC2/ASTC import. Packaged startup exposed
existing direct raw-WAV reads that fail after Godot imports/remaps those assets;
audio loading now uses imported resources, retaining sound settings and full-track
loops. The candidate workflow smoke-tests its exported executable for missing
resources and script errors.

Older regression fixtures needed to await the loading screen and reflect the
current Explore guards, recent-chunk cache, terrain, fixed raid sizes,
destination names, valid teleporter nodes and collision-safe arrivals. These
changes preserve current gameplay rules, world coordinates and save paths.
The release gate isolates saves and bounds every test process.

Portal checks passed locally: 28 Worker tests, 7 metadata browser tests,
26 private publisher tests, 23 public publisher tests, 29 shared release-tool
tests, type generation checks and both dry-run builds. PR CI `36806879108` passed.
The local app exported for arm64 and x86_64, rendered menu/arena/split-screen,
and passed packaged startup after the audio fix. Physical controller feel,
extended gameplay and two-computer networking acceptance remain unverified.

## Publication blocker

Protected access check `36807010651` returned HTTP 404 for Caleb's repository
and Actions metadata. Existing Geland source and Judah source returned HTTP 200.
The token stored as `PRIVATE_ACTIONS_READ_TOKEN` in portal environment
`game-release-production` needs the selected repository `geland/caleb-fps-game`,
with Actions read, Contents read and Metadata read. Do not copy production
credentials into the source repository or replace the protected publication path.

No version tag, production portal deployment or stable promotion has been
performed for this game. After the access update, rerun the protected check;
then tag exact source `dca8a058baf1b0d6f7f8badd4e4df9460d303916` as the unused
`v1.0.0`, verify its private Mac-only candidate, and use the canonical private
publisher with profile `mac`. Deploy the portal from then-current protected
`main` only after game publication, then verify the live catalog, manifest,
signed archive and `/download/last-man-standing/mac` route.
