"""Mutation checks for the independent test oracle, not a product DXF validator."""
from fixture_oracle import FIX, document, geometry, minimal_patch, semantic_definition

def raises(function):
    try:
        function()
    except (AssertionError, KeyError):
        return
    raise AssertionError('Mutation was not detected')

raw = (FIX / 'donor.dxf').read_bytes()
expected = (FIX / 'expected-prepared-donor.dxf').read_bytes()
remap = {'LEAF': 'TRANSFER_LEAF', 'ASSEMBLY': 'TRANSFER_ASSEMBLY'}
patched, edits = minimal_patch(raw, remap)
assert patched == expected
assert minimal_patch(raw, {'leaf': 'TRANSFER_LEAF', 'assembly': 'TRANSFER_ASSEMBLY'})[0] == expected
assert patched != expected.replace(b'\n21\n20\n', b'\n21\n21\n'), 'Numeric mutations must fail byte scope'
assert patched != expected.replace(b'\n5\n21\n', b'\n5\nDEAD\n'), 'Handle mutations must fail byte scope'
assert patched != expected.replace(b'\n330\n12\n', b'\n330\n13\n'), 'Ownership mutations must fail byte scope'
assert minimal_patch(raw, {'ASSEMBLY': 'TRANSFER_ASSEMBLY'})[0] != expected
missing_reference = raw.replace(b'\n2\nLEAF\n10\n', b'\n2\nMISSING\n10\n')
raises(lambda: geometry(document(missing_reference)))
cycle = raw.replace(b'\n2\nLEAF\n10\n5\n', b'\n2\nASSEMBLY\n10\n5\n')
raises(lambda: geometry(document(cycle)))
raises(lambda: semantic_definition(document(cycle), 'ASSEMBLY'))
print('Independent oracle mutation tests: 8 checks passed')
