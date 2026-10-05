"""Convert private third-party logs into original allowlisted diagnostic facts.

Never return a raw log line, source excerpt, arbitrary path, or compiler message.
"""
from pathlib import Path
import re


def classify(text):
    result = {"classification": "unclassified_failure"}
    checks = [
        (r"Killed signal|out of memory|Cannot allocate memory", "build_memory_exhausted"),
        (r"Could not resolve host|Temporary failure in name resolution", "network_dns_failure"),
        (r"Failed to connect|Connection timed out|Connection reset", "network_connection_failure"),
        (r"could not connect to display|Could not load the Qt platform plugin", "qt_platform_initialization_failure"),
        (r"No script handler|Script bindings not available", "qt_script_bindings_missing"),
        (r"undefined reference to|cannot find -l", "link_dependency_failure"),
        (r"SyntaxError", "javascript_syntax_error"),
        (r"ReferenceError", "javascript_reference_error"),
        (r"TypeError", "javascript_type_error"),
        (r"Segmentation fault|segmentation fault", "native_process_crash"),
    ]
    for pattern, category in checks:
        if re.search(pattern, text):
            result["classification"] = category
            break
    missing = re.search(r"fatal error:\s*([A-Za-z0-9_./+-]+): No such file or directory", text)
    if missing:
        result.update(classification="missing_include", include_basename=Path(missing.group(1)).name)
    module = re.search(r"Unknown module\(s\) in QT:\s*([A-Za-z0-9_ -]+)", text)
    if module:
        result.update(classification="missing_qt_module", modules=module.group(1).strip().split())
    location = re.search(r"(?:^|\n)(?:[A-Za-z0-9_./+-]+/)?([A-Za-z0-9_.+-]+\.(?:cpp|cc|c|h)):(\d+)(?::\d+)?: (?:fatal )?error:", text)
    if location:
        result.update(file_basename=location.group(1), line=int(location.group(2)))
        if result["classification"] == "unclassified_failure":
            result["classification"] = "cpp_compile_error"
    symbol = re.search(r"(?:Can't find variable:|is not defined[: ]*)\s*([A-Za-z_$][A-Za-z0-9_$]*)", text)
    if symbol:
        result["identifier"] = symbol.group(1)
    return result
