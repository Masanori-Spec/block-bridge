# Scoped native behavior gate

This gate does not replace or turn green the original `native-gate.yml` strict zero-repair experiment. That experiment's native geometry/editability assertions passed, but its strict saved-output audit failed. The separate scoped criterion accepts only a precisely pinned downstream QCAD serialization limitation. It cannot establish repair-free merged DXF or broader CAD compatibility.

## Frozen acceptance

The policy is `pinned_serialization_signatures.json`, hash-pinned by `behavior_acceptance.py`. Its reviewed identities are constants, never inferred from a fresh baseline. It requires:

1. Every existing native control, provenance check, exact saved-geometry proof and byte-integrity check
2. Zero audit errors
3. Exactly the frozen 15 repair signatures: code, type, semantic dictionary path, absent old owner and correct new-owner path
4. Exactly the frozen 77 owner assignments in baseline/unprepared cases; only the specified named BLOCK_RECORD additions in outer/prepared cases
5. Complete before/after attribute, emitted-tag, header, inventory and membership snapshots showing no changes besides those owner assignments
6. Untouched native DXF bytes; no repaired document is written or substituted
7. Fail-closed mutation controls for wrong owners, same-count substitutions, non-owner changes, missing/extra records and cases, missing geometry and parser ambiguity
8. Separate results: original strict zero-repair failure remains visible; scoped native behavior may pass only when this validator succeeds

The full-snapshot collector uses a disposable document clone, restores exact original attribute presence in that clone, and verifies the observed document was not changed by snapshot collection. This avoids making inspection itself add layout defaults. Base-owner comparison is subclass-aware; it never removes arbitrary group-330 tags. Root DICTIONARY is the exact, separately checked collector-default exception whose owner assignment does not change emitted tags.

## Owner-complete inputs

`fixtures/owner-complete/` is a separate original tag-authored family. It preserves the handwritten LINE/CIRCLE/INSERT geometry and selective rename map while explicitly supplying TABLE, table-entry and BLOCK_RECORD owners and a standard active VPORT entry. The original fixture family is unchanged.

`tests/owner_complete_audit.py` proves all authored owners are explicit, point to authored records and survive SDK loading unchanged. Full audit snapshots then show zero reported errors/fixes and zero silent changes. This does not claim the SDK generates no default objects during loading. The independently authored Fraction evaluator confirms input geometry and exactly nine donor name-token edits.

## Actual browser-output chain

The product workflow must first verify its browser artifact contract and current source revision. It passes the downloaded `donor-transfer.dxf` to:

    python tests/native/run_behavior_gate.py --browser-donor artifacts/browser/export/donor-transfer.dxf --output artifacts/native-behavior

The runner checks that file against the independent nine-span byte patch, stages those exact bytes as the native prepared donor, and records all staged input hashes before and after native execution. It runs the unchanged `gate.js` with both no-paste baselines, the three corruption controls and both prepared edit/undo cases. QCAD must already have been source-built by `scripts/build-qcad.sh`; no local build or Pro trial is used.

The independent exact Fraction saved-geometry oracle runs before any in-memory audit. The original secondary ezdxf oracle also evaluates all recursive saved shapes, exact model-space INSERT count/type and handwritten geometry before audit; it is repeated afterward and must remain identical. The scoped validator then checks every native output against the frozen semantic signatures and complete snapshots. A changed consumer signature requires investigation and renewed review; counts or a generic code-202 exception never suffice.

## Evidence and limits

Only original concise JSON observations and the seven synthetic output DXFs are eligible artifacts. Consumer code/binaries/assets/fonts/examples and raw logs remain ephemeral and are never uploaded. `native-behavior.json` reports both scoped and strict results and binds the actual browser donor by SHA-256. Synthetic validator self-tests are labelled as tests of the validator, not native evidence.

The supported claim is limited to tested LINE/CIRCLE/INSERT fixtures, positive uniform scale and quarter-turn rotations. An accepted scoped gate is not proof of general import/export correctness, clean downstream serialization, or support for other CAD consumers.
