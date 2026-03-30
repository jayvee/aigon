#!/usr/bin/env node
/**
 * Fixture generator for Aigon e2e tests.
 *
 * Creates realistic project repos in ~/src/:
 *   - brewboard/     — a SaaS app for tracking craft beer collections
 *   - brewboard-api/ — the REST API backend
 *   - trailhead/     — a personal iOS hiking app
 *
 * Each repo is a real git repo with:
 *   - Realistic project files (package.json, src/, etc.)
 *   - Full docs/specs/ directory structure (via aigon init)
 *   - Pre-seeded Aigon state (features, research, feedback) with known IDs
 *   - Real commits with realistic messages
 *
 * Usage:
 *   node test/setup-fixture.js
 *
 * Existing fixture repos in ~/src/ are deleted and recreated.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync, execSync } = require('child_process');

const FIXTURES_DIR = path.join(os.homedir(), 'src');
const CLI_PATH = path.join(__dirname, '..', 'aigon-cli.js');

// ─── helpers ──────────────────────────────────────────────────────────────────

function runGit(args, cwd) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
}

function runAigon(args, cwd) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd,
        env: { ...process.env, HOME: path.join(FIXTURES_DIR, '.home') },
        encoding: 'utf8',
        stdio: 'pipe',
    });
    return result;
}

function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function gitConfig(cwd) {
    runGit(['config', 'user.email', 'test@aigon.test'], cwd);
    runGit(['config', 'user.name', 'Aigon Test'], cwd);
}

function initGitRepo(dir) {
    runGit(['init', '-b', 'main'], dir);
    gitConfig(dir);
    // Silence detached HEAD advice
    runGit(['config', 'advice.detachedHead', 'false'], dir);
}

function commit(cwd, message) {
    runGit(['add', '-A'], cwd);
    runGit(['commit', '-m', message, '--allow-empty'], cwd);
}

function getGitHubUser() {
    try {
        return execSync('gh api user --jq .login', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (e) {
        console.log('  ⚠️  gh CLI not available — skipping GitHub remote setup');
        return null;
    }
}

function addGitHubRemote(repoDir, repoName, ghUser) {
    const remoteUrl = `https://github.com/${ghUser}/${repoName}.git`;
    try {
        // Create repo if it doesn't exist (ignore error if it already exists)
        execSync(`gh repo create ${repoName} --private --description "Aigon seed repo" 2>/dev/null || true`, { stdio: 'pipe' });
        runGit(['remote', 'add', 'origin', remoteUrl], repoDir);
        execSync('git push --force -u origin main', { cwd: repoDir, stdio: 'pipe' });
        console.log(`  ✓ Pushed ${repoName} to ${remoteUrl}`);
    } catch (e) {
        console.log(`  ⚠️  Could not push ${repoName} to GitHub: ${e.message}`);
    }
}

// ─── feature spec helpers ─────────────────────────────────────────────────────

function featureInboxContent(title, summary, ac, approach) {
    const acLines = (ac || ['Feature is implemented and working']).map(a => `- [ ] ${a}`).join('\n');
    const techApproach = approach || 'Implement as described in the acceptance criteria. Keep changes minimal.';
    return `# Feature: ${title}\n\n## Summary\n\n${summary}\n\n## Acceptance Criteria\n\n${acLines}\n\n## Technical Approach\n\n${techApproach}\n\n## Out of Scope\n\n- Do NOT write tests\n- Do NOT add documentation\n- Do NOT refactor existing code\n- Only create/edit the files listed in the acceptance criteria\n\n## Validation\n\n\`\`\`bash\necho "Feature ${title} validated"\n\`\`\`\n`;
}

function featureBacklogContent(id, title, summary, ac, approach) {
    return featureInboxContent(title, summary, ac, approach);
}


function featureDoneContent(id, title, summary) {
    return featureInboxContent(title, summary);
}


// Ports: brewboard=4200, brewboard-api=4210, trailhead=4220 (well clear of 3000-range dev servers and 4100-range dashboards)
const FIXTURE_PORTS = {
    brewboard: 4200,
    'brewboard-api': 4210,
    trailhead: 4220,
};

function writeFixtureConfig(repoDir) {
    const repoName = path.basename(repoDir);
    const port = FIXTURE_PORTS[repoName] || 4200;

    // Use production-grade models so workflow testing is realistic.
    // Cheap models skip process steps (e.g. writing status files directly
    // instead of running `aigon agent-status`), giving false negatives.
    const config = {
        agents: {
            cc: { models: {} },
            gg: { models: {} },
            cx: { models: {} },
        },
        devProxy: {
            basePort: port,
        },
    };
    const aigonDir = path.join(repoDir, '.aigon');
    fs.mkdirSync(aigonDir, { recursive: true });
    write(path.join(aigonDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

    // Write .env with PORT so worktree setup doesn't warn
    write(path.join(repoDir, '.env'), `PORT=${port}\n`);
}

function researchContent(title, summary) {
    return `# Research: ${title}\n\n## Summary\n\n${summary}\n\n## Questions\n\n- [ ] What are the main trade-offs?\n- [ ] What do competitors do?\n\n## Findings\n\nTBD\n`;
}

function feedbackContent(id, title, summary, status, type = 'bug', severity = 'medium', evidence = '', impact = '') {
    return `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\ntype: ${type}\nseverity: ${severity}\n---\n\n# Feedback: ${title}\n\n## Summary\n\n${summary}\n\n## Evidence\n\n${evidence || 'Awaiting reproduction steps.'}\n\n## Impact\n\n${impact || 'Assessing user impact.'}\n`;
}

// ─── brewboard fixture ────────────────────────────────────────────────────────

function createBrewboard(repoDir) {
    console.log('  Creating brewboard/ ...');
    fs.mkdirSync(repoDir, { recursive: true });
    initGitRepo(repoDir);

    // Project files
    write(path.join(repoDir, 'package.json'), JSON.stringify({
        name: 'brewboard',
        version: '0.1.0',
        private: true,
        description: 'Track and share your craft beer collection',
        scripts: {
            dev: 'next dev',
            build: 'next build',
            start: 'next start',
            test: 'jest'
        },
        dependencies: {
            next: '^14.0.0',
            react: '^18.0.0',
            'react-dom': '^18.0.0'
        }
    }, null, 2));

    write(path.join(repoDir, 'README.md'), '# BrewBoard\n\nTrack and share your craft beer collection. Rate beers, follow breweries, and discover what\'s on tap near you.\n');
    write(path.join(repoDir, '.gitignore'), 'node_modules/\n.next/\n.env*.local\n');

    write(path.join(repoDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2017',
            lib: ['dom', 'dom.iterable', 'esnext'],
            allowJs: true,
            skipLibCheck: true,
            strict: false,
            noEmit: true,
            esModuleInterop: true,
            module: 'commonjs',
            resolveJsonModule: true,
            jsx: 'preserve',
        },
        include: ['src'],
    }, null, 2));

    write(path.join(repoDir, 'next.config.js'), `module.exports = {};\n`);


    // Layout with metadata, global styles, and Geist font
    write(path.join(repoDir, 'src', 'app', 'layout.tsx'), `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BrewBoard',
  description: 'Track and share your craft beer collection',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-amber-50 text-stone-800 min-h-screen">{children}</body>
    </html>
  );
}
`);

    // Global CSS with Tailwind
    write(path.join(repoDir, 'src', 'app', 'globals.css'), `@tailwind base;
@tailwind components;
@tailwind utilities;
`);

    // Home page with beer collection
    write(path.join(repoDir, 'src', 'app', 'page.tsx'), `import { BeerCard } from '@/components/BeerCard';

const BEERS = [
  { id: 1, name: 'Hazy IPA', brewery: 'Mountain Goat', style: 'IPA', rating: 4.5 },
  { id: 2, name: 'Pale Ale', brewery: 'Stone & Wood', style: 'Pale Ale', rating: 4.2 },
  { id: 3, name: 'Stout', brewery: 'Pirate Life', style: 'Stout', rating: 4.8 },
  { id: 4, name: 'Lager', brewery: 'Balter', style: 'Lager', rating: 3.9 },
  { id: 5, name: 'Sour Cherry', brewery: 'Wildflower', style: 'Sour', rating: 4.6 },
  { id: 6, name: 'West Coast IPA', brewery: 'Hop Nation', style: 'IPA', rating: 4.3 },
];

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto p-8">
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-stone-900">BrewBoard</h1>
        <p className="text-stone-500 mt-2">Your craft beer collection</p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {BEERS.map(beer => (
          <BeerCard key={beer.id} {...beer} />
        ))}
      </div>
    </main>
  );
}
`);

    // BeerCard component
    write(path.join(repoDir, 'src', 'components', 'BeerCard.tsx'), `type BeerCardProps = {
  name: string;
  brewery: string;
  style: string;
  rating: number;
};

export function BeerCard({ name, brewery, style, rating }: BeerCardProps) {
  return (
    <div className="bg-white rounded-lg border border-stone-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="font-semibold text-lg text-stone-900">{name}</h2>
          <p className="text-stone-500 text-sm">{brewery}</p>
        </div>
        <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded">{style}</span>
      </div>
      <div className="mt-3 flex items-center gap-1">
        {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
        <span className="text-stone-400 text-sm ml-1">{rating}</span>
      </div>
    </div>
  );
}
`);

    write(path.join(repoDir, 'src', 'lib', 'api.ts'), `export async function fetchBeers() {\n  const res = await fetch('/api/beers');\n  return res.json();\n}\n`);

    // Tailwind config
    write(path.join(repoDir, 'tailwind.config.ts'), `import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
export default config;
`);

    // PostCSS config for Tailwind
    write(path.join(repoDir, 'postcss.config.mjs'), `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
export default config;
`);

    // Update package.json with Tailwind deps
    write(path.join(repoDir, 'package.json'), JSON.stringify({
        name: 'brewboard',
        version: '0.1.0',
        private: true,
        description: 'Track and share your craft beer collection',
        scripts: {
            dev: 'next dev --port $PORT',
            build: 'next build',
            start: 'next start',
        },
        dependencies: {
            next: '^14.2.0',
            react: '^18.3.0',
            'react-dom': '^18.3.0',
        },
        devDependencies: {
            tailwindcss: '^3.4.0',
            postcss: '^8.4.0',
            autoprefixer: '^10.4.0',
            typescript: '^5.0.0',
            '@types/react': '^18.3.0',
            '@types/node': '^20.0.0',
        },
    }, null, 2));

    // Update next.config with path aliases
    write(path.join(repoDir, 'next.config.js'), `/** @type {import('next').NextConfig} */\nmodule.exports = {};\n`);

    // Update tsconfig with path aliases
    write(path.join(repoDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2017',
            lib: ['dom', 'dom.iterable', 'esnext'],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: 'preserve',
            incremental: true,
            plugins: [{ name: 'next' }],
            paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
    }, null, 2));

    // Install dependencies
    console.log('    Installing npm dependencies...');
    execSync('npm install --silent 2>/dev/null', { cwd: repoDir, stdio: 'pipe', timeout: 120000 });

    commit(repoDir, 'feat: initial BrewBoard project setup');

    // Initialize aigon
    runAigon(['init'], repoDir);
    writeFixtureConfig(repoDir);
    runAigon(['install-agent', 'cc'], repoDir);
    commit(repoDir, 'chore: initialize aigon spec structure');

    // ── features/01-inbox (2 items, no ID) ──────────────────────────────────
    const inboxDir = path.join(repoDir, 'docs', 'specs', 'features', '01-inbox');

    write(path.join(inboxDir, 'feature-beer-style-filters.md'),
        featureInboxContent('Beer Style Filters',
            'Add a utility function that filters an array of beers by style.',
            ['Create `src/lib/filter-by-style.ts` exporting `function filterByStyle(beers: Beer[], styles: string[]): Beer[]`',
             'Return beers where `beer.style` matches any of the given styles (case-insensitive)'],
            'Array.filter with includes check. One file, one function.'));

    write(path.join(inboxDir, 'feature-social-sharing.md'),
        featureInboxContent('Social Sharing',
            'Add a function that generates a share URL for a beer review.',
            ['Create `src/lib/share-url.ts` exporting `function buildShareUrl(beerName: string, rating: number, platform: "twitter" | "facebook"): string`',
             'Twitter: return `https://twitter.com/intent/tweet?text=...` with beer name and rating',
             'Facebook: return `https://www.facebook.com/sharer/sharer.php?u=...`'],
            'String template building. One file, one function.'));

    // ── features/02-backlog (2 items, with IDs) ──────────────────────────────
    const backlogDir = path.join(repoDir, 'docs', 'specs', 'features', '02-backlog');

    write(path.join(backlogDir, 'feature-01-dark-mode.md'),
        featureBacklogContent('01', 'Dark Mode',
            'Add a dark mode toggle. Read OS preference, persist choice in localStorage, apply via CSS class on <html>.',
            ['Add a `dark` class toggle to `src/app/layout.tsx` that reads `prefers-color-scheme`',
             'Add a `ThemeToggle` button component in `src/components/theme-toggle.tsx`',
             'Persist theme choice to localStorage under key `brewboard-theme`'],
            'Add a small client component for the toggle. Use `useEffect` to read localStorage on mount. Apply `className="dark"` to `<html>`.'));

    write(path.join(backlogDir, 'feature-02-brewery-import.md'),
        featureBacklogContent('02', 'Brewery Import',
            'Parse a CSV file of beer names and add them to a JSON collection file.',
            ['Create `src/lib/import-csv.ts` that reads a CSV string and returns `Array<{name: string, brewery: string}>`',
             'Handle comma-in-quotes edge case',
             'Deduplicate by name+brewery (case-insensitive)'],
            'Simple string parsing — split by newline, then by comma. No external dependencies.'));

    // ── features/02-backlog (continued — items that would have been in-progress) ─
    write(path.join(backlogDir, 'feature-03-user-profiles.md'),
        featureBacklogContent('03', 'User Profiles',
            'Add a static profile page component that displays a username and collection count.',
            ['Create `src/components/profile-card.tsx` with props `{ username: string, beerCount: number }`',
             'Render username as an h2 and beer count as a paragraph',
             'Export the component as default'],
            'Simple presentational React component. No data fetching — just props in, JSX out.'));

    write(path.join(backlogDir, 'feature-04-rating-system.md'),
        featureBacklogContent('04', 'Rating System',
            'Add a star rating display component that renders 1-5 stars with half-star support.',
            ['Create `src/components/star-rating.tsx` with props `{ rating: number }` (0.0 to 5.0)',
             'Render filled, half-filled, and empty star characters (★ ½ ☆)',
             'Round to nearest 0.5'],
            'Pure function component. Use Math.round(rating * 2) / 2 for rounding. Map 5 positions to star characters.'));

    // ── features/05-done (2 items) ───────────────────────────────────────────
    const doneDir = path.join(repoDir, 'docs', 'specs', 'features', '05-done');

    write(path.join(doneDir, 'feature-05-onboarding-flow.md'),
        featureDoneContent('05', 'Onboarding Flow', 'Three-step onboarding wizard for new users: choose favourite styles, follow 3 breweries, add first beer.'));

    write(path.join(doneDir, 'feature-06-search.md'),
        featureDoneContent('06', 'Search', 'Full-text search across beers, breweries, and styles. Results ranked by relevance with highlighted matches.'));

    // ── research-topics (all in backlog or done — nothing in-progress without a session) ─
    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '01-inbox', 'research-payment-providers.md'),
        researchContent('Payment Providers', 'Evaluate Stripe vs Paddle vs Lemon Squeezy for handling subscriptions, VAT, and international currencies.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-01-caching-strategy.md'),
        researchContent('Caching Strategy', 'Research Redis vs in-memory vs CDN edge caching for the beer catalogue. Consider cold-start times and invalidation complexity.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-02-offline-sync.md'),
        researchContent('Offline Sync', 'Evaluate approaches for offline support: service workers + IndexedDB, vs a dedicated sync library like PowerSync or ElectricSQL.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '04-done', 'research-03-auth-providers.md'),
        researchContent('Auth Providers', 'Compared Clerk, Auth0, and NextAuth. Decision: Clerk for its DX and Vercel integration.'));

    // ── feedback (realistic customer reports) ──────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-01-slow-search.md'),
        feedbackContent(1, 'Search is unusable on mobile — 5+ seconds per keystroke',
            'Customer report from @hophead_jenny (Pro plan, 340 beers in collection):\n\n"Every time I type in the search bar on my iPhone, the whole page freezes for 5-8 seconds. I\'m on 4G and it\'s been like this since last week\'s update. Desktop is fine. I literally can\'t find anything in my collection anymore."',
            'inbox', 'performance', 'high',
            '- Device: iPhone 14, Safari, iOS 17.4\n- Network: 4G (verified with throttling in DevTools — reproduces on Slow 3G)\n- Collection size: 340 beers\n- First noticed after v0.8.2 deploy (March 12)\n- Desktop Chrome: search responds in <200ms with same account',
            '3 other Pro users reported the same issue in Discord this week. All have collections >200 beers. Free-tier users (max 50 beers) are unaffected. Likely an N+1 query or missing index on the search endpoint.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-02-broken-rating.md'),
        feedbackContent(2, 'Half-star ratings round down silently',
            'Reported by @craft_mike via support email:\n\n"I rated Pliny the Elder 4.5 stars. When I go back to the beer page, it shows 4 stars. Happened three times now with different beers — only when I pick a half star. Whole stars save fine."',
            'inbox', 'bug', 'medium',
            '- Reproduced locally: POST /api/ratings sends `4.5`, DB stores `4.5`, but GET /api/beers/:id returns `4`\n- Root cause likely in `Math.floor()` in the rating serializer (src/lib/ratings.ts:47)\n- Only affects the read path, not the write path — data is correct in DB',
            '12 ratings in the last week have been silently rounded down. Users lose trust in the rating system when their input isn\'t preserved.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '02-triaged', 'feedback-03-dark-mode-flicker.md'),
        feedbackContent(3, 'White flash on every page navigation in dark mode',
            'Multiple users in Discord #bugs channel:\n\n@beersnob_dave: "Every time I click a link, there\'s a white flash before the dark theme kicks in. It\'s like a flashbang at 2am."\n@ales_and_errors: "Same here, been happening since I signed up. I thought it was my browser."',
            'triaged', 'bug', 'low',
            '- Classic FOUC (Flash of Unstyled Content) — the `<html>` class is set by a client-side script that runs after first paint\n- Fix: inject a blocking `<script>` in `<head>` that reads the theme preference from localStorage before any rendering\n- Affects 100% of dark mode users on every navigation\n- Safari is worst (longer white flash), Chrome recovers faster',
            'Cosmetic but affects perceived quality. Dark mode is used by 67% of users (analytics). Low severity but high visibility — every user sees it every time.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '03-actionable', 'feedback-04-export-to-csv.md'),
        feedbackContent(4, 'Please let me export my collection to CSV',
            'Requested by 8 users in the last month via support and Discord:\n\n@cellar_tracker_pro: "I keep a parallel spreadsheet of my collection because I can\'t export from Brewboard. If you added CSV export I could ditch the spreadsheet entirely."\n\n@homebrew_data_nerd: "I want to analyze my tasting notes in R. A simple CSV with beer name, brewery, style, rating, date added would be perfect."',
            'actionable', 'feature-request', 'medium',
            '- 8 independent requests in 30 days (support tickets #142, #156, #167, #171, #178, #183, #191, #199)\n- Untappd and Vivino both offer CSV export\n- Estimated effort: 1-2 days (query + streaming CSV response + download button on /collection page)',
            'Power users (50+ beers) are most likely to churn without this. 3 of the 8 requesters are on Pro plan. This is a retention feature, not a growth feature.'));

    // ── final commit ─────────────────────────────────────────────────────────
    commit(repoDir, 'chore: seed aigon specs with initial feature/research/feedback items');
    console.log('  ✓ brewboard/ created');
}

// ─── brewboard-api fixture ────────────────────────────────────────────────────

function createBrewboardApi(repoDir) {
    console.log('  Creating brewboard-api/ ...');
    fs.mkdirSync(repoDir, { recursive: true });
    initGitRepo(repoDir);

    // Project files
    write(path.join(repoDir, 'package.json'), JSON.stringify({
        name: 'brewboard-api',
        version: '0.1.0',
        description: 'REST API for BrewBoard — craft beer tracking platform',
        main: 'src/index.js',
        scripts: {
            start: 'node src/index.js',
            dev: 'nodemon src/index.js',
            test: 'jest'
        },
        dependencies: {
            express: '^4.18.0',
            pg: '^8.11.0',
            zod: '^3.22.0'
        }
    }, null, 2));

    write(path.join(repoDir, 'README.md'), '# BrewBoard API\n\nREST API backend for the BrewBoard craft beer tracking platform.\n\nEndpoints: `/beers`, `/breweries`, `/users`, `/ratings`\n');
    write(path.join(repoDir, '.gitignore'), 'node_modules/\n.env\n.env.local\n');

    write(path.join(repoDir, 'src', 'index.js'), `const express = require('express');\nconst app = express();\napp.use(express.json());\napp.get('/health', (req, res) => res.json({ status: 'ok' }));\napp.use('/api/beers', require('./routes/beers'));\nconst server = app.listen(3001, () => console.log('BrewBoard API running on :3001'));\nprocess.on('SIGTERM', () => server.close());\nprocess.on('SIGINT', () => server.close());\n`);
    write(path.join(repoDir, 'src', 'routes', 'beers.js'), `const express = require('express');\nconst router = express.Router();\nrouter.get('/', async (req, res) => { res.json([]); });\nrouter.get('/:id', async (req, res) => { res.json(null); });\nmodule.exports = router;\n`);
    write(path.join(repoDir, 'src', 'db', 'schema.sql'), `CREATE TABLE beers (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  style TEXT,\n  abv NUMERIC(4,2),\n  brewery_id INT REFERENCES breweries(id)\n);\n`);

    commit(repoDir, 'feat: initial BrewBoard API project setup');

    // Initialize aigon
    runAigon(['init'], repoDir);
    writeFixtureConfig(repoDir);
    runAigon(['install-agent', 'cc'], repoDir);
    commit(repoDir, 'chore: initialize aigon spec structure');

    // ── features/01-inbox ────────────────────────────────────────────────────
    const inboxDir = path.join(repoDir, 'docs', 'specs', 'features', '01-inbox');

    write(path.join(inboxDir, 'feature-rate-limiting.md'),
        featureInboxContent('Rate Limiting',
            'Add a simple in-memory rate limiter middleware.',
            ['Create `src/middleware/rate-limit.js` exporting an Express middleware',
             'Track requests per IP in a Map with timestamps',
             'Return 429 if more than 100 requests per minute from same IP'],
            'In-memory Map keyed by IP. One file, one middleware function.'));

    write(path.join(inboxDir, 'feature-api-versioning.md'),
        featureInboxContent('API Versioning',
            'Add a version prefix helper for routes.',
            ['Create `src/lib/versioned-router.js` exporting `function versionedRouter(version, router)` that prefixes all routes with `/v{version}`',
             'Add a `Deprecation` header to responses when version < latest'],
            'Wrapper around Express router. One file.'));

    // ── features/02-backlog ──────────────────────────────────────────────────
    const backlogDir = path.join(repoDir, 'docs', 'specs', 'features', '02-backlog');

    write(path.join(backlogDir, 'feature-01-webhook-events.md'),
        featureBacklogContent('01', 'Webhook Events',
            'Add a webhook emitter utility.',
            ['Create `src/lib/webhook-emitter.js` exporting `async function emitWebhook(event, payload, webhookUrl)`',
             'POST JSON payload to the URL with `Content-Type: application/json`',
             'Return `{ success: boolean, statusCode: number }`'],
            'Single fetch() call wrapped in try/catch. One file.'));

    write(path.join(backlogDir, 'feature-02-graphql-endpoint.md'),
        featureBacklogContent('02', 'GraphQL Endpoint',
            'Add a minimal GraphQL schema for beers.',
            ['Create `src/graphql/schema.js` with a simple type definition: `type Beer { id: ID!, name: String!, style: String, abv: Float }`',
             'Add a `Query { beers: [Beer], beer(id: ID!): Beer }` root query',
             'Export the schema as a string constant'],
            'Just the schema string. No resolver implementation needed — schema only.'));

    // ── features/02-backlog (continued) ─────────────────────────────────────
    write(path.join(backlogDir, 'feature-03-full-text-search.md'),
        featureBacklogContent('03', 'Full-Text Search',
            'Add a search query builder function.',
            ['Create `src/lib/search-query.js` exporting `function buildSearchQuery(term, types)` that returns a SQL string',
             'Use `to_tsquery` for the term and filter by types array',
             'Return empty results SQL if term is empty (not an error)'],
            'String template to build a SQL query. One file, one function.'));

    write(path.join(backlogDir, 'feature-04-image-uploads.md'),
        featureBacklogContent('04', 'Image Uploads',
            'Add a file validation utility for image uploads.',
            ['Create `src/lib/validate-image.js` exporting `function validateImage(file)` that checks file type and size',
             'Accept only jpeg, png, webp with max size 5MB',
             'Return `{ valid: boolean, error?: string }`'],
            'Check mimetype against allowlist and size against max. One file, one function.'));

    // ── features/05-done ─────────────────────────────────────────────────────
    const doneDir = path.join(repoDir, 'docs', 'specs', 'features', '05-done');

    write(path.join(doneDir, 'feature-05-auth-jwt.md'),
        featureDoneContent('05', 'JWT Authentication', 'Stateless JWT authentication with RS256 signing. Access tokens expire in 15 minutes; refresh tokens expire in 30 days.'));

    write(path.join(doneDir, 'feature-06-pagination.md'),
        featureDoneContent('06', 'Pagination', 'Cursor-based pagination for all list endpoints. Returns `next_cursor` and `has_more` alongside data.'));

    // No feature logs — logs are created by feature-start, not pre-seeded

    // ── research-topics (nothing in-progress without a running session) ──────
    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '01-inbox', 'research-event-sourcing.md'),
        researchContent('Event Sourcing', 'Should the API switch to event sourcing for the ratings and check-in history? Evaluate EventStore vs Kafka vs Postgres WAL.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-01-database-sharding.md'),
        researchContent('Database Sharding', 'At 10M beer ratings, will a single Postgres instance hold up? Research read replicas, Citus extension, and PlanetScale Vitess.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-02-observability-stack.md'),
        researchContent('Observability Stack', 'Compare OpenTelemetry + Grafana vs Datadog vs Honeycomb for distributed tracing across API, workers, and DB.'));

    // ── feedback (realistic API consumer reports) ──────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-01-missing-cors.md'),
        feedbackContent(1, 'CORS headers missing on /ratings endpoint',
            'Reported by the Brewboard web frontend team:\n\n"The mobile-web app can\'t call GET /api/v1/ratings from brewboard.app. Every other endpoint returns Access-Control-Allow-Origin but /ratings returns a naked response. We\'re getting CORS errors in production for all rating-related features."',
            'inbox', 'bug', 'high',
            '- `curl -I https://api.brewboard.app/api/v1/ratings` — no CORS headers in response\n- `curl -I https://api.brewboard.app/api/v1/beers` — has `Access-Control-Allow-Origin: *`\n- The ratings router was added in PR #87 and the CORS middleware wasn\'t applied to the new route group\n- Affects: all web clients calling the ratings API',
            'Blocking the web team from shipping the new rating UI. Currently working around it with a proxy, but that adds latency and another failure point.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-02-slow-joins.md'),
        feedbackContent(2, 'GET /beers/:id takes 800ms for power users',
            'Flagged by ops monitoring (PagerDuty alert #4421):\n\np99 latency on the beer detail endpoint spiked to 800ms after user @cellar_tracker_pro hit 500 ratings. The JOIN on the ratings table is doing a sequential scan.',
            'inbox', 'performance', 'high',
            '- `EXPLAIN ANALYZE` shows seq scan on ratings table (no index on beer_id)\n- Users with <50 ratings: 12ms avg\n- Users with 500+ ratings: 780ms avg\n- Fix: `CREATE INDEX idx_ratings_beer_id ON ratings(beer_id)`\n- 6 users currently have 500+ ratings, growing by ~2/week',
            'Directly affects API SLA. Our target is p99 < 200ms. Three Pro users have complained about slow beer pages in the last week.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '02-triaged', 'feedback-03-500-on-empty-search.md'),
        feedbackContent(3, 'Search returns 500 when query param is empty',
            'From Sentry alert (issue #BREW-342):\n\n`GET /api/v1/search?q=` crashes with `error: syntax error at or near ")"`. The SQL query builder doesn\'t handle empty string — it generates `WHERE name ILIKE \'%%\'` which somehow breaks on our Postgres 15 with the full-text search extension.',
            'triaged', 'bug', 'medium',
            '- Sentry: 47 occurrences in last 7 days\n- Stack trace points to `src/routes/search.ts:34`\n- Repro: `curl https://api.brewboard.app/api/v1/search?q=`\n- Expected: 400 Bad Request or empty `{ results: [] }`\n- The search bar on mobile sends an empty query on focus (before user types)',
            '47 errors/week in Sentry. Users see a generic "Something went wrong" page. Mobile web is the main trigger — the search bar fires on focus.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '03-actionable', 'feedback-04-openapi-docs.md'),
        feedbackContent(4, 'Please publish an OpenAPI spec',
            'Requested by 3 integration partners and our own mobile team:\n\n@taproom_integrations: "We\'re building a POS integration with Brewboard. Without an OpenAPI spec, our devs are reverse-engineering your API from the web app\'s network tab. An auto-generated TypeScript client would save us weeks."\n\nOur iOS developer: "I\'m hand-writing Codable structs by reading the API source code. A spec would let me use swagger-codegen."',
            'actionable', 'feature-request', 'medium',
            '- 3 partner requests in Q1 (TapRoom POS, BeerMenus, CellarHQ)\n- Our own mobile team wants it for code generation\n- Could use `@asteasolutions/zod-to-openapi` since routes already use Zod schemas\n- Estimated: 2-3 days to add decorators + serve at /api/docs',
            'Partner integrations are a growth channel. Each delayed integration is potential revenue lost. Also unblocks our own mobile development.'));

    // ── final commit ─────────────────────────────────────────────────────────
    commit(repoDir, 'chore: seed aigon specs with initial feature/research/feedback items');
    console.log('  ✓ brewboard-api/ created');
}

// ─── trailhead fixture ────────────────────────────────────────────────────────

function createTrailhead(repoDir) {
    console.log('  Creating trailhead/ ...');
    fs.mkdirSync(repoDir, { recursive: true });
    initGitRepo(repoDir);

    // Swift/iOS project files
    write(path.join(repoDir, 'README.md'), '# Trailhead\n\nPersonal iOS app for logging hikes, tracking elevation, and pinning trail notes. Built with SwiftUI + MapKit.\n');
    write(path.join(repoDir, '.gitignore'), '.DS_Store\n*.xcuserstate\nDerivedData/\n.build/\n*.resolved\n');

    write(path.join(repoDir, 'Package.swift'), `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Trailhead",
    platforms: [.macOS(.v14), .iOS(.v17)],
    targets: [
        .target(name: "Trailhead", path: "Sources/Trailhead"),
        .testTarget(name: "TrailheadTests", dependencies: ["Trailhead"], path: "Tests/TrailheadTests"),
    ]
)
`);

    write(path.join(repoDir, 'Sources', 'Trailhead', 'TrailheadApp.swift'), `import SwiftUI

@main
struct TrailheadApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`);

    write(path.join(repoDir, 'Sources', 'Trailhead', 'ContentView.swift'), `import SwiftUI

struct ContentView: View {
    var body: some View {
        NavigationStack {
            Text("Trailhead")
                .navigationTitle("My Hikes")
        }
    }
}
`);

    write(path.join(repoDir, 'Sources', 'Trailhead', 'Models', 'Hike.swift'), `import Foundation

struct Hike: Identifiable, Codable {
    let id: UUID
    var name: String
    var date: Date
    var distance: Double   // km
    var elevationGain: Int // metres
    var notes: String
    var gpxURL: URL?
}
`);

    write(path.join(repoDir, 'Sources', 'Trailhead', 'Models', 'TrailPin.swift'), `import Foundation

struct TrailPin: Identifiable, Codable {
    let id: UUID
    var title: String
    var body: String
    var latitude: Double
    var longitude: Double
    var hikeId: UUID
}
`);

    write(path.join(repoDir, 'Tests', 'TrailheadTests', 'HikeTests.swift'), `import XCTest
@testable import Trailhead

final class HikeTests: XCTestCase {
    func testHikeCreation() {
        let hike = Hike(id: UUID(), name: "Ben Nevis", date: Date(), distance: 17.4, elevationGain: 1345, notes: "Clear summit day")
        XCTAssertEqual(hike.name, "Ben Nevis")
        XCTAssertEqual(hike.elevationGain, 1345)
    }
}
`);

    commit(repoDir, 'feat: initial Trailhead iOS app skeleton');

    // Initialize aigon
    runAigon(['init'], repoDir);
    writeFixtureConfig(repoDir);
    runAigon(['install-agent', 'cc'], repoDir);
    commit(repoDir, 'chore: initialize aigon spec structure');

    // ── features/01-inbox ────────────────────────────────────────────────────
    const inboxDir = path.join(repoDir, 'docs', 'specs', 'features', '01-inbox');

    write(path.join(inboxDir, 'feature-gpx-export.md'),
        featureInboxContent('GPX Export',
            'Add a function that converts a hike\'s GPS coordinates to GPX XML format.',
            ['Create `Sources/Trailhead/GPXExporter.swift` with a `func toGPX(coordinates: [(lat: Double, lon: Double, elevation: Double)]) -> String`',
             'Output valid GPX 1.1 XML with `<trkpt>` elements',
             'Include elevation in each trackpoint'],
            'String interpolation to build XML. No external dependencies.'));

    write(path.join(inboxDir, 'feature-apple-watch-companion.md'),
        featureInboxContent('Apple Watch Companion',
            'Add a simple SwiftUI view that displays elapsed time and distance for a hike.',
            ['Create `Sources/Trailhead/WatchView.swift` with a SwiftUI view',
             'Display `elapsedTime: TimeInterval` formatted as HH:MM:SS',
             'Display `distance: Double` formatted as km with 1 decimal'],
            'Pure SwiftUI view with formatted text. No WatchKit connectivity yet — just the view.'));

    // ── features/02-backlog ──────────────────────────────────────────────────
    const backlogDir = path.join(repoDir, 'docs', 'specs', 'features', '02-backlog');

    write(path.join(backlogDir, 'feature-01-elevation-chart.md'),
        featureBacklogContent('01', 'Elevation Profile Chart',
            'Add a function that computes elevation statistics from an array of altitude samples.',
            ['Create `Sources/Trailhead/ElevationStats.swift` with a struct `ElevationStats { min, max, totalGain, totalLoss: Double }`',
             'Add `func computeElevationStats(altitudes: [Double]) -> ElevationStats`',
             'Gain = sum of positive deltas between consecutive samples, loss = sum of negative deltas'],
            'Iterate the array once, tracking running gain/loss and min/max. Pure function, no UI.'));

    write(path.join(backlogDir, 'feature-02-photo-pinning.md'),
        featureBacklogContent('02', 'Photo Pinning',
            'Add a data model for geotagged photos on a hike.',
            ['Create `Sources/Trailhead/PhotoPin.swift` with a struct `PhotoPin { id: UUID, latitude: Double, longitude: Double, caption: String, timestamp: Date }`',
             'Add `Codable` conformance',
             'Add `func distanceTo(lat: Double, lon: Double) -> Double` using the Haversine formula'],
            'Simple struct with Codable. Haversine formula for distance calculation.'));

    // ── features/02-backlog (continued) ─────────────────────────────────────
    write(path.join(backlogDir, 'feature-03-offline-maps.md'),
        featureBacklogContent('03', 'Offline Maps',
            'Add a helper that calculates tile coordinates for a given bounding box.',
            ['Create `Sources/Trailhead/TileCalculator.swift` with `func tilesForRegion(minLat: Double, maxLat: Double, minLon: Double, maxLon: Double, zoom: Int) -> [(x: Int, y: Int)]`',
             'Use the standard Slippy Map tile numbering formula',
             'Return all tile (x, y) pairs within the bounding box at the given zoom level'],
            'Standard OSM tile math: x = floor((lon + 180) / 360 * 2^zoom), y from lat using Mercator projection.'));

    write(path.join(backlogDir, 'feature-04-hike-stats-widget.md'),
        featureBacklogContent('04', 'Hike Stats Widget',
            'Add a function that summarises weekly hike statistics from an array of hikes.',
            ['Create `Sources/Trailhead/WeeklyStats.swift` with `func weeklyStats(hikes: [Hike], referenceDate: Date) -> WeeklyStats`',
             'WeeklyStats struct: `{ hikeCount: Int, totalDistanceKm: Double, totalElevationGainM: Double }`',
             'Filter hikes to only those within the last 7 days from referenceDate'],
            'Filter by date, then reduce to sum distance and elevation. Pure function.'));

    // ── features/05-done ─────────────────────────────────────────────────────
    const doneDir = path.join(repoDir, 'docs', 'specs', 'features', '05-done');

    write(path.join(doneDir, 'feature-05-hike-logging.md'),
        featureDoneContent('05', 'Hike Logging', 'Core feature: start a hike session, record GPS track via CoreLocation, auto-save on end. Distance and elevation calculated from raw GPS points.'));

    write(path.join(doneDir, 'feature-06-icloud-sync.md'),
        featureDoneContent('06', 'iCloud Sync', 'Sync hike records across the user\'s devices using CloudKit. Conflicts resolved by last-write-wins on the name/notes fields; GPS tracks are immutable.'));

    // No feature logs — logs are created by feature-start, not pre-seeded

    // ── research-topics (nothing in-progress without a running session) ──────
    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '01-inbox', 'research-live-activities.md'),
        researchContent('Live Activities for Active Hikes', 'Can we use ActivityKit Live Activities to show real-time hike stats on the Dynamic Island and Lock Screen during an active session?'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-01-route-planning.md'),
        researchContent('Route Planning APIs', 'Evaluate MapKit routing vs OpenRouteService vs Komoot API for suggesting hiking routes based on difficulty, length, and starting point.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-02-battery-usage.md'),
        researchContent('GPS Battery Optimisation', 'Background GPS tracking drains the battery fast. Research CLLocationManager accuracy modes, significant-change API, and deferred location updates as power-saving strategies.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '04-done', 'research-03-map-sdk-choice.md'),
        researchContent('MapKit vs Google Maps vs Mapbox', 'Compared three mapping SDKs for offline tile support and SwiftUI integration. Decision: MapKit — native APIs, no extra SDK weight, offline tile overlay available.'));

    // ── feedback (realistic hiker reports) ──────────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-01-battery-drain.md'),
        feedbackContent(1, 'App killed my battery on a full-day hike',
            'App Store review (1 star) from TrailRunner_Sarah:\n\n"Did a 6-hour hike on the PCT and Trailhead used 34% of my battery. Apple Maps running in the background only used 8%. By hour 4 I had to close the app to save battery for emergencies. What\'s the point of a hiking app that can\'t last a full hike?"',
            'inbox', 'performance', 'critical',
            '- Battery usage report (Settings > Battery): Trailhead 34%, Maps 8%, over same 6hr period\n- Device: iPhone 15 Pro, iOS 17.3\n- `CLLocationManager` is using `kCLLocationAccuracyBest` continuously\n- Should switch to `kCLLocationAccuracyHundredMeters` when app is backgrounded\n- Significant-change API could reduce wakeups from every 1s to every ~500m\n- Similar complaint from 4 other users on TestFlight',
            'This is the #1 complaint in App Store reviews (mentioned in 6 of 14 reviews). Hikers need the app to last 8+ hours. Currently limits us to ~4 hours of tracking. Existential issue for a hiking app.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-02-map-stuck-on-north.md'),
        feedbackContent(2, 'Map doesn\'t rotate to match walking direction',
            'TestFlight feedback from @mountain_mike:\n\n"When I\'m hiking, the map stays locked north-up. Every other hiking app rotates the map to match the direction I\'m walking. I have to keep mentally rotating the map in my head to figure out which trail fork to take. Almost took a wrong turn on a ridge trail because of this."',
            'inbox', 'bug', 'medium',
            '- `mapView.userTrackingMode` is set to `.follow` instead of `.followWithHeading`\n- Fix is one line: `mapView.userTrackingMode = .followWithHeading`\n- Needs compass calibration prompt (standard iOS dialog)\n- AllTrails, Gaia GPS, and Komoot all default to heading-follow mode',
            'Navigation accuracy is a safety concern on trail forks. 3 TestFlight users mentioned this independently. Easy fix with high UX impact.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '02-triaged', 'feedback-03-no-dark-mode-map.md'),
        feedbackContent(3, 'Map is blinding white when using dark mode at night',
            'From Discord #beta-feedback:\n\n@nighthiker_jules: "I use dark mode because I hike early morning before sunrise. The entire app is dark except the map, which is a giant white rectangle that destroys my night vision. Please make the map respect dark mode."',
            'triaged', 'bug', 'medium',
            '- MapKit doesn\'t automatically switch tile styles with system appearance\n- Fix: listen to `traitCollectionDidChange` and toggle `mapType` between `.standard` and `.mutedStandard` (or use `.hybrid` for satellite)\n- Could also apply a dark overlay as a quick fix\n- Apple Maps app handles this correctly — we just need to match their behavior',
            'Affects early morning and night hikers. Dark mode is used by 45% of TestFlight users. The map is the primary screen, so this is very visible.'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '03-actionable', 'feedback-04-siri-shortcuts.md'),
        feedbackContent(4, '"Hey Siri, start my hike" — hands-free recording',
            'Requested by 5 TestFlight users, all with the same use case:\n\n@chestmount_chris: "I keep my phone in a chest harness while hiking. I can\'t easily tap the screen with gloves on. If I could say \'Hey Siri, start a hike on Trailhead\' that would be perfect."\n\n@trail_accessibility: "I have limited hand mobility and voice control would make the app much more accessible for me."',
            'actionable', 'feature-request', 'medium',
            '- Requires implementing `INStartWorkoutIntent` (SiriKit) or `AppIntents` framework (iOS 16+)\n- AppIntents is the modern approach — simpler, works with Shortcuts app too\n- Needs: `StartHikeIntent`, `StopHikeIntent`, `GetHikeStatusIntent`\n- Estimated: 3-4 days for basic start/stop, 1 week with Shortcuts app integration\n- Competitor support: AllTrails has Siri (basic), Strava has full Shortcuts integration',
            'Accessibility feature that also benefits the core power-user segment (serious hikers with gear mounts). Good App Store differentiator — most indie hiking apps lack Siri support.'));

    // ── final commit ─────────────────────────────────────────────────────────
    commit(repoDir, 'chore: seed aigon specs with initial feature/research/feedback items');
    console.log('  ✓ trailhead/ created');
}

// ─── main ─────────────────────────────────────────────────────────────────────

function cleanupFixtureArtifacts(repoNames) {
    // Kill tmux sessions belonging to fixture repos
    for (const name of repoNames) {
        try {
            const result = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
            if (result.status === 0 && result.stdout) {
                const sessions = result.stdout.trim().split('\n').filter(s =>
                    s.startsWith('aigon-') && s.includes(name.replace(/-/g, ''))
                );
                for (const session of sessions) {
                    spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'pipe' });
                    console.log(`  🔪 Killed tmux session: ${session}`);
                }
            }
        } catch (_) { /* tmux not running */ }
    }

    // Remove worktree directories (must use git worktree remove before rmSync)
    for (const name of repoNames) {
        const repoDir = path.join(FIXTURES_DIR, name);
        const worktreeDir = path.join(FIXTURES_DIR, `${name}-worktrees`);
        if (fs.existsSync(worktreeDir) && fs.existsSync(repoDir)) {
            console.log(`  🗑️  Removing worktrees: ${name}-worktrees/`);
            // List and remove each git worktree properly
            try {
                const entries = fs.readdirSync(worktreeDir);
                for (const entry of entries) {
                    const wtPath = path.join(worktreeDir, entry);
                    if (fs.statSync(wtPath).isDirectory()) {
                        spawnSync('git', ['worktree', 'remove', '--force', wtPath], { cwd: repoDir, stdio: 'pipe' });
                    }
                }
            } catch (_) { /* best-effort */ }
            // Clean up the parent directory if anything remains
            try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch (_) {}
        } else if (fs.existsSync(worktreeDir)) {
            // No main repo (already deleted or missing) — force remove
            try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch (_) {}
        }
    }

    // Stop dev servers via aigon (best-effort)
    for (const name of repoNames) {
        const repoDir = path.join(FIXTURES_DIR, name);
        if (fs.existsSync(repoDir)) {
            spawnSync(process.execPath, [CLI_PATH, 'dev-server', 'stop', '--all'], {
                cwd: repoDir, encoding: 'utf8', stdio: 'pipe'
            });
        }
    }
}

function main() {
    const brewboardDir = path.join(FIXTURES_DIR, 'brewboard');
    const apiDir = path.join(FIXTURES_DIR, 'brewboard-api');
    const trailheadDir = path.join(FIXTURES_DIR, 'trailhead');
    const repoNames = ['brewboard', 'brewboard-api', 'trailhead'];

    // Clean up tmux sessions, worktrees, and dev servers first
    cleanupFixtureArtifacts(repoNames);

    // Clean existing fixture repos before regenerating
    for (const dir of [brewboardDir, apiDir, trailheadDir]) {
        if (fs.existsSync(dir)) {
            console.log(`  Removing existing ${path.basename(dir)}/...`);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    console.log('Generating fixtures...');

    // Isolated HOME so aigon global config doesn't bleed in
    const homeDir = path.join(os.tmpdir(), 'aigon-fixture-home');
    fs.mkdirSync(homeDir, { recursive: true });

    try {
        createBrewboard(brewboardDir);
        createBrewboardApi(apiDir);
        createTrailhead(trailheadDir);

        // Add GitHub remotes and push seed state
        const ghUser = getGitHubUser();
        if (ghUser) {
            for (const name of repoNames) {
                const dir = path.join(FIXTURES_DIR, name);
                addGitHubRemote(dir, name, ghUser);
            }
        }

        console.log(`\nFixtures ready in ${FIXTURES_DIR}/`);
        console.log('  brewboard/     — web SaaS (features, research, feedback seeded)');
        console.log('  brewboard-api/ — REST API backend (features, research, feedback seeded)');
        console.log('  trailhead/     — personal iOS hiking app in Swift (features, research, feedback seeded)');
    } catch (err) {
        console.error('Fixture generation failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

main();
