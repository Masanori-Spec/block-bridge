# BlockBridge — native feasibility gate

**This repository currently contains an original synthetic feasibility test, not a finished app. Native QCAD results are pending. No browser application or production DXF importer has been built.**

The proposed utility reviews the effect of transferring ordinary named DXF blocks into an existing drawing. Reusing a conflicting definition can change incoming geometry; overwriting it can change existing geometry. Nested blocks make the problem harder: identical outer definitions can depend on different same-named inner blocks.

## Go/no-go evidence

Before building the UI, the hosted workflow must establish all of the following using a pinned, source-built QCAD Community Edition:

1. Keeping the destination definitions reproduces the expected incoming-geometry corruption
2. Overwriting definitions reproduces the expected existing-geometry corruption
3. Renaming both conflicting donor dependencies preserves all handwritten expected geometry
4. Renaming only the outer block remains insufficient
5. Prepared geometry survives native save and reopen with named editable INSERT references intact, and the equivalent SAME circle block remains shared

The native assertions inspect transformed LINE and CIRCLE shapes rather than accepting only an exit status or bounding box. Original Python Fraction arithmetic independently checks the fixture coordinates and verifies that the prepared donor changes exactly nine approved block-name tokens, preserving every other byte. Pinned ezdxf is an additional test-only structural audit.

Current local checks: exact fixture oracle and ezdxf 1.4.4 structural audit pass. These are not native-consumer evidence and do not establish product readiness.

## Synthetic case

All fixtures are authored for this project and contain no customer data.

- Target LEAF: a horizontal line from (0, 0) to (10, 0)
- Donor LEAF: a vertical line from (0, 0) to (0, 20)
- Both ASSEMBLY definitions insert LEAF at (5, 5), scale 2, rotation 90 degrees
- Target inserts ASSEMBLY at (100, 0); donor inserts ASSEMBLY at (0, 100)
- Donor also inserts LEAF at (50, 50), scale 0.5, rotation 180 degrees
- Both drawings contain equivalent SAME circle definitions, centered at (2, 2), radius 3

The prepared donor renames LEAF to TRANSFER_LEAF and ASSEMBLY to TRANSFER_ASSEMBLY while retaining SAME. The merged expected lines are (105, 5) → (105, 25), (5, 105) → (-35, 105), and (50, 50) → (50, 40). Expected circles are (202, 2), radius 3 and (2, 2), radius 3.

## Proposed product boundary, conditional on the gate

The future browser runtime would use original JavaScript/TypeScript, with no CAD SDK. Inputs would remain on-device; the destination input would never be modified. Outputs would be a minimally renamed donor DXF, input-hash-bound collision map, and preservation report after explicit review.

The initial profile is intentionally narrow: ASCII AC1015/R2000 DXF; model space; declared matching units; ordinary named blocks; 2D LINE, CIRCLE, ARC, LWPOLYLINE and INSERT; positive uniform insert scales and ordinary rotations. Conflicting layer properties would block export. Dynamic/anonymous blocks, XREFs, cycles, custom entities, XDATA/extension dictionaries, attributes, fonts/text, dimensions, nonempty paper space, unsupported linetypes/extrusion and unknown records would be rejected rather than silently altered.

## Existing alternatives and useful difference

Block renaming and dependency-aware import are established features, not novel inventions. [QCAD](https://www.qcad.org/doc/qcad/latest/reference/en/qcad_reference_manual_en.html) provides block/layer overwrite controls and manual renaming. [ezdxf's XREF module](https://ezdxf.readthedocs.io/en/stable/xref.html) already provides keep and prefix collision policies with dependencies. Autodesk documents [same-named block copy changes](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/AutoCAD-Copy-and-paste-dynamic-blocks-between-drawings-does-not-retain-changes-in-blocks.html), including nested-block renaming.

The proposed distinction is a reviewable transfer rehearsal: direct and inherited collisions, actual incoming/existing geometry impacts for keep/overwrite policies, selective name changes, and independently checked preservation evidence. This repository currently validates only feasibility fixtures, not that full workflow.

## Reproduce

Run the native-gate GitHub Actions workflow. The native consumer is fetched and compiled only inside its hosted test job. Local lightweight checks:

    python scripts/create_fixtures.py
    python tests/fixture_oracle.py
    python -m pip install -r requirements-test.txt
    python tests/structural_audit.py

## Distribution and rights

All rights reserved for original project material. No new open-source license has been granted.

QCAD Community Edition is a test-only GPLv3 consumer fetched from the official `qcad/qcad` source tag `v3.33.1.0`. Its [upstream license inventory](https://github.com/qcad/qcad/blob/v3.33.1.0/LICENSE.txt) also describes separately licensed resources. No QCAD source, binaries, fonts, resources, examples, documentation or raw native logs are distributed in this repository or app output. ezdxf is likewise a test-only dependency fetched from its ordinary package registry, not bundled in the product.
