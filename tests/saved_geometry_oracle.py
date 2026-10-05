"""Independent exact geometry checks for the native-written synthetic DXFs.

The tag reader/Fraction evaluator is separate from both QCAD and ezdxf. Files are
read-only. Leading standard DXF 999 comments are ignored only for parsing.
"""
from pathlib import Path
import hashlib
import json
from fixture_oracle import document, geometry, handwritten

ROOT = Path(__file__).resolve().parents[1]


def check_saved(file: Path, lines, circles):
    raw = file.read_bytes()
    content = raw.splitlines(keepends=True)
    comments = 0
    while content and int(content[0].strip()) == 999:
        content = content[2:]
        comments += 1
    observed = geometry(document(b''.join(content)))
    assert observed == handwritten(lines, circles), 'Exact independent saved geometry mismatch: ' + file.name
    return {'file': file.name, 'sha256': hashlib.sha256(raw).hexdigest(),
            'status': 'pass', 'arithmetic': 'exact Python Fraction; quarter-turn fixture transforms',
            'shape_count': len(observed), 'leading_comment_tags': comments,
            'file_modified': False, 'audit_repair_performed': False}


def predictions():
    expected = json.loads((ROOT / 'fixtures/expected.json').read_text())
    target, donor, circles = [expected[key] for key in ['target_original_lines', 'donor_intended_lines', 'merged_circles']]
    return {
        'target-baseline.dxf': (target, [circles[0]]),
        'donor-baseline.dxf': (donor, [circles[1]]),
        'unprepared-keep.dxf': (target + expected['unprepared_keep_target_donor_lines'], circles),
        'outer-only-keep.dxf': (target + expected['unprepared_keep_target_donor_lines'], circles),
        'unprepared-overwrite.dxf': (expected['unprepared_overwrite_changed_target_lines'] + donor, circles),
        'prepared-keep.dxf': (target + donor, circles),
        'prepared-overwrite.dxf': (target + donor, circles),
    }


def run(directory=None):
    folder = Path(directory) if directory is not None else ROOT / 'artifacts/native'
    return {'status': 'pass', 'method': 'independent tag reader and Fraction evaluator; no CAD SDK',
            'cases': [check_saved(folder / filename, *expected) for filename, expected in predictions().items()]}


if __name__ == '__main__':
    result = run()
    (ROOT / 'artifacts/native/saved-geometry-oracle.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
