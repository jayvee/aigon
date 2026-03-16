# Feature: aigon-site-logo-integration

## Summary
Replace the placeholder inline SVG lettermark favicon on aigon-site with the official aigon diamond icon. Deliver size-optimized SVG variants (16, 32, 64px) and wire them up as the browser favicon and any other logo placements on the marketing site.

## User Stories
- [ ] As a visitor, I see the aigon diamond icon in my browser tab, not a generic "A" lettermark
- [ ] As a developer sharing the aigon.build URL, the correct icon appears in link previews and bookmarks

## Acceptance Criteria
- [ ] `<link rel="icon">` in `index.html` references `img/aigon-icon-32.svg` (real file, not inline data URI)
- [ ] SVG icon files exist at `img/aigon-icon-16.svg`, `img/aigon-icon-32.svg`, `img/aigon-icon-64.svg`
- [ ] Each SVG has size-appropriate corner radius and stroke weight (not just a scaled-down copy)
- [ ] Icon is visually identifiable in a 16×16 browser tab context

## Validation
```bash
grep 'rel="icon"' index.html | grep -v 'data:image'
test -f img/aigon-icon-32.svg
```

## Technical Approach
- Source SVGs live in `aigon` repo at `assets/icon/` — copy to `aigon-site/img/` when updated
- Use `aigon-icon-32.svg` as the primary favicon; browsers that support SVG favicons will use it at any size
- No raster fallback required for modern browsers; `favicon.ico` can be added later for legacy support

## Dependencies
- `aigon` repo: `assets/icon/aigon-icon-{16,32,64}.svg`

## Out of Scope
- Apple touch icon / PWA manifest icons
- OG image / social card logo
- Logo placement in site nav or hero (separate feature)

## Related
- Research:
