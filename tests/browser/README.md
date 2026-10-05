# Hosted browser verification

Run `npm ci` and `npm run test:browser` through the `BlockBridge product verification` workflow. Chromium is configured with `chromiumSandbox: true` on standard Ubuntu 22.04 hosted runners. Tests reject sandbox-disabling process flags. A restricted local-container launch is not a reason to turn the sandbox off.

The suite exercises the original synthetic owner-complete fixtures at 1440px desktop and 390px mobile widths:

- Japanese and English UI, labelled controls, live status, keyboard-only demo review and download
- Original, keep, overwrite and prepared previews with exact affected-instance counts
- Actual target/donor file inputs and a fully offline preview/export path with no new requests or WebSockets
- Deterministic repeated downloads and exact original target/donor file preservation
- Invalid/conflicting names and both required approvals bound to the current rename plan
- Reset, unsupported/version/unit-mismatch rejection and successful valid-input recovery
- Pending input replacement and deterministic late-read races, including reset and newer invalid input
- No uncaught application errors or horizontal document overflow in the captured states

The screenshots are evidence for a later image-capable review, not an automated claim of visual quality. Inspect the exact run's `blockbridge-browser-review` screenshots, including both viewport sizes and languages, before release. `summary.json` intentionally leaves visual review pending and does not claim full product readiness.

## Artifact contract

The desktop file-input test downloads the actual ZIP emitted by the UI twice, compares the downloads byte for byte, and reads only three constant entries. `artifact-contract.mjs` independently checks ZIP boundaries, stored-entry format, CRC32, duplicate/unknown names, and exact expected donor bytes. It does not import the product parser or planner.

It independently checks input/output/approved-map hashes, recomputes the plan hash from the public approval manifest, verifies the exact nine allowed name-token spans and unchanged bytes, checks direct/inherited/equivalent collision labels, and compares prepared geometry with handwritten fixture coordinates. The test writer's local-only unit tests are distinct from browser evidence and never create browser-export artifacts.

The browser job uploads only:

- `donor-transfer.dxf`, from the actual UI download
- `collision-map.json` and `preservation-report.json`, from that same download
- `browser-evidence.json`, linking their byte hashes to the exact workflow commit and original synthetic inputs

The native job downloads this same-run artifact and reruns the independent verifier before passing its donor to QCAD. There is no fallback to a reconstructed donor or to a preexisting fixture when the download is missing. The native runner separately checks the approved-token transformation again.

## Scope and independence

These tests concern only the declared initial profile: ASCII AC1015, matching units, LINE/CIRCLE/INSERT, ordinary named blocks, positive uniform scale and quarter-turn rotations. Browser success is not proof of general DXF compatibility. Native behavior and the unchanged strict zero-repair native audit are separate evidence. No source, binary, fonts, resources, raw logs or screenshots from the third-party native consumer are published by this workflow.
