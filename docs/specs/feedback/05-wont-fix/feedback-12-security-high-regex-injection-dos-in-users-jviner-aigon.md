---
id: 12
title: "[Security] HIGH: regex_injection_dos in /Users/jviner/.aigon/worktrees/aigon/feature-532-cu-security-scan-2026-w21/lib/entity.js"
status: "wont-fix"
type: "security"
reporter:
  name: ""
  identifier: ""
source:
  channel: ""
  reference: ""
severity: "high"
tags: ["semgrep-fp", "security-scan"]
transitions:
  - { from: "inbox", to: "wont-fix", at: "2026-06-17T23:56:41.289Z", actor: "cli/feedback-triage" }
---

## Summary

Security finding from automated scan.

**Tool:** semgrep
**Category:** regex_injection_dos
**Severity:** HIGH
**Confidence:** 80%
**File:** /Users/jviner/.aigon/worktrees/aigon/feature-532-cu-security-scan-2026-w21/lib/entity.js:71
**Fingerprint:** `f2d680041b7a32da00f51bfef769763f7047be102ad38aca08cdf04427153667`

## Details

ajinabraham.njsscan.dos.regex_injection.regex_injection_dos: User controlled data in RegExp() can make the application vulnerable to layer 7 DoS. If user input is used to create a regular expression without validation, it can be exploited to create a complex regular expression that takes an excessive amount of time to evaluate. This can lead to a Denial of Service (DoS) attack where the application becomes unresponsive. Even if a ReDoS attack is not intended, poorly crafted or complex regular expressions from user input can cause performance issues that impact the responsiveness of an application. Always sanitize and validate user input to ensure that only safe, expected characters are used in the pattern. This can be done by whitelisting known safe characters and escaping potentially harmful ones.

## To suppress

Add to `.scan/suppressions.json`:
```json
{ "fingerprint": "f2d680041b7a32da00f51bfef769763f7047be102ad38aca08cdf04427153667", "status": "fp", "note": "reason here" }
```
