# TODO - SEP-10 backend security + verification hardening

- [ ] Inspect SEP-10 verification & route logic (already done in analysis phase)
- [x] Harden `verifyChallenge` signature + manageData checks in `backend/src/lib/sep10-auth.js`

- [x] Expand SEP-10 test coverage in `backend/src/lib/sep10-auth.test.js`

- [x] Minor route optimization/defensive checks in `backend/src/routes/auth.js`

- [ ] (Conditional) Optimize SQL query/index usage if confirmed necessary
- [ ] Run backend unit tests and ensure all pass
- [ ] Update any relevant documentation/audit notes if required by repo standards

