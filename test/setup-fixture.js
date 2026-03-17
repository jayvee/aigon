#!/usr/bin/env node
/**
 * Fixture generator for Aigon e2e tests.
 *
 * Creates two realistic project repos in test/fixtures/:
 *   - brewboard/     — a SaaS app for tracking craft beer collections
 *   - brewboard-api/ — the REST API backend
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
 * Reset: rm -rf test/fixtures && node test/setup-fixture.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
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

// ─── feature spec helpers ─────────────────────────────────────────────────────

function featureInboxContent(title, summary) {
    return `# Feature: ${title}\n\n## Summary\n\n${summary}\n\n## User Stories\n\n- [ ] As a user, I want to ${title.toLowerCase()} so that I can improve my workflow\n\n## Acceptance Criteria\n\n- [ ] Feature is implemented and working\n- [ ] Tests pass\n\n## Technical Approach\n\nTBD\n`;
}

function featureBacklogContent(id, title, summary) {
    return featureInboxContent(title, summary);
}

function featureInProgressContent(id, title, summary) {
    return featureInboxContent(title, summary);
}

function featureDoneContent(id, title, summary) {
    return featureInboxContent(title, summary);
}

function logContent(num, desc, status = 'implementing') {
    const now = new Date().toISOString();
    return `---\nstatus: ${status}\nupdated: ${now}\nstartedAt: ${now}\nevents:\n  - { ts: "${now}", status: ${status} }\n---\n\n# Implementation Log: Feature ${num} - ${desc}\n\n## Plan\n\nImplemented the feature as specified.\n\n## Progress\n\nCompleted all acceptance criteria.\n\n## Decisions\n\nUsed standard patterns consistent with existing codebase.\n`;
}

function researchContent(title, summary) {
    return `# Research: ${title}\n\n## Summary\n\n${summary}\n\n## Questions\n\n- [ ] What are the main trade-offs?\n- [ ] What do competitors do?\n\n## Findings\n\nTBD\n`;
}

function feedbackContent(id, title, summary, status, type = 'bug') {
    return `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\ntype: ${type}\nseverity: medium\n---\n\n# Feedback: ${title}\n\n## Summary\n\n${summary}\n\n## Evidence\n\nSteps to reproduce or supporting screenshots.\n\n## Impact\n\nMedium impact on user experience.\n`;
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

    write(path.join(repoDir, 'src', 'app', 'page.tsx'), `export default function Home() {\n  return <main><h1>BrewBoard</h1></main>;\n}\n`);
    write(path.join(repoDir, 'src', 'app', 'layout.tsx'), `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n`);
    write(path.join(repoDir, 'src', 'components', 'BeerCard.tsx'), `export function BeerCard({ name, style, rating }: { name: string; style: string; rating: number }) {\n  return <div className="beer-card"><h2>{name}</h2><p>{style}</p><span>{rating}/5</span></div>;\n}\n`);
    write(path.join(repoDir, 'src', 'lib', 'api.ts'), `export async function fetchBeers() {\n  const res = await fetch('/api/beers');\n  return res.json();\n}\n`);

    commit(repoDir, 'feat: initial BrewBoard project setup');

    // Initialize aigon
    runAigon(['init'], repoDir);
    commit(repoDir, 'chore: initialize aigon spec structure');

    // ── features/01-inbox (2 items, no ID) ──────────────────────────────────
    const inboxDir = path.join(repoDir, 'docs', 'specs', 'features', '01-inbox');

    write(path.join(inboxDir, 'feature-beer-style-filters.md'),
        featureInboxContent('Beer Style Filters', 'Allow users to filter their collection by beer style (IPA, Stout, Lager, etc.) with multi-select chips on the collection page.'));

    write(path.join(inboxDir, 'feature-social-sharing.md'),
        featureInboxContent('Social Sharing', 'Let users share individual beer reviews or their top-10 list to Twitter/X and Instagram Stories with a generated image card.'));

    // ── features/02-backlog (2 items, with IDs) ──────────────────────────────
    const backlogDir = path.join(repoDir, 'docs', 'specs', 'features', '02-backlog');

    write(path.join(backlogDir, 'feature-01-dark-mode.md'),
        featureBacklogContent('01', 'Dark Mode', 'Add a dark mode toggle to the app. Default to the OS preference, persist the choice in localStorage, and apply via a CSS class on <html>.'));

    write(path.join(backlogDir, 'feature-02-brewery-import.md'),
        featureBacklogContent('02', 'Brewery Import', 'Bulk-import beers from Untappd via CSV export. Parse the file, deduplicate by name+brewery, and add to the user\'s collection.'));

    // ── features/03-in-progress (2 items, with IDs) ──────────────────────────
    const inProgressDir = path.join(repoDir, 'docs', 'specs', 'features', '03-in-progress');

    write(path.join(inProgressDir, 'feature-03-user-profiles.md'),
        featureInProgressContent('03', 'User Profiles', 'Public profile pages showing a user\'s collection stats, recent activity, and top-rated beers. Accessible at /u/username.'));

    write(path.join(inProgressDir, 'feature-04-rating-system.md'),
        featureInProgressContent('04', 'Rating System', 'Five-star rating system with half-star precision. Ratings are stored per user per beer and shown as an average on the beer detail page.'));

    // ── features/05-done (2 items) ───────────────────────────────────────────
    const doneDir = path.join(repoDir, 'docs', 'specs', 'features', '05-done');

    write(path.join(doneDir, 'feature-05-onboarding-flow.md'),
        featureDoneContent('05', 'Onboarding Flow', 'Three-step onboarding wizard for new users: choose favourite styles, follow 3 breweries, add first beer.'));

    write(path.join(doneDir, 'feature-06-search.md'),
        featureDoneContent('06', 'Search', 'Full-text search across beers, breweries, and styles using a Postgres tsvector index. Results ranked by relevance with highlighted matches.'));

    // ── feature logs (for in-progress features) ───────────────────────────────
    const logsDir = path.join(repoDir, 'docs', 'specs', 'features', 'logs');
    write(path.join(logsDir, 'feature-03-user-profiles-log.md'), logContent('03', 'user-profiles'));
    write(path.join(logsDir, 'feature-04-rating-system-log.md'), logContent('04', 'rating-system'));

    // ── research-topics ──────────────────────────────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '01-inbox', 'research-payment-providers.md'),
        researchContent('Payment Providers', 'Evaluate Stripe vs Paddle vs Lemon Squeezy for handling subscriptions, VAT, and international currencies.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-01-caching-strategy.md'),
        researchContent('Caching Strategy', 'Research Redis vs in-memory vs CDN edge caching for the beer catalogue. Consider cold-start times and invalidation complexity.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '03-in-progress', 'research-02-offline-sync.md'),
        researchContent('Offline Sync', 'Evaluate approaches for offline support: service workers + IndexedDB, vs a dedicated sync library like PowerSync or ElectricSQL.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '04-done', 'research-03-auth-providers.md'),
        researchContent('Auth Providers', 'Compared Clerk, Auth0, and NextAuth. Decision: Clerk for its DX and Vercel integration.'));

    // ── feedback ─────────────────────────────────────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-01-slow-search.md'),
        feedbackContent(1, 'Search results take 5+ seconds on mobile', 'On Safari iOS 17 with a slow 4G connection, the search results page takes 5-8 seconds to load after typing. Desktop Chrome is fast.', 'inbox', 'performance'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-02-broken-rating.md'),
        feedbackContent(2, 'Half-star ratings not saving correctly', 'When I tap 3.5 stars on the rating widget, the saved value shows as 3.0 when I refresh. Only affects half-star values.', 'inbox', 'bug'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '02-triaged', 'feedback-03-dark-mode-flicker.md'),
        feedbackContent(3, 'Dark mode flickers on page load', 'There\'s a brief white flash before the dark theme loads. Affects all pages. A common flash-of-unstyled-content issue.', 'triaged', 'bug'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '03-actionable', 'feedback-04-export-to-csv.md'),
        feedbackContent(4, 'Export collection to CSV', 'Users want to export their beer collection as a CSV file for spreadsheet analysis. Multiple requests from power users.', 'actionable', 'feature-request'));

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

    write(path.join(repoDir, 'src', 'index.js'), `const express = require('express');\nconst app = express();\napp.use(express.json());\napp.get('/health', (req, res) => res.json({ status: 'ok' }));\napp.listen(3001, () => console.log('BrewBoard API running on :3001'));\n`);
    write(path.join(repoDir, 'src', 'routes', 'beers.js'), `const express = require('express');\nconst router = express.Router();\nrouter.get('/', async (req, res) => { res.json([]); });\nrouter.get('/:id', async (req, res) => { res.json(null); });\nmodule.exports = router;\n`);
    write(path.join(repoDir, 'src', 'db', 'schema.sql'), `CREATE TABLE beers (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  style TEXT,\n  abv NUMERIC(4,2),\n  brewery_id INT REFERENCES breweries(id)\n);\n`);

    commit(repoDir, 'feat: initial BrewBoard API project setup');

    // Initialize aigon
    runAigon(['init'], repoDir);
    commit(repoDir, 'chore: initialize aigon spec structure');

    // ── features/01-inbox ────────────────────────────────────────────────────
    const inboxDir = path.join(repoDir, 'docs', 'specs', 'features', '01-inbox');

    write(path.join(inboxDir, 'feature-rate-limiting.md'),
        featureInboxContent('Rate Limiting', 'Add per-IP and per-user rate limiting to all API endpoints using a sliding window algorithm backed by Redis.'));

    write(path.join(inboxDir, 'feature-api-versioning.md'),
        featureInboxContent('API Versioning', 'Introduce /v1/ prefix to all routes and set up an automatic deprecation warning header for older versions.'));

    // ── features/02-backlog ──────────────────────────────────────────────────
    const backlogDir = path.join(repoDir, 'docs', 'specs', 'features', '02-backlog');

    write(path.join(backlogDir, 'feature-01-webhook-events.md'),
        featureBacklogContent('01', 'Webhook Events', 'Emit webhook events for key actions (beer added, rating submitted, user followed) to allow third-party integrations.'));

    write(path.join(backlogDir, 'feature-02-graphql-endpoint.md'),
        featureBacklogContent('02', 'GraphQL Endpoint', 'Add a /graphql endpoint alongside REST for the mobile app to use. Schema mirrors the REST resources.'));

    // ── features/03-in-progress ──────────────────────────────────────────────
    const inProgressDir = path.join(repoDir, 'docs', 'specs', 'features', '03-in-progress');

    write(path.join(inProgressDir, 'feature-03-full-text-search.md'),
        featureInProgressContent('03', 'Full-Text Search', 'PostgreSQL tsvector index on beers and breweries. Endpoint: GET /search?q=ipa&type=beer,brewery. Returns ranked results.'));

    write(path.join(inProgressDir, 'feature-04-image-uploads.md'),
        featureInProgressContent('04', 'Image Uploads', 'Allow users to attach photos to beer check-ins. Store in S3-compatible object storage, serve via CDN URLs.'));

    // ── features/05-done ─────────────────────────────────────────────────────
    const doneDir = path.join(repoDir, 'docs', 'specs', 'features', '05-done');

    write(path.join(doneDir, 'feature-05-auth-jwt.md'),
        featureDoneContent('05', 'JWT Authentication', 'Stateless JWT authentication with RS256 signing. Access tokens expire in 15 minutes; refresh tokens expire in 30 days.'));

    write(path.join(doneDir, 'feature-06-pagination.md'),
        featureDoneContent('06', 'Pagination', 'Cursor-based pagination for all list endpoints. Returns `next_cursor` and `has_more` alongside data.'));

    // ── feature logs ─────────────────────────────────────────────────────────
    const logsDir = path.join(repoDir, 'docs', 'specs', 'features', 'logs');
    write(path.join(logsDir, 'feature-03-full-text-search-log.md'), logContent('03', 'full-text-search'));
    write(path.join(logsDir, 'feature-04-image-uploads-log.md'), logContent('04', 'image-uploads'));

    // ── research-topics ──────────────────────────────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '01-inbox', 'research-event-sourcing.md'),
        researchContent('Event Sourcing', 'Should the API switch to event sourcing for the ratings and check-in history? Evaluate EventStore vs Kafka vs Postgres WAL.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-01-database-sharding.md'),
        researchContent('Database Sharding', 'At 10M beer ratings, will a single Postgres instance hold up? Research read replicas, Citus extension, and PlanetScale Vitess.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '03-in-progress', 'research-02-observability-stack.md'),
        researchContent('Observability Stack', 'Compare OpenTelemetry + Grafana vs Datadog vs Honeycomb for distributed tracing across API, workers, and DB.'));

    // ── feedback ─────────────────────────────────────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-01-missing-cors.md'),
        feedbackContent(1, 'CORS headers missing on /ratings endpoint', 'The mobile app can\'t call GET /ratings from the web app origin. All other endpoints return CORS headers but /ratings does not.', 'inbox', 'bug'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-02-slow-joins.md'),
        feedbackContent(2, 'Beer detail endpoint slow with large collections', 'GET /beers/:id takes 800ms when a user has 500+ ratings. The JOIN on ratings is not indexed.', 'inbox', 'performance'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '02-triaged', 'feedback-03-500-on-empty-search.md'),
        feedbackContent(3, 'Search returns 500 when query is empty string', 'GET /search?q= crashes with a Postgres syntax error. Should return 400 Bad Request or empty results.', 'triaged', 'bug'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '03-actionable', 'feedback-04-openapi-docs.md'),
        feedbackContent(4, 'Publish OpenAPI spec', 'Multiple integration partners have asked for an OpenAPI / Swagger spec at /docs. Makes it easier to auto-generate client SDKs.', 'actionable', 'feature-request'));

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
    platforms: [.iOS(.v17)],
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
import MapKit

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
import CoreLocation

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
import CoreLocation

struct TrailPin: Identifiable, Codable {
    let id: UUID
    var title: String
    var body: String
    var coordinate: CLLocationCoordinate2D
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
    commit(repoDir, 'chore: initialize aigon spec structure');

    // ── features/01-inbox ────────────────────────────────────────────────────
    const inboxDir = path.join(repoDir, 'docs', 'specs', 'features', '01-inbox');

    write(path.join(inboxDir, 'feature-gpx-export.md'),
        featureInboxContent('GPX Export', 'Export any logged hike as a GPX file so it can be imported into Garmin Connect, Strava, or AllTrails for analysis and sharing.'));

    write(path.join(inboxDir, 'feature-apple-watch-companion.md'),
        featureInboxContent('Apple Watch Companion', 'A minimal watchOS companion app that shows current pace, elapsed time, and elevation during an active hike. Syncs data back to the iPhone app on completion.'));

    // ── features/02-backlog ──────────────────────────────────────────────────
    const backlogDir = path.join(repoDir, 'docs', 'specs', 'features', '02-backlog');

    write(path.join(backlogDir, 'feature-01-elevation-chart.md'),
        featureBacklogContent('01', 'Elevation Profile Chart', 'Show a scrollable elevation chart on the hike detail screen using Swift Charts. Highlight the steepest section and mark the summit.'));

    write(path.join(backlogDir, 'feature-02-photo-pinning.md'),
        featureBacklogContent('02', 'Photo Pinning on Map', 'Let users drop a photo pin at their current GPS location during a hike. Photos are stored in the app\'s local library and shown as map annotations.'));

    // ── features/03-in-progress ──────────────────────────────────────────────
    const inProgressDir = path.join(repoDir, 'docs', 'specs', 'features', '03-in-progress');

    write(path.join(inProgressDir, 'feature-03-offline-maps.md'),
        featureInProgressContent('03', 'Offline Map Tiles', 'Download map tiles for a selected region so hikes can be tracked without cell service. Uses MapKit\'s local tile overlay API. Max download: 500 MB.'));

    write(path.join(inProgressDir, 'feature-04-hike-stats-widget.md'),
        featureInProgressContent('04', 'Home Screen Widget', 'WidgetKit widget showing this week\'s hike count, total distance, and elevation gain at a glance. Small and medium size classes.'));

    // ── features/05-done ─────────────────────────────────────────────────────
    const doneDir = path.join(repoDir, 'docs', 'specs', 'features', '05-done');

    write(path.join(doneDir, 'feature-05-hike-logging.md'),
        featureDoneContent('05', 'Hike Logging', 'Core feature: start a hike session, record GPS track via CoreLocation, auto-save on end. Distance and elevation calculated from raw GPS points.'));

    write(path.join(doneDir, 'feature-06-icloud-sync.md'),
        featureDoneContent('06', 'iCloud Sync', 'Sync hike records across the user\'s devices using CloudKit. Conflicts resolved by last-write-wins on the name/notes fields; GPS tracks are immutable.'));

    // ── feature logs ─────────────────────────────────────────────────────────
    const logsDir = path.join(repoDir, 'docs', 'specs', 'features', 'logs');
    write(path.join(logsDir, 'feature-03-offline-maps-log.md'), logContent('03', 'offline-maps'));
    write(path.join(logsDir, 'feature-04-hike-stats-widget-log.md'), logContent('04', 'hike-stats-widget'));

    // ── research-topics ──────────────────────────────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '01-inbox', 'research-live-activities.md'),
        researchContent('Live Activities for Active Hikes', 'Can we use ActivityKit Live Activities to show real-time hike stats on the Dynamic Island and Lock Screen during an active session?'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '02-backlog', 'research-01-route-planning.md'),
        researchContent('Route Planning APIs', 'Evaluate MapKit routing vs OpenRouteService vs Komoot API for suggesting hiking routes based on difficulty, length, and starting point.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '03-in-progress', 'research-02-battery-usage.md'),
        researchContent('GPS Battery Optimisation', 'Background GPS tracking drains the battery fast. Research CLLocationManager accuracy modes, significant-change API, and deferred location updates as power-saving strategies.'));

    write(path.join(repoDir, 'docs', 'specs', 'research-topics', '04-done', 'research-03-map-sdk-choice.md'),
        researchContent('MapKit vs Google Maps vs Mapbox', 'Compared three mapping SDKs for offline tile support and SwiftUI integration. Decision: MapKit — native APIs, no extra SDK weight, offline tile overlay available.'));

    // ── feedback ─────────────────────────────────────────────────────────────
    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-01-battery-drain.md'),
        feedbackContent(1, 'App drains battery during long hikes', 'On a 6-hour hike the app used 34% battery — more than Maps.app. Background GPS tracking with full accuracy seems to be the culprit.', 'inbox', 'performance'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '01-inbox', 'feedback-02-map-stuck-on-north.md'),
        feedbackContent(2, 'Map rotation does not follow heading', 'The map should rotate to follow the user\'s walking direction but it stays locked north-up. Setting mapView.userTrackingMode = .followWithHeading fixes it.', 'inbox', 'bug'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '02-triaged', 'feedback-03-no-dark-mode-map.md'),
        feedbackContent(3, 'Map tiles don\'t switch to dark mode', 'The MapKit tile overlay stays in light mode even when the device is in dark mode. Need to set the map scheme to .hybrid or listen to UITraitCollection changes.', 'triaged', 'bug'));

    write(path.join(repoDir, 'docs', 'specs', 'feedback', '03-actionable', 'feedback-04-siri-shortcuts.md'),
        feedbackContent(4, 'Siri Shortcuts for starting a hike', 'Would love to say "Hey Siri, start a hike" and have the app begin recording. Multiple requests from users who hike with their phone in a chest mount.', 'actionable', 'feature-request'));

    // ── final commit ─────────────────────────────────────────────────────────
    commit(repoDir, 'chore: seed aigon specs with initial feature/research/feedback items');
    console.log('  ✓ trailhead/ created');
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main() {
    const brewboardDir = path.join(FIXTURES_DIR, 'brewboard');
    const apiDir = path.join(FIXTURES_DIR, 'brewboard-api');
    const trailheadDir = path.join(FIXTURES_DIR, 'trailhead');

    if (fs.existsSync(FIXTURES_DIR)) {
        console.log('Fixtures already exist. Delete test/fixtures/ and re-run to regenerate.');
        console.log('  rm -rf test/fixtures && node test/setup-fixture.js');
        process.exit(0);
    }

    console.log('Generating fixtures...');

    // Isolated HOME so aigon global config doesn't bleed in
    const homeDir = path.join(FIXTURES_DIR, '.home');
    fs.mkdirSync(homeDir, { recursive: true });

    try {
        createBrewboard(brewboardDir);
        createBrewboardApi(apiDir);
        createTrailhead(trailheadDir);
        console.log('\nFixtures ready in test/fixtures/');
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
