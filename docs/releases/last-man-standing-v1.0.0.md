# Last Man Standing v1.0.0

Status: published September 30, 2026. The catalog card and signed/notarized
universal Mac download are live. Source remains private.

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

## Release authorization and candidate

The user authorized publication and the necessary read-only repository addition
through shared Chrome. The existing Gregeland Games private release reader now
includes the additional `geland/caleb-fps-game` repository; Actions, Contents
and Metadata remain read-only, with existing repository selections and expiration
unchanged. Protected access check `36810261775` passed all six HTTP 200 checks.
No production credential was added to the source repository.

Annotated `v1.0.0` points to exact source
`dca8a058baf1b0d6f7f8badd4e4df9460d303916`. Tag-triggered candidate run:
`36810316824` passed (Mac only, event `push`, workflow `.github/workflows/release.yml`).
The annotated tag object is `c36dfeb581a402ec5e105056b8f250ef21d7805b`.
The private prerelease contains exactly one uploaded package and zero Actions
artifacts: `last-man-standing-v1.0.0-mac.gpkg`, 231,051,922 bytes, SHA-256
`f015bd261669a6a1ccbeb613da5b5fac358757486cb159b8938bc885fd750900`.

Protected publisher `36810622471` passed from portal commit
`639da9c3cd7817bfc0dee8309f9d94c906fe62d1`, profile `mac`, resume disabled.
Developer ID signing, Apple notarization, stapling, final archive verification,
immutable publication and stable-last promotion all passed.

## Production proof

- Manual catalog deployment `36810881868` passed, publishing portal commit
  `639da9c3cd7817bfc0dee8309f9d94c906fe62d1` and verifying its production marker.
- Live Chrome catalog shows Last Man Standing, By Caleb, v1.0.0, September 30
  source date, the arena screenshot and only the Mac download action. No browser
  warnings or errors were observed.
- Public download: https://games.gregeland.com/download/last-man-standing/mac.
- Stable reports exact source `dca8a058baf1b0d6f7f8badd4e4df9460d303916`.
  The immutable archive is 107,481,864 bytes, SHA-256
  `783e3d2f91f67f24cd0d9903767c02274739b51fafe7733ddfd19c40e4834904`.
- The download route returns a no-store 302 to the immutable v1.0.0 archive.
  Live metadata matches the released source/date and the deployed portal marker
  matches the deployment commit. The archive responds with ZIP MIME, expected
  size, immutable caching and HTTP 206 range support.
- The protected macOS runner extracted the final archive, verified its signature
  and stapled ticket, and passed Gatekeeper as `Notarized Developer ID` before
  publication. A full independent local download stalled; its full-byte hash
  and downloaded-app launch remain unverified. This does not replace physical
  controller, extended gameplay or two-computer networking acceptance.
- Evidence: `/private/tmp/caleb-live/catalog.jpg` and
  `/private/tmp/caleb-live/verification.json`. Partial download files are not
  playable releases.
