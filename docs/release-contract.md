# Game release contract

Every public object is immutable. A release job uploads versioned artifacts,
verifies their sizes and SHA-256 digests, and writes the stable manifest last.
Moving the stable manifest is the only supported release or rollback action.

## Slugs

- `astro-bro`
- `butts`
- `tower-defense`
- `racing-maze`
- `blend-in`
- `commanders`
- `web-dodge`
- `balloon`
- `labyrinth`

## R2 keys

```text
releases/<slug>/<version>/web/index.html
releases/<slug>/<version>/web/<export files>
releases/<slug>/<version>/tracker/index.html
releases/<slug>/<version>/tracker/<tracker files>
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
  "web": { "entry": "index.html" },
  "mac": {
    "key": "downloads/astro-bro/v1.0.0/astro-bro-macos-universal.zip",
    "filename": "astro-bro-macos-universal.zip"
  }
}
```

Motion Dodge may also include a tracker target:

```json
{
  "slug": "web-dodge",
  "version": "v1.0.0",
  "web": { "entry": "index.html" },
  "tracker": { "entry": "index.html" }
}
```

## Publish order

1. Validate a `vMAJOR.MINOR.PATCH` tag and build from its exact commit.
2. Run automated tests and platform smoke checks.
3. Sign, notarize, staple, and verify every Mac application.
4. Upload Web and Mac artifacts to new version keys.
5. Check remote content type, size, and SHA-256 metadata.
6. Upload the immutable version manifest.
7. Update the version index.
8. Upload `stable.json` last.

Release jobs must use bucket-scoped R2 credentials. They must not receive the
Worker/DNS deployment token.
