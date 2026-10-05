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

Five scenarios must pass both immediately after paste and after save/reopen:

1. Unprepared donor, retain destination definitions: the intended donor geometry changes in the exact expected way
2. Unprepared donor, overwrite destination definitions: the original target geometry changes in the exact expected way
3. Rename only outer `ASSEMBLY`: the unresolved nested `LEAF` collision still causes the exact expected corruption
4. Rename `LEAF` and `ASSEMBLY`, retain definitions: target and donor shapes are both correct
5. Rename `LEAF` and `ASSEMBLY`, overwrite definitions: target and donor shapes are both correct

Each reopened drawing must still have five native model-space INSERT entities. Both `SAME` instances must reference one shared block ID and one circle-containing definition. Both positive cases also retain each assembly's nested reference and each leaf's native editable line. A native transaction changes only `TRANSFER_LEAF` after reopening, and both dependent donor instances must change to the expected geometry while the target stays unchanged. Undo must restore the exact intended result.

The JSON report is then validated independently by `summarize.py`, which rejects missing cases, missing shapes, failed native checks, incorrect consumer provenance, and absent saved outputs. It also loads all five saved DXFs with ezdxf 1.4.4, requires zero audit errors and zero automatic fixes, and independently traverses virtual INSERT entities to compare full line/circle geometry to the handwritten expectations. This saved-output check uses the same explicitly documented 1e-7 tolerance for serialized floating-point coordinates/rotations; the input-fixture oracle retains exact Fraction arithmetic. Only counts and pass/fail facts from this secondary audit enter the summary. This is a bounded feasibility experiment, not a general claim about arbitrary DXF content.

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
