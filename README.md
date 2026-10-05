# BlockBridge

A local-first, deliberately bounded DXF block-transfer review. It shows how retaining or overwriting same-named definitions would change incoming or existing instances, then exports a minimally renamed **donor only**. The destination is never written or included in the download.

**Verified v0.1 within the deliberately narrow profile below.** [Product verification](https://github.com/Masanori-Spec/block-bridge/actions/runs/37323082182) passed at `dbd0914401410a505349d5a225522682eeda4b03`: 143 app tests, five independent export-contract tests, 24 sandboxed desktop/mobile browser cases, 40 validator mutation controls, and 502 native assertions on the actual browser-exported donor. All 14 exact-run screenshots were visually inspected. [Machine-readable release evidence](evidence/verification.json)

The original strict zero-repair native-output audit still fails and is disclosed separately. A scoped native-behavior pass is not a repair-free merged-DXF or general CAD compatibility claim.

[Desktop preview](docs/screenshots/desktop-keep.png) · [Mobile preview](docs/screenshots/mobile-prepared.png)

## Current verification boundary

- The original strict native gate remains **FAIL**, including the [fresh strict run on the verified code commit](https://github.com/Masanori-Spec/block-bridge/actions/runs/37323082239). This is retained as a genuine result, not rewritten or converted to success.
- [Pinned QCAD diagnostic run, attempt 2](https://github.com/Masanori-Spec/block-bridge/actions/runs/37310795371), at `51500237c9d2e0aef21e8827f91f86c30adb5831`, passed 502 native geometry/structure assertions: two untouched save/reopen baselines and five paste scenarios, including post-reopen block editing and undo.
- A separate Python tag reader with exact Fraction arithmetic verified all seven saved geometries before any SDK audit mutation.
- Both untouched native-save baselines already cause 15 reported `INVALID_OWNER_HANDLE` repairs and 77 total owner normalizations in ezdxf. Prepared cases add exactly two corresponding block-record owner normalizations. This is a pinned QCAD/dxflib serialization behavior, independently reproduced without a transfer.
- The separately named native-behavior gate **passed** on the actual browser download. It checks exact frozen semantic ownership identities, full before/after snapshots, both independent saved-geometry oracles and negative mutations. Its bounded acceptance does not turn the strict zero-repair result into a pass or certify general DXF interoperability. [Native evidence](evidence/native-behavior.json) · [Browser evidence](evidence/browser-summary.json) · [Visual inspection](evidence/visual-review.json)

The product output is the original donor with approved name-token replacements. It is **not** a QCAD-resaved merged drawing. [Detailed native acceptance boundary](tests/native/BEHAVIOR_GATE.md)

## What the app does

1. Read an owner-complete destination and donor in the supported profile
2. Compare block definitions and their full nested dependencies
3. Rehearse three outcomes: original geometry, keeping destination definitions, and overwriting definitions
4. Review replacement names for differing definitions; reuse proven-equivalent definitions
5. Approve the exact source-hash-bound plan
6. Download `blockbridge-transfer.zip` with:
   - `donor-transfer.dxf`
   - `collision-map.json`
   - `preservation-report.json`

Only supported `BLOCK_RECORD` name values, `BLOCK` name values and `INSERT` references may change. Every other donor byte is checked for preservation, including numeric spelling, transforms, base points, handles, owners, record order and newline style. No whole-document CAD serialization is used.

The browser runtime is original JavaScript with no CAD SDK, network service, account, telemetry, font download or runtime dependency. File content is held in page memory. The only persisted preference is the interface language. Bundled examples are fetched locally from the same static application; selected file content is not uploaded.

## Deliberately narrow v1 profile

The initial plan considered ARC, LWPOLYLINE and arbitrary rotations. **Those are excluded from this implementation until additional independent native cases establish them.**

Accepted:
- ASCII AC1015/R2000 DXF, with explicitly matching drawing units
- Model-space LINE, CIRCLE and INSERT
- Ordinary named blocks, with resolvable explicit ownership
- Positive uniform scale and quarter-turn rotations
- Whitelisted harmless structural records, including the synthetic fixture's standard active viewport
- Supported continuous-layer properties; a conflicting same-named layer blocks export

Rejected:
- ARC, LWPOLYLINE, arbitrary rotation, nonuniform or nonpositive scale
- Text, fonts, dimensions, attributes, custom entities and unknown/dangerous tags
- Dynamic/anonymous content blocks, XREFs, cycles, missing definitions, XDATA and extension dictionaries
- Paper-space geometry, nonstandard extrusion or unsupported linetypes
- Incomplete ownership, ambiguous names, malformed records or excessive nesting/expansion

This is not a general-purpose DXF reader. A valid file from another CAD application can still contain unsupported records and be rejected. The UI never promises that an arbitrary CAD file is safe to rename. After preparation, import a copy in the intended CAD application and inspect it.

## The example

`fixtures/owner-complete/` contains original tag-authored inputs with explicit ownership. All four files have zero audit findings, identical full before/after audit snapshots, and exact geometry checks. The earlier synthetic family is retained unchanged for historical evidence.

- Destination LEAF is a horizontal 10-unit line
- Donor LEAF is a vertical 20-unit line
- Both ASSEMBLY definitions contain the same direct INSERT tags, but depend on their different LEAF definitions
- Both SAME definitions are equivalent circles and remain shared

The app renames LEAF → TRANSFER_LEAF and ASSEMBLY → TRANSFER_ASSEMBLY. Keeping destination definitions without preparation changes two incoming instances. Overwriting definitions changes one existing instance. Prepared transfer retains the three intended world-space lines and both circles while keeping blocks editable.

## Run and test

Node 22 or newer:

    npm run dev

No package installation is needed just to run the original static app. For development tests and a static build:

    npm ci
    npm test
    npm run build

Open `http://127.0.0.1:4173`. The development server serves only the original runtime files and two bundled examples, and refuses write requests. `dist/` is a seven-file static bundle.

Independent test-only Python checks use `ezdxf==1.4.4`:

    python -m pip install -r requirements-test.txt
    python tests/fixture_oracle.py
    python tests/owner_complete_audit.py
    python tests/native/behavior_selftest.py

Hosted product verification runs core tests, then sandboxed Chromium desktop/mobile flows, then a separate native QCAD source-build job. The native job consumes the same-run browser download, not a substitute hand-authored prepared file. All 14 screenshots from the verified code commit have been inspected; future releases require their own exact-run screenshot review. The original strict workflow remains distinct.

## Existing alternatives

Block renaming and dependency-aware import are established features. [QCAD](https://www.qcad.org/doc/qcad/latest/reference/en/qcad_reference_manual_en.html) offers overwrite controls and manual renaming; [ezdxf](https://ezdxf.readthedocs.io/en/stable/xref.html) offers keep/prefix policies with dependencies. Autodesk documents [same-name block-copy changes](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/AutoCAD-Copy-and-paste-dynamic-blocks-between-drawings-does-not-retain-changes-in-blocks.html), including nested blocks.

The useful difference here is the explicit transfer rehearsal, selective byte-preserving donor patch, source-bound approval and independent preservation evidence. No new import algorithm or broad compatibility claim is made.

## Rights and test-only dependencies

All rights reserved for original project material. No open-source license is granted for this project.

QCAD Community Edition is fetched only for hosted tests from official source tag `v3.33.1.0`, verified as commit `897079c2d11aaa0869f839a6cf5df8a937dbddbe`, with Ubuntu 22.04/Qt 5.15.3. Its [upstream license inventory](https://github.com/qcad/qcad/blob/v3.33.1.0/LICENSE.txt) governs QCAD and its separately licensed resources. No QCAD source, binaries, fonts, resources, examples or raw native logs are included in the application or source deliverable. Test artifacts allowlist only original observations, original app screenshots and DXFs generated from original synthetic inputs. ezdxf and Playwright are pinned test-only dependencies, not browser-runtime dependencies.
