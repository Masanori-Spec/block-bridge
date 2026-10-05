"""Fail-closed validation of the native report; no process-exit-only success claims."""
import hashlib
import json
from pathlib import Path
import math
import ezdxf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/native"
CASES = {"unprepared-keep", "unprepared-overwrite", "outer-only-keep", "prepared-keep", "prepared-overwrite"}


def saved_geometry(document):
    rows = []

    def visit(entities, depth=0):
        assert depth < 16, "Unexpected recursive saved block graph"
        for entity in entities:
            kind = entity.dxftype()
            if kind == "INSERT":
                visit(entity.virtual_entities(), depth + 1)
            elif kind == "LINE":
                a, b = entity.dxf.start, entity.dxf.end
                assert abs(a.z) <= 1e-7 and abs(b.z) <= 1e-7
                rows.append(["LINE", a.x, a.y, b.x, b.y])
            elif kind == "CIRCLE":
                center = entity.dxf.center
                assert abs(center.z) <= 1e-7
                rows.append(["CIRCLE", center.x, center.y, entity.dxf.radius])
            else:
                raise AssertionError("Unexpected saved entity kind")
    visit(document.modelspace())
    return rows


def compare_saved(actual, expected):
    assert len(actual) == len(expected) == 5
    unmatched = expected[:]
    for row in actual:
        found = next((i for i, target in enumerate(unmatched)
                      if row[0] == target[0] and len(row) == len(target)
                      and all(math.isfinite(a) and abs(a - b) <= 1e-7
                              for a, b in zip(row[1:], target[1:]))), None)
        assert found is not None, "Independent saved DXF geometry differs from handwritten oracle"
        unmatched.pop(found)


def run():
    build = json.loads((OUT / "build-summary.json").read_text())
    report = json.loads((OUT / "native-gate.json").read_text())
    assert build["status"] == "pass", "Source build did not pass"
    assert report["status"] == "pass", "Native shape/structure assertions failed"
    assert report["sourceCommit"] == build["expected_source_commit"] == build["verified_source_commit"]
    assert build["qt_version_observed"] == build["qt_version_required"]
    assert len(report["cases"]) == len(CASES)
    assert {case["id"] for case in report["cases"]} == CASES
    assert report["assertions"] > 100, "Native assertions were not executed"
    assert ezdxf.__version__ == "1.4.4"
    handwritten = json.loads((ROOT / "fixtures/expected.json").read_text())
    circle_rows = [["CIRCLE", *row] for row in handwritten["merged_circles"]]
    line_rows = lambda key: [["LINE", *row] for row in handwritten[key]]
    target = line_rows("target_original_lines")
    donor = line_rows("donor_intended_lines")
    predictions = {
        "unprepared-keep": target + line_rows("unprepared_keep_target_donor_lines"),
        "outer-only-keep": target + line_rows("unprepared_keep_target_donor_lines"),
        "unprepared-overwrite": line_rows("unprepared_overwrite_changed_target_lines") + donor,
        "prepared-keep": target + donor,
        "prepared-overwrite": target + donor,
    }
    saved_audits = []
    for case in report["cases"]:
        assert case["passed"]
        assert len(case["beforeSave"]) == len(case["afterReopen"]) == 5
        assert case["blockGraph"]["topLevelInsertCount"] == 5
        assert case["blockGraph"]["sameDefinitionCount"] == 1
        assert case["blockGraph"]["sameReferenceCount"] == 2
        if case["id"].startswith("prepared-"):
            assert case["editAndUndoAfterReopen"] and case["blockGraph"]["nestedEditable"]
        drawing = OUT / case["savedDrawing"]
        assert drawing.parent == OUT and drawing.suffix == ".dxf" and drawing.stat().st_size > 0
        independent = ezdxf.readfile(drawing)
        audit = independent.audit()
        assert not audit.errors and not audit.fixes, "Saved DXF audit reports errors or repairs"
        observed = saved_geometry(independent)
        compare_saved(observed, predictions[case["id"]] + circle_rows)
        assert len(independent.modelspace()) == 5
        assert all(entity.dxftype() == "INSERT" for entity in independent.modelspace())
        saved_audits.append({"case": case["id"], "auditErrors": len(audit.errors),
                            "auditFixes": len(audit.fixes), "worldShapeCount": len(observed),
                            "modelInsertCount": len(independent.modelspace()), "geometryPassed": True})
    report["independentSavedOutputCheck"] = {
        "consumer": "ezdxf", "version": ezdxf.__version__, "tolerance": 1e-7,
        "method": "Recursive virtual INSERT entities compared with handwritten endpoint/center/radius predictions",
        "note": "Native floating-point serialization is checked with the same explicit 1e-7 bound; fixture oracle remains exact Fraction arithmetic",
        "cases": saved_audits,
    }
    report["inputsSha256"] = {
        file.name: hashlib.sha256(file.read_bytes()).hexdigest()
        for file in sorted((ROOT / "fixtures").glob("*.dxf"))
    }
    report["scope"] = "Native feasibility of original fixed fixtures; no general product guarantee"
    (OUT / "native-gate.json").write_text(json.dumps(report, indent=2) + "\n")
    print("All five native paste/save/reopen controls and prepared edit/undo checks passed")


if __name__ == "__main__":
    run()
