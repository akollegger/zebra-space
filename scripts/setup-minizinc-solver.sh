#!/usr/bin/env bash
# Diagnose-and-fix routine for the MiniZinc + finite-domain (CP) solver prerequisite
# (ADR-002, research.md Finding 1). Never installs packages — only registers a solver
# that's already present on disk but not wired up to the `minizinc` driver.
set -euo pipefail

PREFERRED_SOLVER="${1:-Gecode}"

if ! command -v minizinc >/dev/null 2>&1; then
  echo "minizinc not found on PATH." >&2
  echo "Install it, then re-run this script:" >&2
  echo "  macOS:          brew install minizinc" >&2
  echo "  Debian/Ubuntu:  apt-get install minizinc" >&2
  echo "  Other:          https://www.minizinc.org/software.html" >&2
  exit 1
fi

echo "minizinc found: $(minizinc --version | head -1)"

if minizinc --solvers 2>/dev/null | grep -q '\bcp\b'; then
  echo "A usable finite-domain (CP) solver is already registered:"
  minizinc --solvers | grep '\bcp\b'
  exit 0
fi

echo "No CP-tagged solver registered. Looking for an installed-but-unregistered ${PREFERRED_SOLVER}..."

GECODE_PREFIX=""
if command -v brew >/dev/null 2>&1; then
  GECODE_PREFIX="$(brew --prefix gecode 2>/dev/null || true)"
fi

if [ -z "$GECODE_PREFIX" ] || [ ! -x "$GECODE_PREFIX/bin/fzn-gecode" ]; then
  echo "Gecode's fzn-gecode executable was not found." >&2
  echo "Install it, then re-run this script:" >&2
  echo "  macOS:          brew install gecode" >&2
  echo "  Other:          https://www.gecode.org/download.html" >&2
  exit 1
fi

MZNLIB="$GECODE_PREFIX/share/gecode/mznlib"
EXECUTABLE="$GECODE_PREFIX/bin/fzn-gecode"

if [ ! -d "$MZNLIB" ]; then
  echo "Found $EXECUTABLE but its mznlib directory is missing at $MZNLIB." >&2
  exit 1
fi

USER_SOLVER_DIR="$(minizinc --config-dirs | grep -o '"userSolverConfigDir" *: *"[^"]*"' | sed -E 's/.*: *"([^"]*)"/\1/')"

if [ -z "$USER_SOLVER_DIR" ]; then
  echo "Could not determine MiniZinc's user solver config directory (minizinc --config-dirs)." >&2
  exit 1
fi

mkdir -p "$USER_SOLVER_DIR"

cat > "$USER_SOLVER_DIR/gecode.msc" << EOF
{
  "id": "org.gecode.gecode",
  "name": "Gecode",
  "description": "Gecode FlatZinc executable",
  "mznlib": "$MZNLIB",
  "executable": "$EXECUTABLE",
  "tags": ["cp", "gecode", "int", "float"],
  "stdFlags": ["-a", "-n", "-p", "-s", "-r", "-v", "-t"],
  "supportsMzn": false,
  "supportsFzn": true,
  "needsSolns2Out": true,
  "needsMznExecutable": false,
  "needsStdlibDir": false,
  "isGUIApplication": false
}
EOF

echo "Registered Gecode at $USER_SOLVER_DIR/gecode.msc"

if ! minizinc --solvers 2>/dev/null | grep -q '\bcp\b'; then
  echo "Registration written, but Gecode still doesn't appear in 'minizinc --solvers'." >&2
  exit 1
fi

echo "Verifying with a smoke-test model..."
SMOKE_DIR="$(mktemp -d)"
trap 'rm -rf "$SMOKE_DIR"' EXIT
echo 'var 1..3: x; constraint x > 1; solve satisfy;' > "$SMOKE_DIR/smoke.mzn"

if minizinc --output-mode json "$SMOKE_DIR/smoke.mzn" | grep -q '"x"'; then
  echo "Smoke test passed. MiniZinc + Gecode are ready."
else
  echo "Smoke test failed after registration." >&2
  exit 1
fi
