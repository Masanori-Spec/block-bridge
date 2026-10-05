"""Pinned ezdxf is a test-only secondary structural oracle, not application code."""
import hashlib
import json
from pathlib import Path
import ezdxf

ROOT = Path(__file__).resolve().parents[1]
assert ezdxf.__version__ == '1.4.4', f'Unexpected ezdxf {ezdxf.__version__}'
results = []
for file in sorted((ROOT / 'fixtures').glob('*.dxf')):
    doc = ezdxf.readfile(file)
    audit = doc.audit()
    assert len(audit.errors) == len(audit.fixes) == 0, file.name
    assert doc.dxfversion == 'AC1015'
    assert doc.units == 4
    results.append({'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'errors': 0, 'fixes': 0, 'modelspace_entities': len(doc.modelspace()), 'status': 'pass'})
out = ROOT / 'artifacts' / 'oracle'
out.mkdir(parents=True, exist_ok=True)
report = {'status': 'pass', 'consumer': 'ezdxf', 'version': ezdxf.__version__, 'scope': 'secondary structural check only; not native QCAD behavior', 'fixtures': results}
(out / 'structural-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
