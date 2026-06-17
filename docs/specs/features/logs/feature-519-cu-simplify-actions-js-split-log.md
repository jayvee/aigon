# Implementation Log: Feature 519 - simplify-actions-js-split
Agent: cu

Split `actions.js` (3482 LOC) into shell (342 LOC) + `actions-picker.js` + `budget-widget.js` + lazy ESM modules under `templates/dashboard/js/actions/`; iterate + browser smoke green. Initial eager JS ~38% smaller vs monolith; modal modules load on first click.
