# Released compatibility fixtures

`shared-v6.challenge.json` is the unchanged v0.6 AND-gate challenge exported by
the original browser acceptance workflow. Its original content fingerprint is
`sha256:ea8e0f38ea57d0bab493116215a4e32fce963cfca86717e31ac9fad159bce66d`.

The fixture contains circuit definitions, layout and verification inputs. It
contains no accounts, cookies, tokens, private URLs or machine-specific paths.
`release-v7.test.cjs` imports it with the original engine version and hash, then
executes its original verification contract. Do not regenerate this fixture
with the current engine: that would remove the compatibility check.
