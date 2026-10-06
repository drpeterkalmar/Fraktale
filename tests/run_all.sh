#!/bin/sh
# Alle Tests (lokaler Server auf :8472 nötig: python3 -m http.server 8472)
# Flugtests im sichtbaren Fenster (FK_HEADED=1): headless drosselt macOS den Bildtakt auf ~8 Bilder/s, dann fliegt
# der Flug zu langsam und die Zoom-Schwellen fallen (auch mit 6.5.1 gemessen, 06.10.2026)
cd "$(dirname "$0")/.." || exit 1
fail=0
run() { echo "=== $*"; "$@" > "/tmp/fraktale_$(echo "$*" | tr ' /=-' '____').log" 2>&1 && echo "PASS" || { echo "FAIL (siehe /tmp/fraktale_*.log)"; fail=1; }; }
run node tests/unit/run.js
run node tests/node_core_test.js
run python3 tests/test_release.py
run python3 tests/test_truth.py --n=400 --tag=gpu_metal
run python3 tests/test_truth.py --n=400 --renderer=cpu --tag=cpu
run python3 tests/test_gestures.py
run python3 tests/test_ui.py
run python3 tests/test_features.py
run python3 tests/test_blend.py
run env FK_HEADED=1 python3 tests/test_3d.py
run python3 tests/test_smooth.py
run env FK_HEADED=1 python3 tests/test_v62.py
run python3 tests/test_v63.py
run python3 tests/test_v64.py
run env FK_HEADED=1 python3 tests/test_fly64.py
run python3 tests/test_gpu_guard.py
run python3 tests/test_context_loss.py
run python3 tests/test_fix_ref.py
run python3 tests/test_shader_fail.py
run python3 tests/test_bla_stall.py
run python3 tests/test_shader_async.py
run env FK_HEADED=1 python3 tests/test_memory3d.py
exit $fail
