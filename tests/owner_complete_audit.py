"""Independent read-only owner/geometry proof for original tag-authored inputs."""
import hashlib
import json
from pathlib import Path
import sys
import ezdxf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests/native"))
from audit_snapshot import demand, semantic_index, observe
from fixture_oracle import document, geometry, handwritten, minimal_patch, semantic_definition


def verify_file(file):
    raw = file.read_bytes()
    index = semantic_index(raw)
    loaded = ezdxf.readfile(file)
    authored = 0
    for handle, record in index["records"].items():
        demand(record["owner"] is not None, "Authored entity lacks explicit common owner")
        demand(record["owner"] == "0" or record["owner"] in index["records"], "Authored owner target is absent")
        demand(handle in loaded.entitydb, "Authored handle disappeared during read")
        demand(loaded.entitydb[handle].dxf.get("owner") == record["owner"], "Authored owner changed during read")
        authored += 1
    snapshots = observe(loaded)
    demand(not snapshots["errors"] and not snapshots["fixes"], "Owner-complete input requires an audit repair")
    demand(snapshots["before"] == snapshots["after"], "Owner-complete input silently changes during audit")
    demand(raw == file.read_bytes(), "Input bytes changed")
    return {"file": file.name, "sha256": hashlib.sha256(raw).hexdigest(), "status": "pass",
            "authoredOwnedRecords": authored, "authoredOwnersPreservedOnRead": True,
            "auditErrors": 0, "auditFixes": 0, "fullSnapshotIdentical": True, "fileBytesUnchanged": True}


def run(folder=None):
    demand(ezdxf.__version__ == "1.4.4", "Wrong audit version")
    folder = Path(folder) if folder else ROOT / "fixtures/owner-complete"
    names = ["target.dxf", "donor.dxf", "expected-prepared-donor.dxf", "outer-only-donor.dxf"]
    expected = json.loads((folder / "expected.json").read_text())
    raw = {name: (folder / name).read_bytes() for name in names}
    docs = {name: document(data) for name, data in raw.items()}
    target = handwritten(expected["target_original_lines"], [[202, 2, 3]])
    donor = handwritten(expected["donor_intended_lines"], [[2, 2, 3]])
    demand(geometry(docs["target.dxf"]) == target, "Owner-complete target geometry differs")
    for name in names[1:]:
        demand(geometry(docs[name]) == donor, "Owner-complete donor geometry differs")
    patched, edits = minimal_patch(raw["donor.dxf"], expected["rename_map"])
    demand(len(edits) == 9 and patched == raw["expected-prepared-donor.dxf"], "Prepared input is not the nine exact name spans")
    demand(minimal_patch(raw["donor.dxf"], {"ASSEMBLY": "TRANSFER_ASSEMBLY"})[0] == raw["outer-only-donor.dxf"],
           "Outer-only control differs")
    demand(semantic_definition(docs["target.dxf"], "SAME") == semantic_definition(docs["donor.dxf"], "SAME"),
           "SAME equivalence differs")
    results = [verify_file(folder / name) for name in names]
    return {"schema": 1, "status": "pass", "family": "owner-complete", "consumer": "ezdxf", "version": ezdxf.__version__,
            "method": "Explicit raw owners checked against authored targets and post-read values; full audit snapshots compare attributes, emitted tags, headers and membership; exact Fraction geometry and nine-span proof",
            "scope": "No claim that the SDK creates no default objects during loading; only authored owners and pre/post-audit snapshots are compared",
            "cases": results}


if __name__ == "__main__":
    report = run()
    out = ROOT / "artifacts/oracle"
    out.mkdir(parents=True, exist_ok=True)
    (out / "owner-complete-inputs.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
