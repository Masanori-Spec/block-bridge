"""Original fail-closed mutation controls; synthetic observations are not native evidence."""
import copy
import json
from pathlib import Path
import tempfile
import ezdxf
import behavior_acceptance as gate
from audit_snapshot import SnapshotError, semantic_index


def synthetic_observation(policy, case="target-baseline"):
    rows = policy["baseOwnerSignature"] + policy["caseOwnerAdditions"][case]
    identities = {format(index + 1, "X"): row[1] for index, row in enumerate(rows)}
    handles = {name: handle for handle, name in identities.items()}
    before = {key: {} for key in ("entities", "header", "dictionaryLinks", "tableMembership", "blockMembership", "sectionMembership")}
    after = copy.deepcopy(before)
    records = {}
    for kind, name, old, owner in rows:
        handle = handles[name]
        new_owner = "0" if owner == "0" else handles[owner]
        old_tags = [[0, kind], [5, handle], [330, "None" if kind == "TABLE" else "0"], [100, "FixtureSubclass"], [1, "untouched"]]
        new_tags = copy.deepcopy(old_tags)
        new_tags[2][1] = new_owner
        attrs = {"handle": handle}
        before["entities"][handle] = {"type": kind, "attributes": attrs, "tags": old_tags}
        after["entities"][handle] = {"type": kind, "attributes": {**attrs, "owner": new_owner}, "tags": new_tags}
        records[handle] = {"type": kind, "owner": None}
    fixes = [{"code": code, "type": kind, "handle": handles[name]} for code, kind, name, old, owner in policy["fixSignature"]]
    return {"before": before, "after": after, "errors": [], "fixes": fixes}, {"identities": identities, "records": records}


def synthetic_native(policy):
    report = {"status": "pass", "sourceCommit": policy["sourceCommit"], "sourceTag": "v3.33.1.0",
              "version": "3.33.1.0", "assertions": 502, "baselines": [], "cases": []}
    for name, shapes in gate.predictions().items():
        case = {"id": name, "passed": True, "savedDrawing": name + ".dxf",
                "beforeSave": shapes, "afterReopen": copy.deepcopy(shapes)}
        if name in gate.BASELINES:
            case.update(pasteApplied=False, topLevelInsertCount=len(shapes))
            report["baselines"].append(case)
        else:
            prepared = name.startswith("prepared-")
            refs = {"ASSEMBLY": 1, "TRANSFER_ASSEMBLY": 1, "TRANSFER_LEAF": 1, "SAME": 2} if prepared else (
                {"ASSEMBLY": 1, "TRANSFER_ASSEMBLY": 1, "LEAF": 1, "SAME": 2} if name == "outer-only-keep" else
                {"ASSEMBLY": 2, "LEAF": 1, "SAME": 2})
            case.update(overwriteBlocks=name.endswith("overwrite"), editAndUndoAfterReopen=prepared,
                        blockGraph={"topLevelInsertCount": 5, "sameDefinitionCount": 1, "sameReferenceCount": 2,
                                    "nestedEditable": prepared, "referenceNames": refs})
            report["cases"].append(case)
    build = {"status": "pass", "verified_source_commit": policy["sourceCommit"], "expected_source_commit": policy["sourceCommit"],
             "qt_version_required": "5.15.3", "qt_version_observed": "5.15.3"}
    return report, build


def run():
    policy = gate.load_policy()
    observation, index = synthetic_observation(policy)
    gate.validate_observation(observation, index, "target-baseline", policy)
    report, build = synthetic_native(policy)
    gate.validate_native_report(report, build, policy)
    passed = []

    def reject(name, call):
        try:
            call()
        except (AssertionError, KeyError, ValueError):
            passed.append(name)
        else:
            raise AssertionError("Mutation was accepted: " + name)

    def mutate_observation(name, change):
        obs, ids = copy.deepcopy(observation), copy.deepcopy(index)
        change(obs, ids)
        reject(name, lambda: gate.validate_observation(obs, ids, "target-baseline", policy))

    def handle(path):
        return next(h for h, value in index["identities"].items() if value == path)

    group = handle("ROOT/ACAD_GROUP")
    def wrong_owner(obs, ids):
        obs["after"]["entities"][group]["attributes"]["owner"] = handle("ROOT/ACAD_LAYOUT")
        obs["after"]["entities"][group]["tags"][2][1] = handle("ROOT/ACAD_LAYOUT")
    mutate_observation("wrong-owner target", wrong_owner)
    mutate_observation("same-count semantic substitution", lambda obs, ids: ids["identities"].update({group: "ROOT/IMPOSTOR"}))
    mutate_observation("unrelated attribute mutation", lambda obs, ids: obs["after"]["entities"][group]["attributes"].update(color=5))
    mutate_observation("missing repair record", lambda obs, ids: obs["fixes"].pop())
    mutate_observation("extra repair record", lambda obs, ids: obs["fixes"].append(copy.deepcopy(obs["fixes"][0])))
    mutate_observation("same-count repair substitution", lambda obs, ids: obs["fixes"].__setitem__(0,copy.deepcopy(obs["fixes"][1])))
    mutate_observation("old owner was not absent", lambda obs, ids: ids["records"][group].update(owner="0"))
    mutate_observation("unknown changed identity", lambda obs, ids: ids["identities"].pop(group))
    def extra_assignment(obs, ids):
        new_handle = "FFFF"
        old = {"type": "LAYER", "attributes": {"handle": new_handle},
               "tags": [[0,"LAYER"],[5,new_handle],[330,"0"],[100,"FixtureSubclass"]]}
        new = copy.deepcopy(old)
        new["attributes"]["owner"] = handle("TABLE/LAYER")
        new["tags"][2][1] = handle("TABLE/LAYER")
        obs["before"]["entities"][new_handle] = old
        obs["after"]["entities"][new_handle] = new
        ids["identities"][new_handle] = "TABLE/LAYER/UNEXPECTED"
        ids["records"][new_handle] = {"type":"LAYER", "owner":None}
    mutate_observation("extra otherwise valid owner assignment", extra_assignment)
    mutate_observation("missing owner assignment", lambda obs, ids: obs["after"]["entities"].update({group:copy.deepcopy(obs["before"]["entities"][group])}))
    mutate_observation("entity inventory added", lambda obs, ids: obs["after"]["entities"].update(EXTRA=copy.deepcopy(obs["after"]["entities"][group])))
    mutate_observation("entity inventory removed", lambda obs, ids: obs["after"]["entities"].pop(group))
    mutate_observation("header changed", lambda obs, ids: obs["after"]["header"].update(INSUNITS=6))
    mutate_observation("dictionary links changed", lambda obs, ids: obs["after"]["dictionaryLinks"].update(unexpected=["target"]))
    mutate_observation("table membership changed", lambda obs, ids: obs["after"]["tableMembership"].update(unexpected=["entry"]))
    mutate_observation("section membership changed", lambda obs, ids: obs["after"]["sectionMembership"].update(unexpected=["entity"]))
    def move_owner_slot(obs, ids):
        tags=obs["after"]["entities"][group]["tags"]
        owner=tags.pop(2);tags.insert(1,owner)
    mutate_observation("base owner tag moved rather than assigned", move_owner_slot)
    mutate_observation("later subclass 330 changed", lambda obs, ids: obs["after"]["entities"][group]["tags"].append([330,"BAD"]))
    mutate_observation("unreadable comparison", lambda obs, ids: obs["after"].pop("entities"))
    mutate_observation("audit error introduced", lambda obs, ids: obs["errors"].append({"code":202}))
    for name, change in [
        ("omitted case", lambda r:r["cases"].pop()),
        ("extra case", lambda r:r["cases"].append(copy.deepcopy(r["cases"][0]))),
        ("missing geometry", lambda r:r["cases"][0]["beforeSave"].pop()),
        ("wrong geometry", lambda r:r["cases"][0]["beforeSave"][0].__setitem__(1,999)),
        ("missing baseline", lambda r:r["baselines"].pop()),
        ("native assertions omitted", lambda r:r.update(assertions=501)),
        ("reopened edit proof removed", lambda r:r["cases"][-1].update(editAndUndoAfterReopen=False)),
    ]:
        mutated=copy.deepcopy(report);change(mutated)
        reject(name, lambda r=mutated:gate.validate_native_report(r,build,policy))
    def raw(tags):
        return ''.join(f'{code}\n{value}\n' for code,value in tags).encode()
    def objects(body):
        return raw([(0,'SECTION'),(2,'OBJECTS')]+body+[(0,'ENDSEC'),(0,'EOF')])
    reject("raw dangling dictionary reference",lambda:semantic_index(objects([(0,'DICTIONARY'),(5,'A'),(3,'bad'),(350,'B')])))
    reject("raw dictionary cycle",lambda:semantic_index(objects([(0,'DICTIONARY'),(5,'A'),(3,'child'),(350,'B'),(0,'DICTIONARY'),(5,'B'),(3,'back'),(350,'A')])))
    reject("raw multiple common owners",lambda:semantic_index(objects([(0,'DICTIONARY'),(5,'A'),(330,'0'),(330,'B')])))
    reject("raw duplicate dictionary identity",lambda:semantic_index(objects([(0,'DICTIONARY'),(5,'A'),(3,'same'),(350,'B'),(3,'same'),(350,'C'),(0,'XRECORD'),(5,'B'),(0,'XRECORD'),(5,'C')])))
    reject("raw duplicate table identity",lambda:semantic_index(raw([(0,'SECTION'),(2,'TABLES'),(0,'TABLE'),(2,'LAYER'),(5,'A'),(0,'LAYER'),(2,'same'),(5,'B'),(0,'LAYER'),(2,'same'),(5,'C'),(0,'ENDTAB'),(0,'ENDSEC'),(0,'EOF')])))
    family=gate.ROOT/'fixtures/owner-complete'
    browser=family/'expected-prepared-donor.dxf'
    hashes={name:gate.digest((family/name).read_bytes()) for name in ('target.dxf','donor.dxf','outer-only-donor.dxf','expected-prepared-donor.dxf')}
    integrity={"status":"pass","browserDonorSha256":hashes['expected-prepared-donor.dxf'],
               "stagedInputHashesBefore":hashes,"stagedInputHashesAfter":dict(hashes),
               "targetSha256Before":hashes['target.dxf'],"targetSha256After":hashes['target.dxf'],
               "nativeHarnessSha256":gate.digest((gate.ROOT/'tests/native/gate.js').read_bytes()),
               "nativeProcessExitCode":0}
    gate.verify_browser_input(browser,integrity)
    for name, change in [
        ("browser provenance hash differs",lambda p:p.update(browserDonorSha256='0'*64)),
        ("staged browser donor differs",lambda p:p['stagedInputHashesAfter'].update({'expected-prepared-donor.dxf':'0'*64})),
        ("destination byte identity differs",lambda p:p.update(targetSha256After='0'*64)),
        ("native harness identity differs",lambda p:p.update(nativeHarnessSha256='0'*64)),
        ("native process failed",lambda p:p.update(nativeProcessExitCode=1)),
    ]:
        mutated=copy.deepcopy(integrity);change(mutated)
        reject(name,lambda p=mutated:gate.verify_browser_input(browser,p))
    secondary_document=ezdxf.readfile(family/'target.dxf')
    gate.validate_secondary_before(secondary_document,'target-baseline')
    # Change only the loaded SDK interpretation; original file/Fraction oracle and
    # native report remain untouched. Secondary-oracle disagreement must still fail.
    secondary_document.blocks['LEAF'].query('LINE').first.dxf.end=(20,0,0)
    reject("secondary saved-DXF oracle disagreement",lambda:gate.validate_secondary_before(secondary_document,'target-baseline'))
    secondary_types=ezdxf.readfile(family/'target.dxf')
    secondary_types.modelspace().add_line((0,0),(1,1))
    reject("secondary model-space entity added",lambda:gate.validate_secondary_before(secondary_types,'target-baseline'))
    original=gate.POLICY
    with tempfile.TemporaryDirectory() as temporary:
        changed=Path(temporary)/'policy.json';changed.write_bytes(original.read_bytes()+b' ')
        try:
            gate.POLICY=changed
            reject("changed pinned policy bytes",gate.load_policy)
        finally:
            gate.POLICY=original
    return {"status":"pass","scope":"synthetic fail-closed validator tests; not native execution evidence",
            "mutationCount":len(passed),"rejectedMutations":passed}


if __name__ == '__main__':
    result=run()
    out=gate.ROOT/'artifacts/oracle';out.mkdir(parents=True,exist_ok=True)
    (out/'behavior-validator-selftest.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
