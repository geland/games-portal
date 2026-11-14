# Dragons VS. Vikings v1.0.0

Status: published November 14, 2026, browser only. The Gregeland Games card
credits **By Jane**. Game source remains private; Mac and Windows downloads
are deferred.

Play: https://games.gregeland.com/play/dragons-and-vikings

## Release identity

- Private source: `geland/dragons-and-vikings`.
- Original gameplay baseline: `4d2341ff67f064006c77fed5979c24e0db5553c3`.
- Released source: `b1b739df0b4a9e47a115faa1270f9687409526a6`.
- Immutable annotated tag: `v1.0.0`; tag object
  `3fdeca190d481f0c1ae903e1bd9f8b3cd36eaf03`.
- Exact-main validation: `43630257726`, successful full six-audit game gate,
  34 source release-tool tests, staged Web export and structural inspection.
- Tag-triggered candidate: `43630603312`, successful `push` event from the
  exact released SHA, workflow `.github/workflows/release.yml`.
- Private prerelease asset: `dragons-and-vikings-v1.0.0-web.gpkg`,
  83,697,047 bytes, SHA-256
  `4e3c340ed9920b7573a0bda115b951ef6ead450f21da337828095ede4ab69c76`.
  Exactly one complete digest-bearing asset; zero Actions artifacts.
- Portal onboarding: PR #34, merged as
  `bb277b5a942b71ebe525a0b0112863d44f36ab1d`.
- Protected publisher: `43630893981`, profile `web`, resume disabled, from that
  protected portal commit. All native download/signing steps were skipped.
- Catalog deployment: `43631022765`, successful from the same portal commit.
  The public `deploy-id.txt` independently matches it.
- Publication timestamp: `2026-11-14T19:13:45.088Z`.

The owner approved the tested browser candidate and Jane attribution. CI caught
an omitted shared signing helper referenced by two generic release-tool tests;
the final source restores that unchanged helper only. Gameplay and enabled
release targets did not change. Two stale game-audit fixtures were corrected
before approval to reflect actual mouth-plane crossings and unpaid post-raid
waiting. Original ObjectDB cleanup warnings remain in two native audit exits.

## Credential separation

The protected access check initially could not read the new repository. After
explicit owner confirmation and owner-completed GitHub authentication, the
existing Gregeland Games release reader gained only Jane's repository. Its
Actions, Contents and Metadata permissions remain read-only; the six existing
repository selections and August 26, 2027 expiration were preserved.
Protected check `43630401683`, attempt 2, passed all eight HTTP 200 checks.
No credential value was read or copied, and no production secret was added to
the private source repository.

## Production verification

- Cache-busted stable and immutable version manifests agree on v1.0.0 and the
  exact released source. Only the Web target is advertised.
- All nine advertised files, totaling 83,695,275 bytes, passed size/hash,
  content-type and immutable one-year caching checks. Eight match raw bytes;
  the HTML matches the origin hash after removing only the one explicitly
  identified Cloudflare JavaScript-detection injection (1,114 bytes).
- Stable cache policy remains `max-age=14400`. The public play route is a
  `no-store` 302 to the immutable v1.0.0 Web entry. WASM is served as
  `application/wasm`.
- Real Chrome on this Mac opened the public route, rendered the title and
  tutorial, advanced the walking lesson with keyboard input, entered the
  dragon nest and Berk, saved, reloaded, and continued back into saved Berk.
  Captured game and catalog warning/error logs are empty.
- The live catalog visibly shows **By Jane**, v1.0.0, Updated Nov 14, 2026,
  and only the browser play action. Its metadata API reports the released SHA.
- The Web preset uses the existing Compatibility renderer without threads,
  extensions or a service worker. Packed worlds and runtime JSON are included;
  editor-only terrain-generation input is excluded. The PCK is 45,629,496
  bytes and WASM is 37,695,054 bytes.

Controls require a keyboard. Saves belong to the website/browser profile and
do not sync between devices; clearing site data can lose progress. Physical
Windows, Safari, iPad/iPhone, touch controls, audio-listening acceptance and
extended gameplay/performance acceptance remain unverified.

Local verification JSON, downloaded HTML/origin comparison, CI metadata and
screenshots are under the source checkout's ignored `build/live-v1.0.0/`.
