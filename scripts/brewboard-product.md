# BrewBoard — Product Spec & Roadmap

## What is BrewBoard?

BrewBoard is a web app for craft beer enthusiasts to track, rate, and discover beers and breweries.

The core loop is simple: you find a beer you like, you log it, you rate it, you remember it. Over time your collection becomes a personal taste profile — and BrewBoard uses that to help you discover what to drink next.

The secondary loop is social: your ratings and collection are shareable, breweries can be followed, and a community feed surfaces what people around you are drinking.

**Target user:** Craft beer drinker who goes to bottle shops and taprooms regularly, wants to remember what they've tried, and trusts peer recommendations over marketing.

**Stack:** Next.js 15, React 18, TypeScript, Tailwind CSS. No database yet — data is hardcoded. The roadmap below describes what needs to be built.

---

## Current State (what's already built)

The app is a UI shell. There is no backend, no auth, and no persistence.

- **Beer listing page** — displays 6 hardcoded beers in a card grid
- **BeerCard component** — shows name, brewery, style badge, and star rating
- **Rating filter** — buttons to filter the list by minimum rating threshold (All / 3.5★+ / 4.0★+ / 4.5★+)
- **Theme toggle** — component exists but not wired up
- **CSV import lib** — stub exists at `src/lib/import-csv.ts`, not connected to UI
- **API lib** — stub at `src/lib/api.ts` with a `fetchBeers()` call, not connected to a real endpoint

Everything else described below needs to be designed and built from scratch.

---

## Roadmap

Features are grouped into phases in rough priority order. Each phase should be shippable on its own.

### Phase 1 — Core Discovery

Make the basic browsing experience feel real. Replace hardcoded data with a proper data layer and add the filters and search users need to find beers.

| Feature | Description |
|---|---|
| **Search** | Full-text search across beer name, brewery, and style. Should update results live as the user types. |
| **Beer style filter** | Filter the grid by style (IPA, Stout, Pale Ale, Lager, Sour, etc.). Should be combinable with the rating filter. |
| **Date added** | Track and display when a beer was added to the list. Format nicely (e.g. "3 days ago"). |
| **Real data layer** | Replace the hardcoded `BEERS` array with a proper data source (JSON file, SQLite, or API). Breweries and beers should be separate entities. |
| **Brewery pages** | Each brewery gets its own page listing all their beers. |
| **Onboarding** | First-time user flow that explains the app and sets up their profile. |
| **Footer** | Standard site footer with links and attribution. |

### Phase 2 — User Accounts & Ratings

Add identity so users can log their own ratings and build a personal collection.

| Feature | Description |
|---|---|
| **Auth** | Email/password sign-up and login. Consider third-party providers (Google, GitHub). |
| **User profiles** | Public profile page showing a user's rated beers, favourite styles, and stats. |
| **User ratings** | Authenticated users can rate beers (1–5 stars). Aggregate rating is the average of all user ratings. |
| **Personal collection** | Users can mark beers as "tried", "want to try", or "in my fridge". |
| **Dark mode** | System-preference-aware dark mode. Toggle should persist across sessions. |

### Phase 3 — Social & Sharing

Make collections and discoveries shareable.

| Feature | Description |
|---|---|
| **Social sharing** | Share a beer or your collection via link. Each beer/profile gets a shareable URL with an OG image. |
| **Activity feed** | A simple feed of recent ratings from people you follow. |
| **Follow breweries** | Follow a brewery to be notified when new beers are added. |
| **Export to CSV** | Let users export their full collection and ratings as a CSV file. |

### Phase 4 — Data & Performance

Operationalise the data layer and make the app fast at scale.

| Feature | Description |
|---|---|
| **Brewery import** | Bulk-import brewery and beer data via CSV upload (UI for the existing `import-csv.ts` stub). |
| **Search performance** | Evaluate and implement a caching strategy so search results are fast. Consider edge caching or a search index. |
| **Offline support** | The core listing and personal collection should work offline. Investigate service workers or local-first sync. |

### Phase 5 — Monetisation & Growth

Premium features that could support a paid tier.

| Feature | Description |
|---|---|
| **Premium accounts** | Define a free vs. paid tier. Gating candidates: unlimited collection size, export, advanced analytics. |
| **Payment integration** | Stripe or similar. Subscription billing for premium. |
| **"On tap near you"** | Location-based feature surfacing beers available at nearby venues. Requires venue/tap-list data. |
| **Taste recommendations** | Based on a user's rating history, suggest beers they haven't tried. Simple collaborative filtering. |

---

## Non-goals (for now)

- Native mobile app — web-first, but responsive design is required
- Brewery admin portal — breweries cannot manage their own listings yet
- Real-time features (websockets, live tap lists)
- User-generated content beyond ratings (no reviews, no photos)

---

## Design principles

1. **Fast by default** — listings and search should feel instant
2. **No account required to browse** — discovery is public; ratings require auth
3. **Mobile-first layout** — most users will be on phones at a bottle shop
4. **Opinionated defaults** — sensible filters pre-selected, no configuration overload
