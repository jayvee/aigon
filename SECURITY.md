# Security Policy

## Supported versions

Only the latest minor version on the `2.x` line receives security fixes. Older versions are not supported.

| Version | Supported          |
|---------|--------------------|
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a vulnerability

**Please do not file a public GitHub issue for security reports.**

Preferred: use [GitHub Security Advisories](https://github.com/jayvee/aigon/security/advisories/new) to file a private report. This keeps the disclosure private until a fix is ready.

Fallback: email **security@senlabs.ai** with:
- A description of the issue
- Steps to reproduce
- Affected version(s)
- Any suggested mitigation

## Response time

This is a small open source project maintained on a best-effort basis. You can expect:

- **Initial acknowledgement**: within 7 days
- **Triage and severity assessment**: within 14 days
- **Fix and disclosure timeline**: depends on severity, communicated after triage

There is no formal SLA. For business-critical timelines, please reach out via senlabs.ai to discuss a commercial support arrangement.

## Scope

In scope:
- Code execution vulnerabilities in the `aigon` CLI
- Credential or secret leakage from the CLI, dashboard, or telemetry capture
- Path traversal or injection in workflow engine commands
- Authentication bypass in the AIGON server / dashboard

Out of scope:
- Issues in third-party agents (Claude Code, Gemini CLI, Codex CLI, Cursor) — please report those upstream
- Denial of service against developer tooling running on a user's own machine
- Self-XSS in the dashboard requiring local file access
- Issues only reproducible in non-supported configurations
