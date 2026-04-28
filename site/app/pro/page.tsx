import type { Metadata } from "next";
import fs from "fs";
import path from "path";

export const metadata: Metadata = {
  title: "Aigon Pro — Deeper Insights Into Your AI Development Workflow",
  description:
    "Agent quality metrics, trend charts, and AI-powered coaching. See what Aigon Pro adds to your development workflow.",
  openGraph: {
    title: "Aigon Pro — Deeper Insights Into Your AI Development Workflow",
    description:
      "Agent quality metrics, trend charts, and AI-powered coaching for AI-assisted development.",
    type: "website",
    url: "https://www.aigon.build/pro",
    siteName: "Aigon",
    images: [
      {
        url: "/img/og-image.png",
        width: 1200,
        height: 630,
        alt: "Aigon Pro — agent quality metrics, trend charts, AI-powered coaching",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aigon Pro — Deeper Insights Into Your AI Development Workflow",
    description:
      "Agent quality metrics, trend charts, and AI-powered coaching for AI-assisted development.",
    images: ["/img/og-image.png"],
  },
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-aigon-orange/30 bg-aigon-orange/10 px-3 py-1 text-xs font-medium tracking-wide text-aigon-orange uppercase">
      {children}
    </span>
  );
}

function ScreenshotFrame({
  src,
  alt,
  caption,
  figureClassName,
}: {
  src: string;
  alt: string;
  caption?: string;
  figureClassName?: string;
}) {
  const filePath = path.join(process.cwd(), "public", src);
  const exists = fs.existsSync(filePath);

  return (
    <figure className={`mt-8 ${figureClassName ?? ""}`.trim()}>
      {exists ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 shadow-lg dark:border-white/5 dark:shadow-[0_12px_32px_rgba(0,0,0,0.3)]">
          <img
            src={src}
            alt={alt}
            width={1200}
            height={632}
            loading="lazy"
            className="w-full"
          />
        </div>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center dark:border-white/10 dark:bg-white/3">
          <span className="text-xs font-medium tracking-widest text-gray-400 uppercase dark:text-gray-500">
            Screenshot coming soon
          </span>
          <span className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
            {alt}
          </span>
        </div>
      )}
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-white/6 dark:bg-gradient-to-br dark:from-aigon-orange/3 dark:to-aigon-teal/2 dark:shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
      <h3 className="mb-2 font-[family-name:var(--font-sora)] text-lg font-semibold text-gray-900 dark:text-[hsl(0_0%_94%)]">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}

export default function ProPage() {
  return (
    <div className="min-h-screen">
      {/* Preview banner — Pro is not yet for sale */}
      <div className="border-b border-aigon-orange/30 bg-aigon-orange/10 px-6 py-3 text-center text-sm text-aigon-orange">
        <strong>Preview.</strong> Aigon Pro is in development and <strong>not yet available for purchase</strong>. This page describes features being built — follow{" "}
        <a
          href="https://www.aigon.build"
          className="underline hover:no-underline"
        >
          aigon.build
        </a>{" "}
        for launch updates.
      </div>

      {/* Hero */}
      <section className="px-6 pt-24 pb-16 md:pt-32 md:pb-20">
        <div className="mx-auto max-w-3xl text-center">
          <Badge>Coming Soon</Badge>
          <h1 className="mt-6 font-[family-name:var(--font-sora)] text-4xl font-bold leading-tight tracking-tight text-gray-900 dark:text-[hsl(0_0%_95%)] md:text-5xl">
            Aigon Pro
            <br />
            <span className="text-aigon-orange">
              deeper insights into your AI development workflow
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 dark:text-gray-400">
            Aigon Pro adds agent quality metrics, trend charts, and AI-powered
            coaching to your dashboard &mdash; so you can see which agents
            deliver, how your workflow evolves, and where to improve.
          </p>
        </div>
      </section>

      {/* Leading screenshot */}
      <section className="px-6 pb-8">
        <div className="mx-auto max-w-5xl">
          <ScreenshotFrame
            src="/img/insights-pro.png"
            alt="Aigon Pro insights — AI-generated observations and coaching"
          />
        </div>
      </section>

      {/* Agent Quality Metrics */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-widest text-aigon-teal uppercase">
              Agent Quality
            </p>
            <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
              Metrics that matter
            </h2>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-400">
              See at a glance how your agents perform. First-pass rate, commits
              per feature, and rework ratio give you a clear picture of code
              quality and efficiency.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              title="First-Pass Rate"
              description="Percentage of features that pass evaluation on the first attempt — no rework needed."
            />
            <FeatureCard
              title="Commits per Feature"
              description="Median commits per feature. Lower values mean more focused, single-pass implementations."
            />
            <FeatureCard
              title="Rework Ratio"
              description="Percentage of commits that are fixes. Trending down means agents are getting it right the first time."
            />
          </div>

          <ScreenshotFrame
            src="/img/summary-pro.png"
            alt="Aigon Pro reports summary — first-pass rate, commits per feature, rework ratio, and agent leaderboard"
            caption="Summary tab — key quality metrics and agent leaderboard at a glance"
          />
        </div>
      </section>

      {/* Trend Charts */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-widest text-aigon-orange uppercase">
              Trend Charts
            </p>
            <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
              Watch your workflow evolve
            </h2>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-400">
              Five stacked charts with synchronized time axes &mdash; features
              completed, commits, cycle time, commits per feature, and rework
              ratio. Toggle daily, weekly, or monthly granularity.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <FeatureCard
              title="Cycle Time Trends"
              description="Track how long features take from start to close. Spot bottlenecks and measure process improvements."
            />
            <FeatureCard
              title="Rework Trends"
              description="See if fix commits are trending down over time — a signal that agent quality is improving."
            />
          </div>

          <ScreenshotFrame
            src="/img/charts-pro.png"
            alt="Aigon Pro trend charts — cycle time, commits, rework ratio over time"
            caption="Charts tab — five synchronized trend charts with daily, weekly, and monthly views"
          />
        </div>
      </section>

      {/* Cost & Token Visibility */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-widest text-aigon-orange uppercase">
              Cost Visibility
            </p>
            <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
              See exactly where your spend goes
            </h2>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-400">
              Token usage and cost tracked across every agent &mdash; broken
              down by phase, attributed per agent, and trended over time. No
              more guessing which features or workflows are expensive.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              title="Per-Agent Attribution"
              description="See which agents consume the most tokens and cost the most per feature. Make informed decisions about when to use which agent."
            />
            <FeatureCard
              title="Activity Breakdown"
              description="Costs split by implement, evaluate, and review phases. Understand where tokens are actually being spent across your workflow."
            />
            <FeatureCard
              title="Cost per Feature"
              description="Track spend per feature over time. Spot expensive workflows before they compound — and measure the impact of process changes."
            />
          </div>

          <ScreenshotFrame
            src="/img/tokens-per-week.png"
            alt="Aigon Pro cost visibility — token usage by agent and activity type, cost per feature trend"
            caption="Token activity chart — usage broken down by agent and phase (implement, evaluate, review)"
          />
        </div>
      </section>

      {/* AI Insights */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-widest text-aigon-teal uppercase">
              AI Insights
            </p>
            <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
              Coaching, not just charts
            </h2>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-400">
              Aigon Pro analyses your development patterns and surfaces
              actionable observations &mdash; which agents excel at what, where
              cycle time stalls, and how to get more from your workflow.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              title="Observations"
              description="AI-generated observations about your team's patterns — what's working and what's not."
            />
            <FeatureCard
              title="Coaching"
              description="Specific, actionable recommendations tailored to your workflow and agent mix."
            />
            <FeatureCard
              title="Patterns"
              description="See which habits and workflows correlate with better outcomes so you can double down on what works."
            />
          </div>

        </div>
      </section>

      {/* Reusable Workflows */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-widest text-aigon-teal uppercase">
              Reusable Workflows
            </p>
            <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
              One-click autonomous orchestration
            </h2>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-400">
              Save your favourite autonomous-run shapes as named workflows and launch
              them from the dashboard or CLI. No more retyping agent lists, reviewers,
              evaluators, or stop-after flags &mdash; pick a workflow and go.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              title="Named Templates"
              description="Capture stages as a slug — implement, review, revision, eval, close — then launch with aigon feature-autonomous-start --workflow=<slug>."
            />
            <FeatureCard
              title="Shared with Your Team"
              description="Project workflows live under .aigon/workflow-definitions/ and commit to git. Everyone on the repo gets the same configurations."
            />
            <FeatureCard
              title="Dashboard Pre-fill"
              description="The Start Autonomously modal exposes a Workflow dropdown plus a Save as workflow… button so you can capture and reuse configurations without leaving the UI."
            />
          </div>

          <ScreenshotFrame
            src="/img/workflow-choice.png"
            alt="Aigon Pro workflow selection — dropdown in Start Autonomously modal listing built-in and project workflows"
            caption="Pick a saved workflow from the Start Autonomously modal — built-ins, project, and global workflows all appear with provenance badges"
            figureClassName="mx-auto max-w-2xl lg:max-w-3xl"
          />
        </div>
      </section>

      {/* Scheduled features */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-widest text-aigon-orange uppercase">
              Scheduled Features
            </p>
            <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
              Run when it actually works for you
            </h2>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-400">
              Schedule when <strong>Start Autonomously</strong> runs &mdash; the same
              predefined workflow from kickoff through completion, just at a wall
              time you choose. That way autonomous work can span the night, or start
              right after your provider quota or budget window refreshes, without
              camping on the dashboard.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              title="Overnight runs"
              description="Queue a feature to start later and let long implement / eval cycles finish while you are away, instead of losing evening hours to babysitting sessions."
            />
            <FeatureCard
              title="Align with quota refresh"
              description="If you are rate-limited or waiting on a rolling budget reset, schedule the kickoff for the moment your allowance comes back so the run does not stall on day-one limits."
            />
            <FeatureCard
              title="Starts on its own"
              description="You set the clock time once when you schedule. When that time arrives, the server launches the autonomous run for you — you do not need to be at the machine to press Start Autonomously."
            />
          </div>

          <ScreenshotFrame
            src="/img/schedule_autonomous_start.png"
            alt="Start Autonomously modal — agents, workflow, and Run at (local) to schedule a deferred full autonomous run"
            caption="Schedule from the same Start Autonomously flow: choose your workflow, then set Run at instead of starting immediately."
            figureClassName="mx-auto max-w-2xl lg:max-w-3xl"
          />
        </div>
      </section>

      {/* Aigon Sync — vault */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-widest text-aigon-teal uppercase">
              State &amp; backup
            </p>
            <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
              Aigon Sync
            </h2>
            <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-400">
              Keep portable <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm dark:bg-white/10">.aigon</code>{" "}
              state in a <strong>private Git vault</strong> — push snapshots of workflow metadata, and pull down to another machine to resume your work.
            </p>
            <p className="mt-4 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
              Use <strong>Dashboard → Settings → Aigon Sync</strong> for remote URL, last sync times, cadence, and{" "}
              <strong>Sync now</strong>, or the <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-white/10">aigon backup</code> /{" "}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-white/10">aigon vault</code> CLI.
            </p>
            <p className="mt-6">
              <a
                href="/docs/guides/aigon-sync"
                className="inline-flex items-center gap-2 rounded-lg bg-aigon-orange px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aigon-orange/90 no-underline"
              >
                Read the Aigon Sync guide
              </a>
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              title="Private vault repo"
              description="Configure one HTTPS or SSH remote; snapshots land in a structured layout Pro can pull and merge safely."
            />
            <FeatureCard
              title="CLI + dashboard"
              description="Same engine from terminal (`aigon backup push`) or Settings → Aigon Sync when the server runs with @aigon/pro linked."
            />
            <FeatureCard
              title="Scheduled pushes"
              description="Optional daily, hourly, weekly, or off — the server tick checks whether a vault push is due when Pro is installed."
            />
          </div>
        </div>
      </section>

      {/* Integrations Direction */}
      <section className="px-6 pb-4 md:pb-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-[family-name:var(--font-sora)] text-2xl font-bold text-gray-900 dark:text-[hsl(0_0%_94%)]">
            Integrations
          </h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            Aigon&apos;s dashboard connects to tools you already use, starting with GitHub PR status on feature cards, with room for future integrations.
          </p>
        </div>
      </section>

      {/* Coming Soon Banner */}
      <section className="px-6 py-20 md:py-28">
        <div className="mx-auto max-w-3xl">
          <div className="relative overflow-hidden rounded-2xl border border-aigon-orange/20 bg-gradient-to-br from-aigon-orange/5 to-aigon-teal/5 px-8 py-14 text-center md:px-16 md:py-20">
            {/* Decorative glow */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(213,95,42,0.08),transparent_60%)]" />

            <div className="relative">
              <p className="mb-4 text-xs font-medium tracking-widest text-aigon-orange uppercase">
                Aigon Pro
              </p>
              <h2 className="font-[family-name:var(--font-sora)] text-3xl font-bold text-gray-900 dark:text-[hsl(0_0%_95%)] md:text-4xl">
                Coming soon
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-gray-600 dark:text-gray-400">
                Pro will be available as an optional add-on for teams and
                individuals who want deeper visibility into their AI development
                workflow. Aigon itself remains free and open-source.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <a
                  href="https://github.com/jayvee/aigon"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-[hsl(0_0%_25%)] dark:bg-[hsl(0_0%_12%)] dark:text-[hsl(0_0%_85%)] dark:hover:border-aigon-orange/30 dark:hover:bg-[hsl(0_0%_15%)]"
                >
                  Star on GitHub
                </a>
                <a
                  href="/docs"
                  className="inline-flex items-center gap-2 rounded-lg bg-aigon-orange px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aigon-orange/90"
                >
                  Read the Docs
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
