"""Original independent exact tag/geometry oracle for the native feasibility fixtures.

No QCAD or browser implementation is imported. Quarter-turn transforms use Fraction.
This proves the handwritten fixtures, not that a native consumer behaves as expected.
"""
from __future__ import annotations
import hashlib
import json
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "fixtures"


def tag_reader(raw):
    assert raw.isascii(), "Only ASCII fixtures are in this gate"
    lines = raw.decode("ascii").splitlines(keepends=True)
    assert len(lines) % 2 == 0
    tags = []
    offset = 0
    for index in range(0, len(lines), 2):
        code, value = lines[index:index + 2]
        tags.append((int(code.strip()), value.rstrip("\r\n"), offset + len(code), value))
        offset += len(code) + len(value)
    return tags


def records(raw):
    result = []
    for tag in tag_reader(raw):
        if tag[0] == 0:
            result.append([])
        assert result
        result[-1].append(tag)
    return result


def value(record, code, default=None):
    matches = [v for c, v, *_ in record if c == code]
    assert len(matches) <= 1, (record[0][1], code)
    return matches[0] if matches else default


def point(record, xcode=10, ycode=20):
    return (F(value(record, xcode, "0")), F(value(record, ycode, "0")))


def document(raw):
    blocks, model, section, active = {}, [], None, None
    for record in records(raw):
        kind = record[0][1]
        if kind == "SECTION":
            section = value(record, 2)
        elif kind == "ENDSEC":
            section = None
        elif section == "BLOCKS":
            if kind == "BLOCK":
                active = value(record, 2).casefold()
                assert active not in blocks
                blocks[active] = {"base": point(record), "entities": [], "name": value(record, 2)}
            elif kind == "ENDBLK":
                active = None
            else:
                assert active is not None
                blocks[active]["entities"].append(record)
        elif section == "ENTITIES":
            model.append(record)
    return {"blocks": blocks, "model": model}


def rotate(point_, quarters):
    x, y = point_
    for _ in range(quarters % 4):
        x, y = -y, x
    return x, y


def geometry(doc, top=None):
    output = []
    identity = (F(1), 0, (F(0), F(0)))

    def transform(point_, mat):
        scale, rotation, offset = mat
        x, y = rotate(point_, rotation)
        return x * scale + offset[0], y * scale + offset[1]

    def visit(entities, mat, stack):
        for record in entities:
            kind = record[0][1]
            if kind == "INSERT":
                key = value(record, 2).casefold()
                assert key not in stack, "Cyclic block fixture"
                block = doc["blocks"][key]
                scale = F(value(record, 41, "1"))
                assert scale == F(value(record, 42, "1")) and scale > 0
                angle = F(value(record, 50, "0")) / 90
                assert angle.denominator == 1
                quarters = int(angle)
                bx, by = rotate(block["base"], quarters)
                ix, iy = point(record)
                offset = transform((ix - bx * scale, iy - by * scale), mat)
                nested = (mat[0] * scale, mat[1] + quarters, offset)
                visit(block["entities"], nested, stack + [key])
            elif kind == "LINE":
                a, b = transform(point(record), mat), transform(point(record, 11, 21), mat)
                output.append(("LINE", *a, *b))
            elif kind == "CIRCLE":
                center = transform(point(record), mat)
                output.append(("CIRCLE", *center, F(value(record, 40)) * mat[0]))
            else:
                raise AssertionError(f"Unexpected fixture entity {kind}")

    visit(doc["model"] if top is None else top, identity, [])
    return sorted(output)


def serial_shapes(shapes):
    return [[str(part) for part in shape] for shape in shapes]


def handwritten(lines, circles):
    return sorted([("LINE", *map(F, row)) for row in lines] + [("CIRCLE", *map(F, row)) for row in circles])


def minimal_patch(raw, substitutions):
    edits = []
    normalized = {key.casefold(): val for key, val in substitutions.items()}
    for record in records(raw):
        kind = record[0][1]
        allowed = {2, 3} if kind == "BLOCK" else {2} if kind in {"BLOCK_RECORD", "INSERT"} else set()
        for code, current, start, full in record:
            if code in allowed and current.casefold() in normalized:
                replacement = normalized[current.casefold()]
                edits.append((start, len(current), replacement.encode("ascii"), kind, code, current))
    result = raw
    for start, length, replacement, *_ in reversed(edits):
        result = result[:start] + replacement + result[start + length:]
    return result, edits


def semantic_definition(doc, name, stack=()):
    key = name.casefold()
    assert key not in stack
    block = doc["blocks"][key]
    entity_signatures = []
    for record in block["entities"]:
        signature = tuple((code, val) for code, val, *_ in record if code not in {5, 330})
        dependency = semantic_definition(doc, value(record, 2), stack + (key,)) if record[0][1] == "INSERT" else None
        entity_signatures.append((signature, dependency))
    return (block["base"], tuple(entity_signatures))


def merge(target, donor, overwrite=False):
    blocks = {**target["blocks"], **donor["blocks"]} if overwrite else {**donor["blocks"], **target["blocks"]}
    return {"blocks": blocks, "model": target["model"] + donor["model"]}


def run():
    raw = {name: (FIX / name).read_bytes() for name in ["target.dxf", "donor.dxf", "expected-prepared-donor.dxf", "outer-only-donor.dxf"]}
    target, donor, prepared, outer = [document(raw[name]) for name in raw]
    expected = json.loads((FIX / "expected.json").read_text())
    remap = expected["rename_map"]
    patched, edits = minimal_patch(raw["donor.dxf"], remap)
    assert patched == raw["expected-prepared-donor.dxf"], "Prepared fixture changes more than approved name tokens"
    assert len(edits) == 9
    assert minimal_patch(raw["donor.dxf"], {"ASSEMBLY": "TRANSFER_ASSEMBLY"})[0] == raw["outer-only-donor.dxf"]
    assert geometry(target) == handwritten(expected["target_original_lines"], [[202, 2, 3]])
    assert geometry(donor) == handwritten(expected["donor_intended_lines"], [[2, 2, 3]])
    assert geometry(prepared) == geometry(donor)
    assert semantic_definition(target, "SAME") == semantic_definition(donor, "SAME")
    assert semantic_definition(target, "ASSEMBLY") != semantic_definition(donor, "ASSEMBLY")
    direct = lambda doc: [[(c, v) for c, v, *_ in r if c not in {5, 330}] for r in doc["blocks"]["assembly"]["entities"]]
    assert direct(target) == direct(donor), "Fixture must require dependency-aware comparison"
    intended = handwritten(expected["target_original_lines"] + expected["donor_intended_lines"], expected["merged_circles"])
    keep = handwritten(expected["target_original_lines"] + expected["unprepared_keep_target_donor_lines"], expected["merged_circles"])
    overwrite = handwritten(expected["unprepared_overwrite_changed_target_lines"] + expected["donor_intended_lines"], expected["merged_circles"])
    assert geometry(merge(target, donor)) == keep != intended
    assert geometry(merge(target, donor, True)) == overwrite != intended
    assert geometry(merge(target, prepared)) == intended
    assert geometry(merge(target, prepared, True)) == intended
    assert geometry(merge(target, outer)) == keep != intended
    assert set(b.casefold() for b in remap.values()).isdisjoint(target["blocks"])
    assert len(set(b.casefold() for b in remap.values())) == len(remap)
    report = {
        "status": "pass", "scope": "independent original fixture oracle; not native consumer evidence",
        "arithmetic": "Python Fraction; exact quarter-turn rotations",
        "inputs_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in raw.items()},
        "approved_map": remap, "exact_changed_name_tokens": len(edits),
        "all_other_bytes_unchanged": True,
        "checks": ["target and donor handwritten world geometry", "dependency-aware ASSEMBLY collision", "equivalent SAME reuse", "all unapproved tag bytes preserved", "case-insensitive replacement namespace", "keep and overwrite corruption predictions", "prepared donor transforms unchanged", "outer-only rename negative prediction"],
        "expected_native_shapes": {"prepared": serial_shapes(intended), "keep": serial_shapes(keep), "overwrite": serial_shapes(overwrite), "outer_only": serial_shapes(keep)},
        "native_gate": "not run by this oracle"
    }
    out = ROOT / "artifacts" / "oracle"
    out.mkdir(parents=True, exist_ok=True)
    (out / "fixture-oracle.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    run()
