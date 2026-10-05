"""Run the unchanged native harness with the exact browser-exported donor.

No local QCAD build is performed. All consumer sources/config/logs remain in an
already provisioned ephemeral CI runner; only original observations are retained.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import behavior_acceptance as acceptance
from audit_snapshot import demand, SnapshotError
from diagnostics import classify
from fixture_oracle import minimal_patch

ROOT = Path(__file__).resolve().parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(browser_donor, output):
    browser_donor, output = Path(browser_donor).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    demand(not (output / "native-gate.json").exists(), "Refusing to reuse an existing native report")
    result = {"schema": 1, "status": "fail", "phase": "input-verification", "nativeExitCode": None,
              "rawLogsPublished": False, "strictZeroRepair": "not_overridden"}
    integrity = {"schema": 1, "status": "fail"}
    temporary_log = None
    try:
        demand("RUNNER_TEMP" in os.environ and "QCAD_ROOT" in os.environ, "Ephemeral CI consumer environment is required")
        family = ROOT / "fixtures/owner-complete"
        target_bytes = (family / "target.dxf").read_bytes()
        donor_bytes = (family / "donor.dxf").read_bytes()
        browser_bytes = browser_donor.read_bytes()
        mapping = json.loads((family / "expected.json").read_text())["rename_map"]
        patched, edits = minimal_patch(donor_bytes, mapping)
        demand(len(edits) == 9 and patched == browser_bytes, "Browser donor violates the independent nine-span byte proof")
        acceptance.verify_inputs()
        acceptance.verify_file(browser_donor)
        integrity.update(browserDonorSha256=digest(browser_bytes), changedNameTokens=len(edits),
                         targetSha256Before=digest(target_bytes),
                         nativeHarnessSha256=digest((ROOT / "tests/native/gate.js").read_bytes()),
                         sourceRevision=os.environ.get("GITHUB_SHA"))
        # TemporaryDirectory removes staged own inputs, configuration and raw log on
        # normal completion or handled failure. Workflow cleanup is a second layer.
        with tempfile.TemporaryDirectory(prefix="blockbridge-behavior-", dir=os.environ["RUNNER_TEMP"]) as temporary:
            temporary = Path(temporary)
            staging, config, runtime = temporary / "fixtures", temporary / "config", temporary / "runtime"
            for folder in (staging, config, runtime):
                folder.mkdir()
            runtime.chmod(0o700)
            for name in ("target.dxf", "donor.dxf", "outer-only-donor.dxf"):
                shutil.copyfile(family / name, staging / name)
            # This is the actual browser artifact, not a regenerated expected fixture.
            shutil.copyfile(browser_donor, staging / "expected-prepared-donor.dxf")
            hashes = lambda: {file.name: digest(file.read_bytes()) for file in sorted(staging.glob("*.dxf"))}
            integrity["stagedInputHashesBefore"] = hashes()
            env = dict(os.environ, QT_QPA_PLATFORM="offscreen", XDG_RUNTIME_DIR=str(runtime))
            qcad = Path(os.environ["QCAD_ROOT"]).resolve()
            env["LD_LIBRARY_PATH"] = str(qcad / "release") + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
            env["QT_PLUGIN_PATH"] = subprocess.check_output(["qmake", "-query", "QT_INSTALL_PLUGINS"], text=True).strip()
            command = [str(qcad / "release/qcad-bin"), "-platform", "offscreen", "-no-gui", "-allow-multiple-instances",
                       "-config", str(config), "-autostart", str(ROOT / "tests/native/gate.js"),
                       "-bb-fixtures", str(staging), "-bb-output", str(output)]
            result["phase"] = "native-runtime"
            temporary_log = temporary / "runtime.log"
            try:
                with temporary_log.open("w") as stream:
                    completed = subprocess.run(command, cwd=qcad, env=env, stdout=stream,
                                               stderr=subprocess.STDOUT, timeout=300, check=False)
                result["nativeExitCode"] = completed.returncode
                integrity["nativeProcessExitCode"] = completed.returncode
            except subprocess.TimeoutExpired:
                result["diagnostic"] = {"classification": "runtime_timeout"}
                raise SnapshotError("Native runtime exceeded its five-minute limit")
            finally:
                integrity["stagedInputHashesAfter"] = hashes()
                integrity["targetSha256After"] = digest((family / "target.dxf").read_bytes())
                demand(integrity["stagedInputHashesBefore"] == integrity["stagedInputHashesAfter"], "Native input bytes changed")
                demand(integrity["targetSha256Before"] == integrity["targetSha256After"], "Destination bytes changed")
                demand(browser_donor.read_bytes() == browser_bytes, "Browser artifact bytes changed")
                if temporary_log.exists():
                    result["diagnostic"] = classify(temporary_log.read_text(errors="replace"))
            demand(completed.returncode == 0, "Native process failed")
            integrity["status"] = "pass"
            (output / "input-integrity.json").write_text(json.dumps(integrity, indent=2) + "\n")
            result["phase"] = "scoped-native-validation"
            accepted = acceptance.run(output, ROOT / "artifacts/native/build-summary.json", browser_donor)
            result.update(status="pass", phase="complete", scopedNativeBehavior=accepted["scopedNativeBehavior"],
                          strictZeroRepair=accepted["strictZeroRepair"], nativeAssertions=accepted["nativeAssertions"])
            result.pop("diagnostic", None)
    except Exception as error:
        result["exceptionClass"] = type(error).__name__
        if isinstance(error, (AssertionError, SnapshotError)):
            result["message"] = str(error)
        else:
            result["message"] = "Native behavior gate could not complete"
        if result["phase"] == "scoped-native-validation":
            (output / "native-behavior.json").write_text(json.dumps({
                "schema": 1, "scopedNativeBehavior": "fail", "strictZeroRepair": "not_overridden",
                "phase": result["phase"], "exceptionClass": result["exceptionClass"], "message": result["message"]
            }, indent=2) + "\n")
    finally:
        (output / "input-integrity.json").write_text(json.dumps(integrity, indent=2) + "\n")
        (output / "runtime-summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser-donor", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    raise SystemExit(run(args.browser_donor, args.output))
