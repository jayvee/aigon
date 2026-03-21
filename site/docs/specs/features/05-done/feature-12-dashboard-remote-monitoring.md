# Feature: Dashboard remote monitoring

## Summary
Add content to the aigon marketing site highlighting that the dashboard supports remote monitoring from phone/tablet — both on LAN and via Tailscale. This is a differentiator: monitor your AI agents from the couch.

## User Stories
- [ ] As a visitor, I can see that aigon's dashboard supports remote monitoring from mobile devices
- [ ] As a visitor, I understand I can monitor AI agent sessions from my phone

## Acceptance Criteria
- [ ] Add a bullet point or sub-section under the existing Dashboard section (#dashboard) mentioning remote access
- [ ] Keep it concise — one or two sentences + maybe an icon/emoji
- [ ] Mention LAN access and Tailscale as the remote option
- [ ] Don't add a full new section — integrate naturally into the existing dashboard feature list
- [ ] Mobile-friendly rendering (the site is already responsive)
- [ ] Include a screenshot of the dashboard viewed on a phone (real screenshot from iPhone Safari, not a mockup) to visually demonstrate remote monitoring

## Validation
```bash
# Verify index.html is valid
node --check index.html 2>/dev/null || true
```

## Technical Approach
- Edit index.html — add content within the #dashboard section
- Add a real iPhone screenshot of the dashboard (taken from Safari on the phone via the LAN/Tailscale URL) to `img/`
- Match existing copy tone and visual style

## Dependencies
- None

## Out of Scope
- Tailscale setup guide on the site
- New dedicated page for remote access

## Open Questions
- Exact wording and icon choice to be determined during implementation

## Related
- Research: N/A
