#!/bin/sh
# Alle Tests (lokaler Server auf :8472 nötig: python3 -m http.server 8472)
cd "$(dirname "$0")/.." || exit 1
fail=0
run() { echo "=== $*"; "$@" > "/tmp/fraktale_$(echo "$*" | tr ' /=-' '____').log" 2>&1 && echo "PASS" || { echo "FAIL (siehe /tmp/fraktale_*.log)"; fail=1; }; }
run node tests/node_core_test.js
run python3 tests/test_release.py
run python3 tests/test_truth.py --n=400 --tag=gpu_metal
run python3 tests/test_truth.py --n=400 --renderer=cpu --tag=cpu
run python3 tests/test_gestures.py
run python3 tests/test_ui.py
run python3 tests/test_features.py
run python3 tests/test_blend.py
run python3 tests/test_3d.py
exit $fail
