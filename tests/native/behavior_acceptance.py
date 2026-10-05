"""Scoped native behavior acceptance with a reviewed, hash-pinned owner policy.

This is separate from the unchanged strict zero-repair gate. Never learns an
allowlist from the current run and never saves an audited document.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import ezdxf
from audit_snapshot import demand, observe, semantic_index, common_owner, without_common_owner, SnapshotError
from summarize import compare_saved, predictions, saved_geometry

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
import saved_geometry_oracle
from fixture_oracle import minimal_patch
from owner_complete_audit import run as verify_inputs, verify_file

POLICY = Path(__file__).with_name("pinned_serialization_signatures.json")
POLICY_SHA256 = "06507a363c9ee100163d9fafabae603f308101f899c84b7def95cf28121d9f05"
CASES = {"target-baseline", "donor-baseline", "unprepared-keep", "unprepared-overwrite",
         "outer-only-keep", "prepared-keep", "prepared-overwrite"}
BASELINES = {"target-baseline", "donor-baseline"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sorted_rows(rows):
    return sorted(rows, key=canonical)


def load_policy():
    raw = POLICY.read_bytes()
    demand(digest(raw) == POLICY_SHA256, "Reviewed policy bytes changed; renewed review required")
    policy = json.loads(raw)
    demand(set(policy["caseOwnerAdditions"]) == CASES, "Pinned policy case inventory differs")
    demand(len(policy["baseOwnerSignature"]) == 77 and len(policy["fixSignature"]) == 15,
           "Pinned policy is not the reviewed semantic signature")
    return policy


def validate_observation(observation, index, case, policy):
    demand(case in CASES, "Unknown native output case")
    demand(not observation["errors"], "Audit reported errors")
    before, after = observation["before"], observation["after"]
    for key in ("header", "dictionaryLinks", "tableMembership", "blockMembership", "sectionMembership"):
        demand(before[key] == after[key], "Audit changed " + key)
    demand(set(before["entities"]) == set(after["entities"]), "Audit changed entity inventory")
    identities, records = index["identities"], index["records"]
    expected = sorted_rows(policy["baseOwnerSignature"] + policy["caseOwnerAdditions"][case])
    owner_rows, owner_handles, tag_changes = [], set(), []
    for handle in sorted(before["entities"]):
        old, new = before["entities"][handle], after["entities"][handle]
        demand(old["type"] == new["type"], "Audit changed entity type")
        oa, na = dict(old["attributes"]), dict(new["attributes"])
        old_owner, new_owner = oa.pop("owner", None), na.pop("owner", None)
        demand(oa == na, "Audit changed a non-owner DXF attribute")
        if old_owner == new_owner:
            demand(old["attributes"] == new["attributes"], "Audit changed owner attribute presence without assignment")
            demand(old["tags"] == new["tags"], "Audit changed unrelated emitted tags")
            continue
        demand(handle in identities and handle in records, "Changed owner has unknown raw semantic identity")
        demand(old_owner is None and records[handle]["owner"] is None, "Changed old owner was not absent")
        demand(records[handle]["type"] == old["type"], "Raw entity type differs from loaded entity")
        demand(new_owner == "0" or new_owner in identities, "New owner has unknown semantic identity")
        new_path = "0" if new_owner == "0" else identities[new_owner]
        owner_rows.append([old["type"], identities[handle], None, new_path])
        owner_handles.add(handle)
        demand(without_common_owner(old["tags"]) == without_common_owner(new["tags"]),
               "Audit changed emitted tags beyond the base owner slot")
        demand(common_owner(new["tags"]) == new_owner, "Emitted new owner differs from assigned owner")
        if old["tags"] == new["tags"]:
            demand(identities[handle] == "ROOT" and old["type"] == "DICTIONARY" and new_owner == "0",
                   "Unexplained owner assignment without emitted tag change")
            demand(common_owner(old["tags"]) == "0", "Root collector default differs from reviewed behavior")
        else:
            changed_slots = [position for position, pair in enumerate(zip(old["tags"], new["tags"])) if pair[0] != pair[1]]
            demand(len(old["tags"]) == len(new["tags"]) and len(changed_slots) == 1,
                   "Emitted owner change is not a single unchanged-position slot")
            position = changed_slots[0]
            demand(old["tags"][position][0] == new["tags"][position][0] == 330,
                   "Changed emitted slot is not the base owner tag")
            demand(common_owner(old["tags"]) == ("None" if old["type"] == "TABLE" else "0"),
                   "Unexpected collector default for absent old owner")
            tag_changes.append(identities[handle])
    demand(sorted_rows(owner_rows) == expected, "Complete semantic owner signature differs from frozen policy")
    actual_fixes = []
    fix_handles = []
    for fix in observation["fixes"]:
        handle = fix["handle"]
        demand(handle in owner_handles and handle in identities, "Repair is not an allowed owner assignment")
        old, new = before["entities"][handle], after["entities"][handle]
        demand(fix["type"] == old["type"], "Repair entity type differs")
        owner = new["attributes"].get("owner")
        actual_fixes.append([fix["code"], fix["type"], identities[handle], None,
                             "0" if owner == "0" else identities[owner]])
        fix_handles.append(handle)
    demand(len(fix_handles) == len(set(fix_handles)), "Duplicate repair record")
    demand(sorted_rows(actual_fixes) == sorted_rows(policy["fixSignature"]),
           "Complete repair signature differs from frozen policy")
    demand(set(tag_changes) == {row[1] for row in expected} - {"ROOT"},
           "Emitted owner-slot change identities differ")
    return {"status": "pass", "auditErrors": 0, "auditFixes": len(actual_fixes),
            "ownerChanges": len(owner_rows), "emittedOwnerSlotChanges": len(tag_changes),
            "fixSignature": sorted_rows(actual_fixes), "ownerSignature": sorted_rows(owner_rows),
            "fullSnapshotsAllowOnlyFrozenOwnerAssignments": True,
            "beforeSnapshotSha256": digest(canonical(before).encode()),
            "afterSnapshotSha256": digest(canonical(after).encode())}


def validate_native_report(report, build, policy):
    demand(build["status"] == "pass" and report["status"] == "pass", "Native source build or behavior failed")
    demand(report["sourceCommit"] == build["verified_source_commit"] == build["expected_source_commit"] == policy["sourceCommit"],
           "Native source provenance differs")
    demand(build["qt_version_observed"] == build["qt_version_required"] == "5.15.3", "Qt provenance differs")
    demand(report["sourceTag"] == "v3.33.1.0" and report["version"] in {"3.33.1", "3.33.1.0"}, "Native version differs")
    demand(report["assertions"] >= 502, "Existing native assertions were not all executed")
    demand(len(report["baselines"]) == 2 and {item["id"] for item in report["baselines"]} == BASELINES,
           "Missing or duplicate native baseline")
    demand(len(report["cases"]) == 5 and {item["id"] for item in report["cases"]} == CASES - BASELINES,
           "Missing or duplicate native paste case")
    expected = predictions()
    for item in report["baselines"] + report["cases"]:
        case = item["id"]
        demand(item["passed"] and item["savedDrawing"] == case + ".dxf", "Native case failed or file name differs")
        compare_saved(item["beforeSave"], expected[case])
        compare_saved(item["afterReopen"], expected[case])
        if case in BASELINES:
            demand(item["pasteApplied"] is False and item["topLevelInsertCount"] == len(expected[case]),
                   "No-paste baseline structure differs")
            continue
        demand(item["overwriteBlocks"] is case.endswith("overwrite"), "Native overwrite control differs")
        graph = item["blockGraph"]
        demand(graph["topLevelInsertCount"] == 5 and graph["sameDefinitionCount"] == 1 and graph["sameReferenceCount"] == 2,
               "Native shared block graph differs")
        if case.startswith("prepared-"):
            refs = {"ASSEMBLY": 1, "TRANSFER_ASSEMBLY": 1, "TRANSFER_LEAF": 1, "SAME": 2}
            demand(item["editAndUndoAfterReopen"] and graph["nestedEditable"], "Native edit/undo proof is absent")
        elif case == "outer-only-keep":
            refs = {"ASSEMBLY": 1, "TRANSFER_ASSEMBLY": 1, "LEAF": 1, "SAME": 2}
        else:
            refs = {"ASSEMBLY": 2, "LEAF": 1, "SAME": 2}
        demand(graph["referenceNames"] == refs, "Native semantic INSERT references differ")


def validate_secondary_before(document, case):
    """Preserve the original independent SDK geometry oracle before audit mutation."""
    demand(case in CASES, "Unknown secondary-oracle case")
    expected = predictions()[case]
    rows = saved_geometry(document)
    compare_saved(rows, expected)
    model = list(document.modelspace())
    demand(len(model) == len(expected), "Secondary saved model INSERT count differs")
    demand(all(entity.dxftype() == "INSERT" for entity in model), "Secondary saved model contains flattened geometry")
    return rows


def verify_browser_input(browser_donor, integrity):
    family = ROOT / "fixtures/owner-complete"
    target, donor, produced = (family / "target.dxf").read_bytes(), (family / "donor.dxf").read_bytes(), browser_donor.read_bytes()
    expected_map = json.loads((family / "expected.json").read_text())["rename_map"]
    expected, edits = minimal_patch(donor, expected_map)
    demand(produced == expected and len(edits) == 9, "Browser donor is not exactly the nine approved name-span edits")
    demand(produced == (family / "expected-prepared-donor.dxf").read_bytes(), "Browser output differs from independent expected fixture")
    verify_file(browser_donor)
    demand(integrity["status"] == "pass" and integrity["browserDonorSha256"] == digest(produced), "Browser input provenance differs")
    expected_inputs = {name: digest((family / name).read_bytes()) for name in ("target.dxf", "donor.dxf", "outer-only-donor.dxf")}
    expected_inputs["expected-prepared-donor.dxf"] = digest(produced)
    demand(integrity["stagedInputHashesBefore"] == integrity["stagedInputHashesAfter"] == expected_inputs,
           "Native staged inputs changed or do not include the browser donor")
    demand(integrity["targetSha256Before"] == integrity["targetSha256After"] == digest(target), "Destination input bytes changed")
    demand(integrity["nativeHarnessSha256"] == digest((ROOT / "tests/native/gate.js").read_bytes()), "Native harness identity differs")
    demand(integrity["nativeProcessExitCode"] == 0, "Native process did not exit successfully")
    return {"status": "pass", "browserDonorSha256": digest(produced), "changedNameTokens": len(edits),
            "allOtherDonorBytesUnchanged": True, "destinationBytesUnchanged": True, "authoredOwnerAuditPassed": True}


def run(directory, build_file, browser_donor):
    directory, build_file, browser_donor = Path(directory), Path(build_file), Path(browser_donor)
    policy = load_policy()
    demand(ezdxf.__version__ == policy["ezdxfVersion"], "Audit consumer version differs")
    report = json.loads((directory / "native-gate.json").read_text())
    build = json.loads(build_file.read_text())
    validate_native_report(report, build, policy)
    inputs = verify_inputs()
    integrity = json.loads((directory / "input-integrity.json").read_text())
    browser = verify_browser_input(browser_donor, integrity)
    exact = saved_geometry_oracle.run(directory)  # independent exact geometry BEFORE audit
    (directory / "saved-geometry-oracle.json").write_text(json.dumps(exact, indent=2) + "\n")
    results = []
    for case in sorted(CASES):
        path = directory / (case + ".dxf")
        raw = path.read_bytes()
        index = semantic_index(raw)
        document = ezdxf.readfile(path)
        secondary_before = validate_secondary_before(document, case)
        observation = observe(document)
        secondary_after = validate_secondary_before(document, case)
        demand(secondary_before == secondary_after, "Audit changed secondary-oracle saved geometry")
        finding = validate_observation(observation, index, case, policy)
        demand(path.read_bytes() == raw, "Native output bytes changed during read-only validation")
        results.append({"case": case, "sha256": digest(raw), "fileBytesUnchanged": True,
                        "secondaryEzdxfGeometryBeforeAudit": "pass", "secondaryGeometryUnchangedByAudit": True,
                        "modelInsertCount": len(secondary_before), **finding})
    result = {"schema": 1, "gate": "native-transfer-geometry-editability-with-pinned-serialization-limitation",
              "scopedNativeBehavior": "pass", "strictZeroRepair": "fail",
              "criterionChange": "Separate scoped gate: exact reviewed owner identities only; original strict workflow remains unchanged and failed",
              "policyId": policy["policyId"], "policySha256": POLICY_SHA256,
              "sourceCommit": policy["sourceCommit"], "ezdxfVersion": ezdxf.__version__,
              "nativeAssertions": report["assertions"], "inputFamilyAudit": inputs,
              "browserOutputProof": browser, "exactSavedGeometry": exact, "cases": results,
              "claimBoundary": "Tested LINE/CIRCLE/INSERT fixtures, positive uniform scale and quarter turns only; no repair-free merged-DXF or general CAD claim"}
    (directory / "native-behavior.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--build-summary", required=True)
    parser.add_argument("--browser-donor", required=True)
    args = parser.parse_args()
    try:
        result = run(args.directory, args.build_summary, args.browser_donor)
    except Exception as error:
        failure = {"schema": 1, "scopedNativeBehavior": "fail", "strictZeroRepair": "not_overridden",
                   "exceptionClass": type(error).__name__,
                   "message": str(error) if isinstance(error, (SnapshotError, AssertionError)) else "Scoped gate could not complete"}
        (Path(args.directory) / "native-behavior.json").write_text(json.dumps(failure, indent=2) + "\n")
        raise SystemExit(1)
    print("Scoped native behavior passed; strict zero-repair remains failed")
