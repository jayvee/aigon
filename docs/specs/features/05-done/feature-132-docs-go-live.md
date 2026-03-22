# Feature: docs-go-live

## Summary

Switch aigon.build from Cloudflare Pages to Vercel, configure DNS, set up redirects for any changed paths, enable Fumadocs AI chat, and decommission the old Cloudflare deployment. This is the final step — everything before this runs on Vercel preview URLs.

## Acceptance Criteria

### DNS & Deployment
- [x] aigon.build DNS points to Vercel (CNAME or A record)
- [x] SSL certificate provisioned and working on Vercel
- [x] Old Cloudflare Pages deployment decommissioned
- [x] Redirects configured for any paths that changed (301s, not 404s)
- [x] Verify site loads correctly from multiple regions

### Docs Features
- [x] AI chat enabled using Fumadocs LLM integration + llms.txt
- [ ] Google Search Console updated (if applicable)

### Repo Cleanup
- [x] Old aigon-site repo archived on GitHub with README pointing to aigon/site/
- [x] README.md slimmed down: brief overview + "Full documentation at https://aigon.build/docs"
- [x] README.md links to key docs pages: Getting Started, Execution Modes, CLI Reference, Dashboard
- [x] GUIDE.md deprecated: replaced with a one-liner pointing to https://aigon.build/docs
- [x] Help text (`templates/help.txt`) updated to reference aigon.build/docs

## Validation

```bash
curl -sI https://aigon.build | head -5  # verify Vercel serving
curl -sI https://aigon.build/docs/ | head -5  # verify docs section
```

## Technical Approach

1. In Cloudflare: remove Pages deployment, update DNS records to point to Vercel
2. In Vercel: add custom domain `aigon.build`, verify DNS propagation
3. Configure `next.config.ts` redirects for any changed URL patterns
4. Enable Fumadocs AI chat in config
5. Generate `llms.txt` for LLM consumption of docs
6. Archive `aigon-site` repo on GitHub
7. Slim down README.md — keep install instructions + brief overview, replace detailed docs with links to aigon.build/docs
8. Replace GUIDE.md content with: `Full documentation is at [aigon.build/docs](https://aigon.build/docs)`
9. Update `templates/help.txt` footer to reference aigon.build/docs

## Dependencies

- Feature: docs-content (site must have real content before going live)

## Out of Scope

- Ongoing content maintenance
- Analytics setup (follow-up)
- SEO optimization beyond basic redirects

## Related

- Research: #17 new-docs-site
- Feature: docs-content (prerequisite)
