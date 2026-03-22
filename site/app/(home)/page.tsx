import Link from "next/link";
import { HeroTerminal } from "./hero-terminal";
import { DashboardGallery } from "./dashboard-gallery";

const problemCards = [
  {
    title: "Terminal tabs everywhere",
    text: "Parallel agents generate momentum, but tracking what each one did and why becomes manual overhead.",
  },
  {
    title: "Decisions get lost",
    text: "Without spec-linked workflows, merge decisions and implementation tradeoffs disappear into chat history.",
  },
  {
    title: "No clean comparison step",
    text: "Teams rarely compare multiple implementations side-by-side before merging the best approach.",
  },
  {
    title: "Feedback loops stay disconnected",
    text: "User feedback, research, and implementation often live in separate tools with no shared lifecycle.",
  },
];

const valueCards = [
  {
    tag: "Traceability",
    title: "Specs and decisions live in your repo",
    text: "Research, feature specs, implementation logs, and evaluations stay in Markdown files your team can review and version.",
    code: "docs/specs/features/03-in-progress/\ndocs/specs/features/logs/",
  },
  {
    tag: "Vendor independent",
    title: "Use the agents you already prefer",
    text: "Run the same workflow with Claude, Gemini, Cursor, and Codex without rewriting your process around one tool.",
    code: "aigon install-agent cc gg cx cu",
  },
  {
    tag: "Shared lifecycle",
    title: "Research, delivery, and feedback connect end to end",
    text: "Aigon links discovery, implementation, review, and follow-up so each cycle improves the next one.",
    code: "research -> feature -> eval -> close",
  },
  {
    tag: "Operational clarity",
    title: "Mode-based commands reduce team confusion",
    text: "Pick the right execution mode for each task and make expected behavior explicit before coding starts.",
    code: "aigon feedback-triage 14",
  },
];

const modeCards = [
  {
    tag: "Hands-on + one agent",
    title: "Drive mode",
    text: "Use when you want tight control over implementation details and review checkpoints.",
    code: "aigon feature-setup 07",
    outcome:
      "One guided implementation branch with a full spec and log trail.",
  },
  {
    tag: "Hands-on + multi-agent",
    title: "Fleet mode",
    text: "Orchestrate competing implementations you can evaluate and adopt the best from.",
    code: "aigon feature-setup 07 cc gg cx",
    outcome:
      "Parallel worktrees and comparable outputs for structured selection.",
  },
  {
    tag: "Hands-off + one agent",
    title: "Autopilot mode",
    text: "Use when the scope is clear and you want autonomous retries against validation checks.",
    code: "aigon feature-autopilot 07",
    outcome:
      "Automated implement-validate loop that stops when checks pass or budget ends.",
  },
  {
    tag: "Hands-off + multi-agent",
    title: "Swarm mode",
    text: "Fully orchestrated, fully autonomous \u2014 parallel agent runs converge into comparable outputs ready for evaluation.",
    code: 'aigon feature-setup 07 cc gg cx\naigon feature-autopilot 07 --auto-submit',
    outcome:
      "Concurrent autonomous runs across agents with logs ready for comparison.",
  },
];

const principles = [
  {
    title: "Open Source",
    text: "MIT licensed, no paid-tier lockouts.",
  },
  {
    title: "Repo-Native Context",
    text: "Specs, logs, and evaluations stay as plain Markdown in your repository.",
  },
  {
    title: "Agent-Agnostic",
    text: "Works with whichever coding agents your team chooses.",
  },
  {
    title: "Adapts to Your Stack",
    text: "Workflow templates and defaults adjust for web apps, APIs, iOS, Android, and libraries.",
  },
];

export default function HomePage() {
  return (
    <main className="landing-gradient-dark dark:landing-gradient-dark">
      {/* Hero */}
      <section className="py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-4">
            Spec-driven development &middot; Multi-agent orchestration
          </p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold font-[family-name:var(--font-heading)] leading-tight mb-6">
            Spec-driven AI development.
            <br />
            Orchestrate any agent &mdash; or all of them at once.
          </h1>
          <p className="text-lg text-fd-muted-foreground max-w-3xl mb-8">
            Aigon captures the full product lifecycle &mdash; research, feature
            delivery, and user feedback &mdash; in specs and logs committed
            directly to your repository. Run one agent with tight control, or
            orchestrate competing implementations in parallel &mdash; then
            evaluate and merge the best outcome.
          </p>
          <div className="flex flex-wrap gap-3 mb-10">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-aigon-orange text-white font-semibold hover:opacity-90 transition-opacity"
            >
              Start in 5 minutes
            </Link>
            <Link
              href="#workflow"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-white/10 text-fd-foreground font-semibold hover:border-aigon-orange/30 hover:bg-aigon-orange/5 transition-all"
            >
              How it works
            </Link>
          </div>
          <ul className="space-y-2 text-fd-muted-foreground text-sm">
            <li>
              Work visually with a Kanban board, drop to the CLI for scripting,
              or drive from slash commands inside your agent
            </li>
            <li>Four clear modes: Drive, Fleet, Autopilot, and Swarm</li>
            <li>
              Specs, logs, and research findings in Git &mdash; searchable,
              portable, permanent
            </li>
            <li>
              Works with Claude, Gemini, Cursor, and Codex &mdash; swap freely
              or run them head-to-head
            </li>
            <li>No required SaaS account, plain files in Git</li>
          </ul>
        </div>

        {/* Fleet showcase */}
        <div className="max-w-5xl mx-auto px-6 mt-16">
          <p className="text-sm text-fd-muted-foreground mb-6 text-center">
            Codex and Gemini compete, Claude Code evaluates &mdash; best
            implementation wins.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                label: "1. Fleet started \u2014 agents implementing in parallel",
                src: "/img/aigon-dashboard-01-fleet-start.gif",
              },
              {
                label: "2. Both submitted \u2014 Claude Code evaluating",
                src: "/img/aigon-dashboard-02-fleet-evaluation.gif",
              },
              {
                label: "3. Evaluation complete \u2014 winner merged",
                src: "/img/aigon-dashboard-03-fleet-submitted.gif",
              },
            ].map((step) => (
              <div key={step.label}>
                <p className="text-xs text-fd-muted-foreground mb-2">
                  {step.label}
                </p>
                <div className="rounded-lg landing-image overflow-hidden">
                  <img
                    src={step.src}
                    alt={step.label}
                    className="w-full"
                    loading="lazy"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="py-16 border-t border-white/[0.06]" id="problem">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
            The problem
          </p>
          <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-10">
            AI agents multiply output fast, but coordination breaks down even
            faster.
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {problemCards.map((card) => (
              <article
                key={card.title}
                className="rounded-xl p-6 landing-card"
              >
                <h3 className="font-semibold mb-2">{card.title}</h3>
                <p className="text-sm text-fd-muted-foreground">{card.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CLI Demo */}
      <section className="py-16 border-t border-white/[0.06]" id="cli-demo">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
            CLI in action
          </p>
          <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-8">
            Slash commands inside your agent &mdash; one workflow at every level
            of control.
          </h2>
          <HeroTerminal />
        </div>
      </section>

      {/* Value */}
      <section className="py-16 border-t border-white/[0.06]" id="value">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
            Value proposition
          </p>
          <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-10">
            Aigon turns multi-agent output into an auditable delivery system.
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {valueCards.map((card) => (
              <article
                key={card.title}
                className="rounded-xl p-6 landing-card"
              >
                <p className="text-xs font-bold tracking-wider uppercase text-aigon-teal mb-2">
                  {card.tag}
                </p>
                <h3 className="font-semibold mb-2">{card.title}</h3>
                <p className="text-sm text-fd-muted-foreground mb-3">
                  {card.text}
                </p>
                <pre className="text-xs bg-aigon-terminal text-aigon-terminal-text p-3 rounded-lg overflow-x-auto">
                  <code>{card.code}</code>
                </pre>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="py-16 border-t border-white/[0.06]" id="workflow">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
            How it works
          </p>
          <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-4">
            Research, build, learn &mdash; on repeat.
          </h2>

          {/* Lifecycle diagram */}
          <div className="my-10 flex items-center justify-center gap-2 flex-wrap text-sm font-mono">
            <span className="px-3 py-1.5 rounded-lg bg-aigon-teal/10 border border-aigon-teal text-aigon-teal">
              Research
            </span>
            <span className="text-fd-muted-foreground">&rarr;</span>
            <span className="px-3 py-1.5 rounded-lg bg-aigon-orange/10 border border-aigon-orange text-aigon-orange">
              Features
            </span>
            <span className="text-fd-muted-foreground">&rarr;</span>
            <span className="px-3 py-1.5 rounded-lg bg-aigon-orange/10 border border-aigon-orange/30 text-aigon-orange">
              Build
            </span>
            <span className="text-fd-muted-foreground">&rarr;</span>
            <span className="px-3 py-1.5 rounded-lg bg-aigon-orange/10 border border-aigon-orange/30 text-aigon-orange">
              Evaluate
            </span>
            <span className="text-fd-muted-foreground">&rarr;</span>
            <span className="px-3 py-1.5 rounded-lg bg-aigon-teal/10 border border-aigon-teal text-aigon-teal">
              Ship
            </span>
            <span className="text-fd-muted-foreground">&larr;</span>
            <span className="px-3 py-1.5 rounded-lg bg-aigon-blue/10 border border-aigon-blue text-aigon-blue">
              Feedback
            </span>
          </div>

          {/* Modes */}
          <div className="mt-16">
            <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
              Choose your mode
            </p>
            <h3 className="text-2xl font-bold font-[family-name:var(--font-heading)] mb-8">
              Hands-on or hands-off, one agent or many.
            </h3>
            <div className="grid sm:grid-cols-2 gap-6">
              {modeCards.map((card) => (
                <article
                  key={card.title}
                  className="rounded-xl p-6 landing-card"
                >
                  <p className="text-xs font-bold tracking-wider uppercase text-aigon-teal mb-2">
                    {card.tag}
                  </p>
                  <h3 className="font-semibold mb-2">{card.title}</h3>
                  <p className="text-sm text-fd-muted-foreground mb-3">
                    {card.text}
                  </p>
                  <pre className="text-xs bg-aigon-terminal text-aigon-terminal-text p-3 rounded-lg overflow-x-auto mb-3">
                    <code>{card.code}</code>
                  </pre>
                  <p className="text-xs text-fd-muted-foreground">
                    Outcome: {card.outcome}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Dashboard */}
      <section className="py-16 border-t border-white/[0.06]" id="dashboard">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
            Your workflow, visualised
          </p>
          <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-4">
            A Kanban board for spec-driven development.
          </h2>
          <p className="text-fd-muted-foreground mb-8 max-w-3xl">
            The Aigon Dashboard is the visual way into your spec-driven
            workflow. Same pipeline, same agents &mdash; but managed through a
            browser UI instead of CLI commands.
          </p>
          <DashboardGallery />

          <div className="grid sm:grid-cols-2 gap-6 mt-10">
            <article className="rounded-xl p-6 landing-card">
              <p className="text-xs font-bold tracking-wider uppercase text-aigon-teal mb-2">
                Visual Workflow
              </p>
              <h3 className="font-semibold mb-2">Drag specs from inbox to done</h3>
              <p className="text-sm text-fd-muted-foreground">
                Move features through your development pipeline with a familiar
                Kanban interface.
              </p>
            </article>
            <article className="rounded-xl p-6 landing-card">
              <p className="text-xs font-bold tracking-wider uppercase text-aigon-teal mb-2">
                Monitor
              </p>
              <h3 className="font-semibold mb-2">
                See every agent, every repo, at a glance
              </h3>
              <p className="text-sm text-fd-muted-foreground">
                Running sessions, attention items, and recent events across all
                your repositories.
              </p>
            </article>
            <article className="rounded-xl p-6 landing-card">
              <p className="text-xs font-bold tracking-wider uppercase text-aigon-teal mb-2">
                Measure
              </p>
              <h3 className="font-semibold mb-2">
                Throughput, cycle time, agent performance
              </h3>
              <p className="text-sm text-fd-muted-foreground">
                Know which agents ship fastest, how your cycle time trends, and
                whether your pace is accelerating.
              </p>
            </article>
            <article className="rounded-xl p-6 landing-card">
              <p className="text-xs font-bold tracking-wider uppercase text-aigon-teal mb-2">
                Remote Access
              </p>
              <h3 className="font-semibold mb-2">
                Monitor agents from your phone
              </h3>
              <p className="text-sm text-fd-muted-foreground">
                Open the dashboard on your phone over LAN, or use Tailscale to
                check on agents from anywhere.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Docs / Quickstart */}
      <section className="py-16 border-t border-white/[0.06]" id="docs-section">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-12">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
              Documentation
            </p>
            <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-6">
              Install in minutes, then run your first end-to-end loop.
            </h2>
            <pre className="text-sm bg-aigon-terminal text-aigon-terminal-text p-4 rounded-lg overflow-x-auto mb-4">
              <code>{`git clone https://github.com/jayvee/aigon.git
cd aigon
npm install
npm link
cd /path/to/your/project
aigon init
aigon install-agent cc gg cx cu`}</code>
            </pre>
            <p className="text-sm text-fd-muted-foreground mb-2">
              Then, in Claude Code:
            </p>
            <pre className="text-sm bg-aigon-terminal text-aigon-terminal-text p-4 rounded-lg overflow-x-auto">
              <code>{`/aigon:feature-now dark-mode
Implement a dark mode capability to the website,
with dark mode/light mode toggle in the top right
position of the menu bar`}</code>
            </pre>
          </div>
          <div className="space-y-4">
            <Link
              href="/docs/getting-started"
              className="block rounded-xl p-6 landing-card hover:border-aigon-orange/30 transition-all"
            >
              <h3 className="font-semibold mb-1">Getting Started</h3>
              <p className="text-sm text-fd-muted-foreground">
                Install, initialize, and run your first feature loop.
              </p>
            </Link>
            <Link
              href="/docs/guides/drive-mode"
              className="block rounded-xl p-6 landing-card hover:border-aigon-orange/30 transition-all"
            >
              <h3 className="font-semibold mb-1">Workflow Guide</h3>
              <p className="text-sm text-fd-muted-foreground">
                Research, specs, implementation, evaluation, and completion
                flow.
              </p>
            </Link>
            <Link
              href="/docs/reference/cli-commands"
              className="block rounded-xl p-6 landing-card hover:border-aigon-orange/30 transition-all"
            >
              <h3 className="font-semibold mb-1">CLI Reference</h3>
              <p className="text-sm text-fd-muted-foreground">
                Complete command reference with examples.
              </p>
            </Link>
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section className="py-16 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-12">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
              Tech &amp; philosophy
            </p>
            <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-4">
              Open source, git-native, and intentionally simple.
            </h2>
            <p className="text-fd-muted-foreground">
              Aigon is built for teams who want disciplined AI-assisted
              engineering, not opaque automation.
            </p>
          </div>
          <ul className="space-y-4">
            {principles.map((p) => (
              <li
                key={p.title}
                className="border-l-2 border-aigon-orange/40 pl-4"
              >
                <strong className="block mb-0.5">{p.title}</strong>
                <span className="text-sm text-fd-muted-foreground">
                  {p.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Community */}
      <section className="py-16 border-t border-white/[0.06]" id="community">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-aigon-orange mb-3">
            Community
          </p>
          <h2 className="text-3xl font-bold font-[family-name:var(--font-heading)] mb-4">
            Help shape the next generation of collaborative AI development.
          </h2>
          <p className="text-fd-muted-foreground mb-8 max-w-2xl mx-auto">
            Contribute specs, improve workflows, and share real-world patterns
            for running multi-agent engineering teams effectively.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="https://github.com/jayvee/aigon"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-aigon-orange text-white font-semibold hover:opacity-90 transition-opacity"
            >
              Star on GitHub
            </a>
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-white/10 text-fd-foreground font-semibold hover:border-aigon-orange/30 hover:bg-aigon-orange/5 transition-all"
            >
              Install guide
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-sm text-fd-muted-foreground">
          <span>Aigon</span>
          <span>
            The spec-driven orchestration layer for AI development.
          </span>
          <span>MIT License</span>
        </div>
      </footer>
    </main>
  );
}
