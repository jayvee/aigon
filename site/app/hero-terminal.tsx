"use client";

import { useState } from "react";
import { TerminalWindow } from "@/components/terminal-window";

const demos = {
  "Claude Code": {
    ps1: "> ",
    lines: [
      { type: "output" as const, text: "\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e" },
      { type: "output" as const, text: "\u2502 Claude Code           v1.0.32        \u2502" },
      { type: "output" as const, text: "\u2502  /help for commands                  \u2502" },
      { type: "output" as const, text: "\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f" },
      { type: "output" as const, text: " " },
      { type: "input" as const, text: "/aigon:feature-do 07", delay: 600 },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Reading spec: feature-07-jwt-auth.md" },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  \u2713 Task 1/5: Create auth middleware" },
      { type: "output" as const, text: "  \u2713 Task 2/5: Add JWT token validation" },
      { type: "output" as const, text: "  \u2713 Task 3/5: Implement refresh token flow" },
      { type: "output" as const, text: "  \u25d0 Task 4/5: Writing integration tests..." },
      { type: "output" as const, text: "  \u2713 Task 4/5: Integration tests (8/8 passing)" },
      { type: "output" as const, text: "  \u2713 Task 5/5: Update API documentation" },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  All tasks complete \u00b7 12 files changed" },
      { type: "output" as const, text: "  Ready for your review." },
    ],
  },
  "Fleet Setup": {
    ps1: "codex> ",
    lines: [
      { type: "output" as const, text: " " },
      { type: "input" as const, text: "aigon feature-setup 07 cc gg cx", delay: 400 },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Fleet mode \u00b7 3 agents" },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  \u2713 Worktree: feature-07-cc  (Claude Code)" },
      { type: "output" as const, text: "  \u2713 Worktree: feature-07-gg  (Gemini CLI)" },
      { type: "output" as const, text: "  \u2713 Worktree: feature-07-cx  (Codex)" },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Spec copied to all worktrees." },
      { type: "output" as const, text: "  Agents ready \u2014 run /aigon:feature-do 07" },
      { type: "output" as const, text: "  in each session." },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Open all: aigon worktree-open 07 --all" },
    ],
  },
  "Gemini CLI": {
    ps1: "gemini> ",
    lines: [
      { type: "output" as const, text: " " },
      { type: "input" as const, text: "/aigon:research-do 03", delay: 400 },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Topic: auth strategy for mobile" },
      { type: "output" as const, text: "  Reading: research-03-auth-strategy-for-mobile.md" },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Investigating: Passkey / biometric auth..." },
      { type: "output" as const, text: "  Investigating: Social OAuth (Google + Apple)..." },
      { type: "output" as const, text: "  Investigating: Magic link email flow..." },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Findings written: logs/research-03-gg-findings.md" },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Key recommendations:" },
      { type: "output" as const, text: "  1. Passkey as primary \u2014 best UX, strongest security" },
      { type: "output" as const, text: "  2. Social OAuth fallback \u2014 covers older devices" },
      { type: "output" as const, text: "  3. Magic link for email-only accounts" },
      { type: "output" as const, text: " " },
      { type: "output" as const, text: "  Research complete \u00b7 waiting for synthesis." },
    ],
  },
};

type DemoKey = keyof typeof demos;

export function HeroTerminal() {
  const [active, setActive] = useState<DemoKey>("Claude Code");
  const demo = demos[active];

  return (
    <div>
      <div className="flex gap-1 mb-4" role="group" aria-label="Choose agent demo">
        {(Object.keys(demos) as DemoKey[]).map((name) => (
          <button
            key={name}
            onClick={() => setActive(name)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              active === name
                ? "bg-aigon-orange text-white"
                : "landing-tab text-muted"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <TerminalWindow
        key={active}
        lines={demo.lines}
        ps1={demo.ps1}
        title={active}
      />
    </div>
  );
}
