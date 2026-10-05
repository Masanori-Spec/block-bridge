# Native feasibility gate

This directory contains an original harness, not QCAD source or a redistributable QCAD package. Native behavior has not been verified until the exact commit's hosted `Native QCAD feasibility gate` run passes. JavaScript syntax checks and the independent fixture oracle are not native-consumer evidence.

## Consumer and isolation

- Official `qcad/qcad` tag `v3.33.1.0`, dereferenced and verified as commit `897079c2d11aaa0869f839a6cf5df8a937dbddbe`
- Ubuntu 22.04's Qt 5.15.3, matching the tag's bundled script-binding configuration
- Official source build using `qmake -r CONFIG+=ractivated` and `make -j2 release`
- Community Edition source only; no Pro trial, Pro plugin, paid plan, custom credentials, or source/binary cache
- Source, dependencies' build output, native runtime logs and configuration stay in runner temporary storage and are removed
- Build and runtime failures retain only an original stage/status, exit code, allowlisted error category and optional source basename/line or identifier; never raw compiler or runtime messages
- Artifacts contain only original JSON observations and DXFs generated from this project's original fixtures. No QCAD source, binaries, resources, fonts, examples, screenshots, or raw logs are uploaded

## What is asserted

The QtScript harness calls native `RPasteOperation`, imports/exports through Community Edition's dxflib backend, and inspects native `REntity.getShapes()` results. It compares full directed line endpoints and circle centers/radii with a 1e-7 tolerance; it never infers success from an exit code, bounding box, or a custom transform implementation.

Two no-paste controls first import, save and reopen the original target and donor independently, comparing their native shapes and retained INSERT counts. This isolates baseline exporter behavior from block-transfer behavior. Five additional scenarios must pass both immediately after paste and after save/reopen:

1. Unprepared donor, retain destination definitions: the intended donor geometry changes in the exact expected way
2. Unprepared donor, overwrite destination definitions: the original target geometry changes in the exact expected way
3. Rename only outer `ASSEMBLY`: the unresolved nested `LEAF` collision still causes the exact expected corruption
4. Rename `LEAF` and `ASSEMBLY`, retain definitions: target and donor shapes are both correct
5. Rename `LEAF` and `ASSEMBLY`, overwrite definitions: target and donor shapes are both correct

Each reopened drawing must still have five native model-space INSERT entities. Both `SAME` instances must reference one shared block ID and one circle-containing definition. Both positive cases also retain each assembly's nested reference and each leaf's native editable line. A native transaction changes only `TRANSFER_LEAF` after reopening, and both dependent donor instances must change to the expected geometry while the target stays unchanged. Undo must restore the exact intended result.

The JSON report is then validated independently by `summarize.py`, which rejects missing baselines/cases, missing shapes, failed native checks, incorrect consumer provenance, and absent saved outputs.

Before any audit mutation, the original tag-reader/Fraction oracle checks all seven saved DXFs exactly and writes `saved-geometry-oracle.json`. Separately, ezdxf 1.4.4 traverses virtual INSERT entities and compares full line/circle geometry with the handwritten expectations using an explicit 1e-7 bound for serialized floating-point values. Both geometry checks are required.

The ezdxf audit requires zero errors and zero fixes for every baseline and paste output, with no exception for a known exporter limitation. It inspects all seven files even if earlier files need repairs and writes `independent-audit.json` before raising the overall failure. The artifact records exact audit codes, entity types, handles, old/new owners, and all observed in-memory owner changes, including table normalizations that ezdxf does not list as fixes. No audited document is saved. File hashes and byte-preservation checks confirm the original native outputs remain untouched.

Native shape/structure success and strict independent export-audit success are distinct results. A native pass does not override an audit failure. This is a bounded feasibility experiment, not a general claim about arbitrary DXF content.

## Primary sources checked

- [Official source compilation instructions](https://qcad.org/en/78-qcad/111-qcad-compilation-from-sources)
- [Pinned tag provenance](https://github.com/qcad/qcad/tree/v3.33.1.0)
- [Native paste options](https://github.com/qcad/qcad/blob/v3.33.1.0/src/operations/RPasteOperation.h)
- [Native paste implementation](https://github.com/qcad/qcad/blob/v3.33.1.0/src/operations/RPasteOperation.cpp)
- [Name-collision and nested block copy behavior](https://github.com/qcad/qcad/blob/v3.33.1.0/src/operations/RClipboardOperation.cpp)
- [Native recursive shape extraction](https://github.com/qcad/qcad/blob/v3.33.1.0/src/core/RBlockReferenceData.cpp)
- [Editable block reference API](https://github.com/qcad/qcad/blob/v3.33.1.0/src/core/RBlockReferenceEntity.h)
- [Native import/export and transaction API](https://github.com/qcad/qcad/blob/v3.33.1.0/src/core/RDocumentInterface.h)
- [Community Edition R15 exporter](https://github.com/qcad/qcad/blob/v3.33.1.0/src/io/dxf/RDxfExporterFactory.cpp)
- [Headless autostart entry point](https://github.com/qcad/qcad/blob/v3.33.1.0/src/run/main.cpp)
- [Ubuntu 22.04 Qt 5.15.3 package](https://packages.ubuntu.com/jammy/qt5-qmake)

No third-party example source was copied into this harness.
