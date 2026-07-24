# Verification record

Verification date: 2026-07-21. Environment: macOS, Google Chrome 150.0.7871.129 and Node.js 25.9.0. Profile enrichment used only local workspace sources; no website or other internet facts were imported.

## 1.0.2 picker acknowledgement verification

- Headless Chrome browser harness: **65/65 passed, 0 failed**.
- The Chrome API fake now delivers callback-style tab messages to registered listeners and exposes `runtime.lastError` during the callback when no listener responds.
- A valid synchronous `LBA_OPEN_PICKER_ACK` clears the action badge without an unreachable diagnostic. Missing receivers and malformed acknowledgements retain the `!` badge and the exact unreachable title.
- The full localhost restricted-iframe route injects, acknowledges delivery, shows the exact `IFRAME_ACCESS_RESTRICTION` toast, opens no picker, performs no insertion, and clears rather than sets the action badge.
- Browser-internal top-level pages still bypass injection and retain their existing per-tab restriction explanation.
- All 17 JavaScript files pass `node --check`.
- The profile validator passes with **521 primitive entries**; both profile copies remain byte-identical with SHA-256 `57e62715cc2462af4f95396484b6ae5384c25d857ff3024b7983cf1812cc036f`.
- Manifest version is `1.0.2`; its SHA-256 is `64b52941e5cb7d419b63c3767409c22977920fc322b61fd42e6d4bd8b30f5192`.
- Manifest/path checks confirm the exact existing permissions, no `host_permissions`, and every referenced path. The updated service-worker SHA-256 is `4cf6d15d41e3d689881058388b481e170a17c71128a36d33a31d122ba247a148`.
- Unsafe-HTML, dynamic-execution, and production remote-URL scans passed.
- The localhost manual page rendered in headless Chrome with the supported company-name field, conditional telephone note, and intentional restricted-iframe fixture.
- A visible Chrome launch with a fresh temporary profile opened the localhost manual page, but branded Chrome did not expose this unpacked extension or its `background/service-worker.js` through DevTools. Real toolbar/shortcut confirmation therefore remains pending through the ordinary **Load unpacked** flow.

## Enriched profile and 1.0.1 verification

- Dependency-free profile validator: passed with **521 primitive entries**.
- Both profile copies parse, are byte-identical, and have SHA-256 `57e62715cc2462af4f95396484b6ae5384c25d857ff3024b7983cf1812cc036f`.
- The validator passed required-section, EN/ES parity, Spain-Spanish terminology, `_80`/`_160`/`_300`/`_500` maximum-length, duplicate-path, empty-string, HTML, prohibited-content, and search smoke checks.
- Pricing and public company telephone data are intentionally absent. The unconfirmed `company.founded_year`, `company.employee_range`, and `products.trustprompt.pricing_summary` paths were removed.
- Existing extension storage is not migrated. Users who imported an older sample must re-import `examples/sample-profile.json` to receive the enriched data.
- Headless Chrome browser harness: **61/61 passed, 0 failed**.
- All 17 JavaScript files pass `node --check`.
- The `1.0.1` manifest SHA-256 was `3b7f3600a2001bcbf717655bcb919def714480b73e7ad0c6e91c2f1fa1c77636`.
- Manifest/path checks confirm the exact existing permissions, no `host_permissions`, and all 11 referenced paths. The service-worker SHA-256 remains `1561817d01de1a1e93af22fbbfcdff6b974f5a89252ce75b011d9c7731fcf728`.
- Unsafe-HTML, dynamic-execution, remote-URL, submission/CAPTCHA, and profile-identity scans passed. The sole production `fetch` remains the packaged picker stylesheet.
- Headless manual-page execution passed and exposed the supported company-name label, conditional telephone note, and intentional restricted-iframe negative-test labels.

## Historical Phase 9 evidence

Phase 9 was gated before release-document or version changes:

- Headless Chrome browser harness: **61/61 passed, 0 failed**. The harness loads production content and service-worker scripts against browser fakes and exercises their registered Chrome listeners; it contains no production-only hooks.
- `node --check` over every JavaScript file: passed.
- Manifest parse, exact permissions, absent `host_permissions`, Alt+J/Option+J command, CSP, referenced paths, and injection order: passed.
- Phase 9 manifest SHA-256: `5809c5a1d1ae4febabe03d4d5cf275d296e95b936830617c825d42d0d1793ef3`.
- Frozen service-worker SHA-256: `1561817d01de1a1e93af22fbbfcdff6b974f5a89252ce75b011d9c7731fcf728`.
- Both profile files parsed, compared byte-for-byte, and produced SHA-256 `6e9b8e9e20f820addd73ff4eb84ead0de44d4fa61d8fbac0a3844a3e6ff61585`.
- Unsafe-HTML, dynamic-execution, submission/CAPTCHA, networking, sensitive-logging, stored-DOM/context, and empty-catch scans: passed.

The original final release audit repeated the complete gate after the isolated `1.0.0` version bump:

- Headless Chrome browser harness: **61/61 passed, 0 failed**.
- `node --check` on all 15 JavaScript files: passed.
- Replacing final manifest version `1.0.0` with `0.1.0` recreates the Phase 9 manifest hash above, proving the version is its only contract change.
- Manifest/path/injection, profile bytes/hash, service-worker hash, security/privacy/scope scans, required error templates, manual-surface accessibility/control checks, and verbatim README safety statement: passed.

Representative automated browser coverage includes flattening and storage repair, search/ranking, framework-compatible insertion, text-only contenteditable behavior, exact maxlength override, removed targets, storage failures, safe no-results text, toast actions, same-origin nested-frame resolution, sandboxed-frame rejection, current unsupported-field precedence, last-supported fallback, context-menu idempotence, restricted-tab badges, and the injection/acknowledgement routes.

## §29 final review

1. **Passed — syntax:** all 17 current JavaScript files pass `node --check`; the inline manual-page script also executed when the page was rendered in headless Chrome.
2. **Passed — manifest paths:** every service worker, options page, icon, and web-accessible resource exists.
3. **Passed by listener harness; pending visible browser confirmation — service worker:** production worker listeners execute in the harness, including valid, missing, and malformed acknowledgement routes. The actual-unpacked CLI attempt is described below.
4. **Passed by static/headless review; pending visible browser confirmation — options:** all referenced scripts/controls exist, initialization errors are surfaced, and malformed JSON retains native parse detail plus computed line/column/position where available.
5. **Passed — injection logic:** the exact 12-file injection order, active-tab target, and synchronous response contract are asserted by the listener harness.
6. **Passed — one context menu:** two installation events each call `removeAll` then create exactly one `lba-insert` editable-context item.
7. **Passed — command:** `open-picker` declares Alt+J and Option+J; command listener routing is asserted.
8. **Passed — no remote resources:** production JavaScript has no HTTP(S) literal; CSP permits only self-hosted scripts/objects.
9. **Passed — no networking:** the sole production `fetch` requests packaged `content/picker.css` via `chrome.runtime.getURL()`.
10. **Passed — safe imported JSON:** production has no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function`; previews/results use `textContent` or text nodes.
11. **Passed — least privilege:** permissions remain exactly `storage`, `contextMenus`, `activeTab`, and `scripting`, with no `host_permissions`.
12. **Passed — no submission:** no form submission, submit-button click, or CAPTCHA interaction API exists; the manual page deliberately has no form or submit control.
13. **Passed — protected fields:** password/payment detection and every required unsupported type are classified before picker opening and again before insertion.
14. **Passed — oversized gate:** a 7-character value against maxlength 3 remains unchanged until the exact **Insert anyway** button is activated, after which it is inserted untruncated.
15. **Passed — readable failures:** all §17 templates are centralized; automated coverage checks no profile/action, unsupported/missing/restricted targets, repair notice combination, removed targets, exact length alert, storage errors, failed/restricted injection, and safe empty search. Options import/storage failures use centralized inline-alert labels.

## Acceptance scenario

“Passed (automated)” means the underlying production behavior was directly exercised in headless Chrome. Visible extension-toolbar, shortcut, context-menu, options, and lifecycle interactions remain explicitly pending because they were not genuinely performed.

1. **Pending manual Chrome verification** — load the extension unpacked through `chrome://extensions`.
2. **Pending manual Chrome verification** — open the options page from the installed extension.
3. **Pending manual Chrome verification** — re-import the enriched `examples/sample-profile.json` through the file picker.
4. **Pending manual Chrome verification** — visually confirm the imported count is 521 entries.
5. **Passed (automated)** — `tests/manual-test.html` renders locally and its inline behavior executes without a test-runner failure.
6. **Pending manual Chrome verification** — focus its textarea in the unpacked-extension session.
7. **Pending manual Chrome verification** — press Alt+J in the real browser UI.
8. **Pending manual Chrome verification** — visually confirm picker opening from that shortcut.
9. **Pending manual Chrome verification** — type `company 160` in the real picker.
10. **Pending manual Chrome verification** — visually confirm the matching description.
11. **Pending manual Chrome verification** — press Enter in the real picker.
12. **Passed (automated)** — production insertion places the selected value in the target without truncation.
13. **Passed (automated)** — production insertion emits bubbling, composed `input` and `change` events; the manual page displays both per field.
14. **Passed (automated)** — successful insertion records the selected path under Recent with no DOM/context or duplicated profile value.
15. **Pending manual Chrome verification** — focus the manual page URL field.
16. **Pending manual Chrome verification** — choose **Insert business data** from the real editable-field context menu.
17. **Pending manual Chrome verification** — visually confirm picker opening for that URL field.
18. **Passed (automated)** — URL field context boosts HTTP(S)-style website values in deterministic ranking.
19. **Pending manual Chrome verification** — insert a website through the real context-menu flow.
20. **Passed (automated/static)** — no code path submits a form, clicks Submit, or interacts with CAPTCHA.
21. **Passed (automated/static)** — data uses only `chrome.storage.local`; no host permissions, remote resources, telemetry, or third-party network requests exist.

No scenario step failed.

## Actual unpacked-Chrome and scanner limitations

Headless and visible Google Chrome 150 launches were attempted with fresh temporary user-data directories, `--load-extension`, and `--disable-extensions-except`. The visible attempt opened the localhost manual page and exposed its page and sandboxed-iframe targets, but neither attempt exposed this extension or its `background/service-worker.js`; the branded browser ignored command-line unpacked-extension loading. Therefore toolbar, Alt+J, context-menu, options, and service-worker lifecycle interactions were not marked passed. They require the ordinary visible **Load unpacked** flow described in the README.

Snyk Code 1.1305.1 was run with `snyk code test --json`. It exited with code 2 and returned `{"ok":false,"error":"The request cannot be processed."}`, so no hosted Snyk result was available. The equivalent local review passed: prohibited DOM/dynamic-code APIs, unauthorized fetch/URL literals, submission/CAPTCHA automation, sensitive/value-bearing logs, persisted DOM/context objects, empty catches, permission expansion, and protected-field bypass were scanned or manually audited. The dependency-free extension has no package dependency tree to audit.
