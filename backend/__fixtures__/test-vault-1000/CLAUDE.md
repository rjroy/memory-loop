# Test Vault with 1000 Files

This vault contains 1000 programmatically generated markdown files for performance testing.

## Purpose

- REQ-NF-1: Test aggregation completes in <1s for 1000 files
- REQ-NF-2: Test similarity computation completes in <500ms for 1000 items
- REQ-SC-3: Test cached similarity returns in <100ms

## Generation

Files are generated deterministically using a seeded random number generator.
The generator script is embedded in the test file to ensure reproducibility.
