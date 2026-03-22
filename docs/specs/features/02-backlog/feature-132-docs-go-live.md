# Feature: docs-go-live

## Summary

Switch aigon.build from Cloudflare Pages to Vercel, configure DNS, set up redirects for any changed paths, enable Fumadocs AI chat, and decommission the old Cloudflare deployment. This is the final step — everything before this runs on Vercel preview URLs.

## Acceptance Criteria

- [ ] aigon.build DNS points to Vercel (CNAME or A record)
- [ ] SSL certificate provisioned and working on Vercel
- [ ] Old Cloudflare Pages deployment decommissioned
- [ ] Redirects configured for any paths that changed (301s, not 404s)
- [ ] AI chat enabled using Fumadocs LLM integration + llms.txt
- [ ] Google Search Console updated (if applicable)
- [ ] Old aigon-site repo archived on GitHub with README pointing to aigon/site/
- [ ] Verify site loads correctly from multiple regions

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

## Dependencies

- Feature: docs-content (site must have real content before going live)

## Out of Scope

- Ongoing content maintenance
- Analytics setup (follow-up)
- SEO optimization beyond basic redirects

## Related

- Research: #17 new-docs-site
- Feature: docs-content (prerequisite)
