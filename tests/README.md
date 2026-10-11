# Test entry points

Run the maintained self-hosted release checks from the repository root:

```sh
npm test
npm run test:selfhost
npx playwright install chromium
npm run test:browser
```

`npm test` executes all 50 deterministic circuit, chip, protocol, debugger,
storage and compatibility suites through `scripts/test.cjs`. Its fixtures are
checked in under `tests/fixtures`; it does not require prior QA output, a cloud
service, Python, or a developer's local runtime directory.

`test:selfhost` exercises the real Node/SQLite server, authentication, process
locking, backups and worker lifecycle. `test:browser` exercises local account
flows and the game through the self-hosted HTTP server.

## Historical specialist harnesses

The other scripts in `tests/browser/`, `tests/worker-v*.cjs` and
`tests/soak-v*.cjs` retain earlier release acceptance workflows for reference and
targeted regression work. They are **not** part of the self-hosted default test
commands. Some expect a static game preview, an extracted historical offline
package, or a hosted Worker configured with isolated loopback test identities.
The self-hosted server deliberately ignores those identity headers; a hosted
test harness must not be pointed at it as a substitute for real login testing.
Use the account-based self-hosted tests for this release.

Browser scripts use the project `playwright` package. Generic Chromium runs use
the browser installed by Playwright; `CHROME_PATH` may select an explicit local
executable. Tests that name the Chrome or Edge channel require that browser to
be installed, or `CHROME_PATH` / `EDGE_PATH` respectively. Firefox and WebKit
require `npx playwright install firefox webkit`. WebKit emulation does not
constitute physical Safari/iOS validation. Each specialist script documents its
own URL or package environment variables near the beginning.

Historical scripts can write generated reports into `qa/` or `test-results/`.
Those outputs are not fixtures and are not needed to run the maintained suites.
