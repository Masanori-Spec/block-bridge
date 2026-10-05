"""Run QCAD headlessly and retain a concise original failure record in every outcome."""
import json
import os
from pathlib import Path
import subprocess
import sys
from diagnostics import classify

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/native"
TEMP = Path(os.environ["RUNNER_TEMP"])
QCAD = Path(os.environ["QCAD_ROOT"])
OUT.mkdir(parents=True, exist_ok=True)
config, runtime = TEMP / "blockbridge-config", TEMP / "blockbridge-runtime"
config.mkdir(exist_ok=True)
runtime.mkdir(exist_ok=True, mode=0o700)
runtime.chmod(0o700)
env = dict(os.environ, QT_QPA_PLATFORM="offscreen", XDG_RUNTIME_DIR=str(runtime))
env["LD_LIBRARY_PATH"] = str(QCAD / "release") + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
log = TEMP / "blockbridge-native-runtime.log"
result = {"schema": 1, "status": "fail", "phase": "native-runtime-start", "exit_code": None,
          "raw_logs_published": False, "timeout_seconds": 300}
try:
    env["QT_PLUGIN_PATH"] = subprocess.check_output(["qmake", "-query", "QT_INSTALL_PLUGINS"], text=True).strip()
    command = [str(QCAD / "release/qcad-bin"), "-platform", "offscreen", "-no-gui",
               "-allow-multiple-instances", "-config", str(config),
               "-autostart", str(ROOT / "tests/native/gate.js"),
               "-bb-fixtures", str(ROOT / "fixtures"), "-bb-output", str(OUT)]
    with log.open("w") as stream:
        completed = subprocess.run(command, cwd=QCAD, env=env, stdout=stream,
                                   stderr=subprocess.STDOUT, timeout=300, check=False)
    result["exit_code"] = completed.returncode
    result["phase"] = "native-runtime-finished"
    native_file = OUT / "native-gate.json"
    native = json.loads(native_file.read_text()) if native_file.exists() else None
    if native is not None:
        result["native_report_status"] = native.get("status")
        # This is our harness's own exception, not an arbitrary third-party log line.
        if native.get("failure"):
            result["harness_failure"] = native["failure"]
    if completed.returncode == 0 and native is not None:
        result["phase"] = "native-report-validation"
        import summarize
        summarize.run()
        result["status"] = "pass"
        result["phase"] = "complete"
    else:
        result["diagnostic"] = classify(log.read_text(errors="replace"))
        if native is None:
            result["report_missing"] = True
except subprocess.TimeoutExpired:
    result.update(phase="native-runtime-timeout", diagnostic={"classification": "runtime_timeout"})
except Exception as error:
    # Keep only the exception class for unexpected runtime/setup errors. Paths and raw
    # native messages remain private. The native report carries our assertion messages.
    result["exception_class"] = type(error).__name__
    if log.exists():
        result["diagnostic"] = classify(log.read_text(errors="replace"))
finally:
    (OUT / "runtime-summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
sys.exit(0 if result["status"] == "pass" else 1)
