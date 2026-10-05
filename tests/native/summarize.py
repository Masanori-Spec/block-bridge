"""Fail-closed native validation plus complete, non-destructive audit observations."""
import hashlib
import json
from pathlib import Path
import math
import re
import sys
import ezdxf
from ezdxf.audit import AuditError

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/native"
CASES = {"unprepared-keep", "unprepared-overwrite", "outer-only-keep", "prepared-keep", "prepared-overwrite"}
BASELINES = {"target-baseline", "donor-baseline"}


class GateValidationError(AssertionError):
    """Only original, controlled validation messages may be surfaced by the runner."""
    def __init__(self, message, phase="native-report-validation"):
        super().__init__(message)
        self.phase = phase


def require(condition, message, phase="native-report-validation"):
    if not condition:
        raise GateValidationError(message, phase)


def saved_geometry(document):
    rows = []

    def visit(entities, depth=0):
        require(depth < 16, "Unexpected recursive saved block graph", "saved-geometry-before-audit")
        for entity in entities:
            kind = entity.dxftype()
            if kind == "INSERT":
                visit(entity.virtual_entities(), depth + 1)
            elif kind == "LINE":
                a, b = entity.dxf.start, entity.dxf.end
                require(abs(a.z) <= 1e-7 and abs(b.z) <= 1e-7,
                        "Saved line is not planar", "saved-geometry-before-audit")
                rows.append(["LINE", a.x, a.y, b.x, b.y])
            elif kind == "CIRCLE":
                center = entity.dxf.center
                require(abs(center.z) <= 1e-7, "Saved circle is not planar", "saved-geometry-before-audit")
                rows.append(["CIRCLE", center.x, center.y, entity.dxf.radius])
            else:
                raise GateValidationError("Unexpected saved entity kind", "saved-geometry-before-audit")
    visit(document.modelspace())
    return rows


def compare_saved(actual, expected):
    require(len(actual) == len(expected), "Independent saved DXF shape count differs from handwritten oracle",
            "saved-geometry-before-audit")
    unmatched = expected[:]
    for row in actual:
        found = next((i for i, target in enumerate(unmatched)
                      if row[0] == target[0] and len(row) == len(target)
                      and all(math.isfinite(a) and abs(a - b) <= 1e-7
                              for a, b in zip(row[1:], target[1:]))), None)
        require(found is not None, "Independent saved DXF geometry differs from handwritten oracle",
                "saved-geometry-before-audit")
        unmatched.pop(found)


def predictions():
    handwritten = json.loads((ROOT / "fixtures/expected.json").read_text())
    circles = [["CIRCLE", *row] for row in handwritten["merged_circles"]]
    line_rows = lambda key: [["LINE", *row] for row in handwritten[key]]
    target, donor = line_rows("target_original_lines"), line_rows("donor_intended_lines")
    return {
        "target-baseline": target + [circles[0]],
        "donor-baseline": donor + [circles[1]],
        "unprepared-keep": target + line_rows("unprepared_keep_target_donor_lines") + circles,
        "outer-only-keep": target + line_rows("unprepared_keep_target_donor_lines") + circles,
        "unprepared-overwrite": line_rows("unprepared_overwrite_changed_target_lines") + donor + circles,
        "prepared-keep": target + donor + circles,
        "prepared-overwrite": target + donor + circles,
    }


def audit_record(entry, before, after):
    """Record exact findings without storing external messages or repairing the file."""
    entity = entry.entity
    handle = entity.dxf.get("handle") if entity is not None and entity.is_alive else None
    entity_type = entity.dxftype() if entity is not None and entity.is_alive else None
    if handle is None:
        match = re.search(r"([A-Z][A-Z0-9_]*)\(#([0-9A-Fa-f]+)\)", entry.message)
        if match:
            entity_type, handle = match.group(1), match.group(2).upper()
    old = before.get(handle, {})
    new = after.get(handle, {})
    try:
        code_name = AuditError(entry.code).name
    except ValueError:
        code_name = "UNRECOGNIZED_AUDIT_CODE"
    return {"code": int(entry.code), "codeName": code_name,
            "entityType": entity_type or old.get("type") or new.get("type"), "handle": handle,
            "oldOwner": old.get("owner"), "newOwner": new.get("owner")}


def owner_snapshot(document):
    return {handle: {"type": entity.dxftype(), "owner": entity.dxf.get("owner")}
            for handle, entity in document.entitydb.items() if entity.is_alive}


def inspect_saved(drawing, case_id, expected):
    result = {"id": case_id, "kind": "baseline" if case_id in BASELINES else "paste",
              "savedDrawing": drawing.name, "status": "fail", "geometryPassedBeforeAudit": False}
    stage = "saved-file-read"
    failures = []
    try:
        raw_before = drawing.read_bytes()
        result["sha256"] = hashlib.sha256(raw_before).hexdigest()
        document = ezdxf.readfile(drawing)
        stage = "saved-geometry-before-audit"
        try:
            observed = saved_geometry(document)
            compare_saved(observed, expected)
            result["geometryPassedBeforeAudit"] = True
            result["worldShapeCount"] = len(observed)
        except GateValidationError as error:
            failures.append({"phase": error.phase, "message": str(error)})
            observed = None
        result["modelInsertCount"] = len(document.modelspace())
        result["allModelEntitiesAreInserts"] = all(entity.dxftype() == "INSERT" for entity in document.modelspace())
        expected_count = len(expected)
        if result["modelInsertCount"] != expected_count or not result["allModelEntitiesAreInserts"]:
            failures.append({"phase": stage, "message": "Saved model-space INSERT structure is incorrect"})
        # audit() mutates its in-memory document. Capture ownership on both sides and
        # compare shape geometry first; never write this audited document back to disk.
        before = owner_snapshot(document)
        stage = "saved-file-audit"
        audit = document.audit()
        after = owner_snapshot(document)
        result["auditErrors"] = len(audit.errors)
        result["auditFixes"] = len(audit.fixes)
        result["errorRecords"] = [audit_record(entry, before, after) for entry in audit.errors]
        result["fixRecords"] = [audit_record(entry, before, after) for entry in audit.fixes]
        result["ownerChanges"] = [
            {"entityType": before[handle]["type"], "handle": handle,
             "oldOwner": before[handle]["owner"], "newOwner": after[handle]["owner"]}
            for handle in sorted(before.keys() & after.keys())
            if before[handle]["owner"] != after[handle]["owner"]
        ]
        result["ownerChangeCount"] = len(result["ownerChanges"])
        result["entitiesAddedDuringAudit"] = len(after.keys() - before.keys())
        result["entitiesRemovedDuringAudit"] = len(before.keys() - after.keys())
        if audit.errors or audit.fixes:
            failures.append({"phase": stage, "message": "Saved DXF audit reports errors or repairs"})
        if observed is not None:
            result["geometryUnchangedByAudit"] = saved_geometry(document) == observed
            if not result["geometryUnchangedByAudit"]:
                failures.append({"phase": stage, "message": "In-memory audit changed saved geometry"})
        result["fileBytesUnchanged"] = drawing.read_bytes() == raw_before
        if not result["fileBytesUnchanged"]:
            failures.append({"phase": stage, "message": "Saved file bytes unexpectedly changed"})
    except Exception as error:
        # No raw external exception text, path, source excerpt or log line is retained.
        failures.append({"phase": stage, "exceptionClass": type(error).__name__,
                         "message": "Independent saved-output inspection could not complete"})
    result["failures"] = failures
    result["status"] = "pass" if not failures else "fail"
    return result


def run():
    build = json.loads((OUT / "build-summary.json").read_text())
    report = json.loads((OUT / "native-gate.json").read_text())
    require(build["status"] == "pass", "Source build did not pass")
    require(report["status"] == "pass", "Native shape/structure assertions failed")
    require(report["sourceCommit"] == build["expected_source_commit"] == build["verified_source_commit"],
            "Source commit provenance differs")
    require(build["qt_version_observed"] == build["qt_version_required"], "Qt version provenance differs")
    require(len(report["cases"]) == len(CASES) and {case["id"] for case in report["cases"]} == CASES,
            "All five native paste cases are required")
    require(len(report.get("baselines", [])) == len(BASELINES)
            and {case["id"] for case in report["baselines"]} == BASELINES,
            "Both no-paste native save/reopen baselines are required")
    require(report["assertions"] > 100, "Native assertions were not executed")
    require(ezdxf.__version__ == "1.4.4", "Unexpected independent audit consumer version")
    expected = predictions()
    for case in report["baselines"]:
        count = len(expected[case["id"]])
        require(case["passed"] and case["pasteApplied"] is False, "No-paste baseline did not pass")
        require(len(case["beforeSave"]) == len(case["afterReopen"]) == count
                and case["topLevelInsertCount"] == count, "Native baseline geometry or INSERT count differs")
    for case in report["cases"]:
        require(case["passed"], "Native paste case did not pass")
        require(len(case["beforeSave"]) == len(case["afterReopen"]) == 5, "Native paste shape count differs")
        require(case["blockGraph"]["topLevelInsertCount"] == 5, "Native INSERT graph differs")
        require(case["blockGraph"]["sameDefinitionCount"] == 1 and case["blockGraph"]["sameReferenceCount"] == 2,
                "Native SAME block is not shared")
        if case["id"].startswith("prepared-"):
            require(case["editAndUndoAfterReopen"] and case["blockGraph"]["nestedEditable"],
                    "Native reopened prepared blocks are not editable")
    sys.path.insert(0, str(ROOT / "tests"))
    import saved_geometry_oracle
    try:
        exact_geometry = saved_geometry_oracle.run(OUT)
    except Exception as error:
        exact_geometry = {"status": "fail", "method": "independent tag reader and Fraction evaluator; no CAD SDK",
                          "exceptionClass": type(error).__name__,
                          "message": "Exact saved-output geometry oracle did not pass"}
    (OUT / "saved-geometry-oracle.json").write_text(json.dumps(exact_geometry, indent=2) + "\n")
    observations = []
    # Inspect every baseline and paste output, even if an earlier audit found repairs.
    for case in report["baselines"] + report["cases"]:
        expected_name = case["id"] + ".dxf"
        require(case["savedDrawing"] == expected_name, "Unexpected saved drawing name")
        observations.append(inspect_saved(OUT / expected_name, case["id"], expected[case["id"]]))
    independent = {
        "schema": 1, "status": "pass" if exact_geometry["status"] == "pass" and all(case["status"] == "pass" for case in observations) else "fail",
        "exactGeometryOracleStatus": exact_geometry["status"],
        "consumer": "ezdxf", "version": ezdxf.__version__, "tolerance": 1e-7,
        "acceptance": "Zero audit errors and zero audit fixes in all seven outputs; no exceptions",
        "geometryMethod": "Recursive virtual INSERT shapes checked against handwritten expectations before audit mutation",
        "ownershipMethod": "All owner changes observed before/after in-memory audit; fix records are separate because table normalization may be unreported",
        "note": "No audited document is saved; native-produced DXF bytes are retained unchanged",
        "cases": observations,
    }
    (OUT / "independent-audit.json").write_text(json.dumps(independent, indent=2) + "\n")
    report["independentSavedOutputCheck"] = {
        "status": independent["status"], "consumer": "ezdxf", "version": ezdxf.__version__,
        "tolerance": 1e-7, "details": "independent-audit.json",
        "cases": [{key: case.get(key) for key in
                   ("id", "kind", "status", "auditErrors", "auditFixes", "ownerChangeCount", "geometryPassedBeforeAudit")}
                  for case in observations],
    }
    report["inputsSha256"] = {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                              for file in sorted((ROOT / "fixtures").glob("*.dxf"))}
    report["scope"] = "Native fixed-fixture behavior; strict export audit is independently required for overall acceptance"
    (OUT / "native-gate.json").write_text(json.dumps(report, indent=2) + "\n")
    require(independent["status"] == "pass", "Independent saved-output checks failed; see independent-audit.json",
            "independent-saved-output-audit")
    print("Both no-paste baselines, all five native paste controls and all strict saved-output checks passed")


if __name__ == "__main__":
    run()
