# Dependency audit register

## 2026-08-02 — Next.js transitive PostCSS and sharp advisories

`npm audit --omit=dev` reports three high-severity findings through
`next@16.2.11`:

- PostCSS `8.4.31`: GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, and
  GHSA-r28c-9q8g-f849.
- sharp `0.34.5`: GHSA-f88m-g3jw-g9cj.

Current reachability is constrained:

- StoryBridge does not accept, transform, or render user-controlled CSS or
  source maps. PostCSS only processes trusted repository CSS during builds.
- StoryBridge does not use `next/image`, configure remote image sources, or
  process user-controlled images. The vulnerable sharp path is not currently
  reachable.

No safe automated remediation is available. `next@16.2.12` remains pinned to
PostCSS `8.4.31` and allows sharp `^0.34.5`; npm's suggested fix is an unsafe
major downgrade to Next.js 9. Do not use `npm audit fix --force` or add a
transitive override without Next.js compatibility evidence.

Review again by **2026-08-09**, before production launch, and immediately if
the application adds user-controlled CSS, source maps, image uploads, remote
images, or `next/image`.

Sources:

- https://github.com/advisories/GHSA-qx2v-qp2m-jg93
- https://github.com/advisories/GHSA-6g55-p6wh-862q
- https://github.com/advisories/GHSA-r28c-9q8g-f849
- https://github.com/advisories/GHSA-f88m-g3jw-g9cj
