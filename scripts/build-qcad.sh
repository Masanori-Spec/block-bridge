#!/usr/bin/env bash
# Original source-only consumer build. Never place or cache third-party files in the repository.
set -euo pipefail
: "${RUNNER_TEMP:?This build is restricted to an ephemeral hosted CI runner}"
: "${GITHUB_WORKSPACE:?Run this source-build gate through GitHub Actions}"
export QCAD_ROOT="$RUNNER_TEMP/blockbridge-consumer/qcad"
export QCAD_TAG='v3.33.1.0'
export QCAD_COMMIT='897079c2d11aaa0869f839a6cf5df8a937dbddbe'
export BUILD_STAGE='checkout'
export QCAD_VERIFIED_COMMIT=''
export QCAD_QT_VERSION=''
mkdir -p "$RUNNER_TEMP/blockbridge-consumer" "$GITHUB_WORKSPACE/artifacts/native"
log="$RUNNER_TEMP/blockbridge-source-build.log"
trap 'code=$?; export BUILD_EXIT_CODE=$code; python3 "$GITHUB_WORKSPACE/tests/native/build_summary.py"; exit "$code"' EXIT
# The isolated parent has no qcadpro/qcadcam sibling modules.
git clone --quiet --depth 1 --branch "$QCAD_TAG" https://github.com/qcad/qcad.git "$QCAD_ROOT" >"$log" 2>&1
actual="$(git -C "$QCAD_ROOT" rev-parse HEAD)"
[[ "$actual" == "$QCAD_COMMIT" ]]
export QCAD_VERIFIED_COMMIT="$actual"
export BUILD_STAGE='qt-version'
export QCAD_QT_VERSION="$(qmake -query QT_VERSION)"
[[ "$QCAD_QT_VERSION" == '5.15.3' ]]
[[ -d "$QCAD_ROOT/src/3rdparty/qt-labs-qtscriptgenerator-5.15.3" ]]
export BUILD_STAGE='configure'
(cd "$QCAD_ROOT" && qmake -r CONFIG+=ractivated) >>"$log" 2>&1
export BUILD_STAGE='compile'
(cd "$QCAD_ROOT" && make -j2 release) >>"$log" 2>&1
export BUILD_STAGE='verify-build'
[[ -x "$QCAD_ROOT/release/qcad-bin" ]]
[[ -f "$QCAD_ROOT/plugins/libqcaddxf.so" ]]
# Fail closed if a non-CE module somehow reached the isolated consumer directory.
if find "$QCAD_ROOT/plugins" -maxdepth 1 -type f -iname '*qcadpro*' -print -quit | grep -q .; then
    exit 1
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
    printf 'QCAD_ROOT=%s\n' "$QCAD_ROOT" >> "$GITHUB_ENV"
fi
export BUILD_STAGE='complete'
printf 'Pinned QCAD Community Edition source build completed\n'
