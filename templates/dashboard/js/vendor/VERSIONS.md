# Vendored dashboard libraries

Static assets under `templates/dashboard/js/vendor/`. Not npm `dependencies` — copied from pinned upstream releases at vendor time. Update this file whenever you bump a vendored file.

| Library | npm package | Version | Vendored file(s) | Upstream dist path |
| --- | --- | --- | --- | --- |
| Alpine.js | `alpinejs` | 3.15.12 | `alpine/alpine.min.js` | `dist/cdn.min.js` |
| marked | `marked` | 15.0.12 | `marked/marked.min.js` | `marked.min.js` (jsdelivr unpinned alias) |
| Chart.js | `chart.js` | 4.5.1 | `chart.js/chart.umd.min.js` | `dist/chart.umd.min.js` |
| chartjs-adapter-date-fns | `chartjs-adapter-date-fns` | 3.0.0 | `chartjs-adapter-date-fns/chartjs-adapter-date-fns.bundle.min.js` | `dist/chartjs-adapter-date-fns.bundle.min.js` |
| xterm.js | `@xterm/xterm` | 5.5.0 | `xterm/xterm.js`, `xterm/xterm.css` | `lib/xterm.js`, `css/xterm.css` |
| xterm addon-fit | `@xterm/addon-fit` | 0.10.0 | `xterm/addon-fit.js` | `lib/addon-fit.js` |
| xterm addon-webgl | `@xterm/addon-webgl` | 0.18.0 | `xterm/addon-webgl.js` | `lib/addon-webgl.js` |
| xterm addon-unicode11 | `@xterm/addon-unicode11` | 0.8.0 | `xterm/addon-unicode11.js` | `lib/addon-unicode11.js` |
| xterm addon-web-links | `@xterm/addon-web-links` | 0.11.0 | `xterm/addon-web-links.js` | `lib/addon-web-links.js` |

Pinned on 2026-07-08 to match jsdelivr floating-tag resolution (`alpinejs@3`, `chart.js@4`, `chartjs-adapter-date-fns@3`, unpinned `marked`).
