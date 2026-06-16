# False-positive playground

These examples are near-miss fixtures for detector calibration. Each rule directory
contains code that should remain quiet for that rule even though it resembles a
pattern DebtLens commonly inspects.

The guard tests in `tests/fixtures/quality/calibration.test.ts` scan each directory
with its matching rule and assert that no issues are reported. Add a new near-miss
here when tuning a detector or documenting a false-positive regression.
