# Game release contract

Every public object is immutable. A release job uploads versioned artifacts,
verifies their sizes and SHA-256 digests, and writes the stable manifest last.
Moving the stable manifest is the only supported release or rollback action.

Normal release jobs abort if any immutable key already exists and use a
conditional create on every immutable write. They may publish only a version
strictly newer than every version already named by `stable.json` or the version
index; rollback is a separate explicit operation.

The complete release manifest must fit the portal's 32 KiB stable-manifest
limit, and the version index must fit the publisher's 1 MiB readback limit.
Both sizes are checked before any release artifact or manifest is written.

`play.games.gregeland.com` is intentionally uncached at the Cloudflare edge.
Before writing anything, the publisher probes a reserved missing key for every
distinct advertised directory/extension combination and fails if the origin is
no longer clearly `DYNAMIC`/`BYPASS`. Before enabling CDN caching, inventory and
import the existing zone ruleset, add a managed 404/410 TTL of zero, and redesign
the probe/recovery contract. Cloudflare otherwise caches 404/410 responses for
three minutes by default, which can hide a newly uploaded immutable object from
the public smoke check.

A deliberately selected resume may continue a partially uploaded version and
finish promoting it only when it is strictly newer than the current stable
version and no still-newer version is indexed. It never moves `stable.json`
backward; rollback is a separate operation. When the immutable version manifest
exists, its strictly validated slug, version, source, targets, and file
descriptors are authoritative; every advertised remote object is then read back
and verified against its size and SHA-256 digest. This avoids requiring a newly
signed/notarized Mac ZIP to reproduce the original ZIP bytes.
Without that immutable manifest, existing Web artifacts must match the rebuilt
bytes. An existing signed Mac ZIP cannot be resumed automatically: recovery
requires the original notarized artifact and an explicitly approved manual
procedure. Resume never overwrites immutable content.

## Slugs

- `astro-bro`
- `butts`
- `tower-defense`
- `racing-maze`
- `blend-in`
- `web-dodge`
- `motion-tracker`
- `balloon`
- `labyrinth`

## R2 keys

```text
releases/<slug>/<version>/web/index.html
releases/<slug>/<version>/web/<export files>
downloads/<slug>/<version>/<slug>-macos-universal.zip
manifests/<slug>/versions/<version>.json
manifests/<slug>/index.json
manifests/<slug>/stable.json
```

Use `Cache-Control: public,max-age=31536000,immutable` for versioned objects.
Use `Cache-Control: no-store` for `index.json` and `stable.json`. Never overwrite
a key under `releases/`, `downloads/`, or `manifests/*/versions/`.

## Stable manifest

Only include targets built successfully for that version. `entry` values are
relative to their platform directory. A Mac `key` is relative to the bucket
root.

```json
{
  "slug": "astro-bro",
  "version": "v1.0.0",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "publishedAt": "2026-08-25T12:00:00.000Z",
  "web": { "entry": "index.html" },
  "mac": {
    "key": "downloads/astro-bro/v1.0.0/astro-bro-macos-universal.zip",
    "filename": "astro-bro-macos-universal.zip"
  },
  "files": [
    {
      "key": "releases/astro-bro/v1.0.0/web/index.html",
      "size": 12345,
      "sha256": "...",
      "contentType": "text/html; charset=utf-8"
    }
  ]
}
```

The hosted tracker is published as the independent Web slug
`motion-tracker`; `/tracker` resolves that slug's ordinary Web target. This
keeps the stable-manifest schema limited to `web` and `mac`.

## Publish order

1. Validate a `vMAJOR.MINOR.PATCH` version and build from its exact commit. The
   central source workflows are manual-only. Private game repositories may use
   an exact tag or manual dispatch to build an unsigned candidate, but only the
   GitHub-recorded exact-tag run is eligible for central publication; manual
   candidates are validation evidence only.
2. Run automated tests and platform smoke checks.
3. Sign, notarize, staple, and verify every Mac application.
4. Upload Web and Mac artifacts to new version keys.
5. Verify every object's R2 metadata and full SHA-256 readback.
6. Upload the immutable version manifest. This makes a later transient
   public-origin failure safely resumable without reproducing signed ZIP bytes.
7. Check every file and MIME type through the public custom domain.
8. Update the version index.
9. Upload `stable.json` last.

Release jobs must use bucket-scoped R2 credentials. They must not receive the
Worker/DNS deployment token.
