"""Original, compact provenance record; deliberately excludes third-party build logs."""
import json
import os
from pathlib import Path
from diagnostics import classify

root = Path(os.environ["GITHUB_WORKSPACE"])
code = int(os.environ["BUILD_EXIT_CODE"])
report = {
    "schema": 1,
    "status": "pass" if code == 0 else "fail",
    "stage": os.environ["BUILD_STAGE"],
    "consumer": "QCAD Community Edition, official GPL source build",
    "source_url": "https://github.com/qcad/qcad",
    "source_tag": os.environ["QCAD_TAG"],
    "expected_source_commit": os.environ["QCAD_COMMIT"],
    "verified_source_commit": os.environ.get("QCAD_VERIFIED_COMMIT") or None,
    "qt_version_required": "5.15.3",
    "qt_version_observed": os.environ.get("QCAD_QT_VERSION") or None,
    "platform": "ubuntu-22.04",
    "source_and_binary_published": False,
    "raw_logs_published": False,
    "pro_trial_used": False,
}
if code:
    logfile = Path(os.environ["RUNNER_TEMP"]) / "blockbridge-source-build.log"
    if logfile.exists():
        report["diagnostic"] = classify(logfile.read_text(errors="replace"))
(root / "artifacts/native/build-summary.json").write_text(json.dumps(report, indent=2) + "\n")
