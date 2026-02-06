#!/bin/bash
#
# Pre-commit hook: Run linting and unit tests.
# Does NOT run integration or e2e tests.
#
# Install: ln -sf ../../git-hooks/pre-commit.sh .git/hooks/pre-commit

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track failures
FAILED=0

# Get repo root
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Run a command quietly, showing output only on failure
# Usage: run_quiet "label" command args...
run_quiet() {
    local label="$1"
    shift
    local output
    local exit_code

    printf "  %-30s" "$label"

    if output=$("$@" 2>&1); then
        echo -e "${GREEN}ok${NC}"
        return 0
    else
        exit_code=$?
        echo -e "${RED}FAILED${NC}"
        echo "$output"
        return $exit_code
    fi
}

echo -e "${YELLOW}Next.js${NC}"

cd "$REPO_ROOT/nextjs"

if ! run_quiet "typecheck" bun run typecheck; then
    FAILED=1
fi

if ! run_quiet "lint" bun run lint; then
    FAILED=1
fi

if ! run_quiet "unit tests" bun run test; then
    FAILED=1
fi

if ! run_quiet "build" bun run build; then
    FAILED=1
fi

#
# Summary
#
cd "$REPO_ROOT"

if [ $FAILED -ne 0 ]; then
    echo -e "${RED}Pre-commit checks failed${NC}"
    exit 1
fi

echo -e "${GREEN}All checks passed${NC}"
exit 0
