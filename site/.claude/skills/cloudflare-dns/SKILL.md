---
name: cloudflare-dns
description: Check and manage Cloudflare DNS zones, nameservers, and domain registration for aigon.build and aigon.dev. Use when the user asks about DNS, nameservers, domain status, or Cloudflare zone configuration.
disable-model-invocation: false
---

## Cloudflare DNS Status

**IMPORTANT — Token Permissions**

The token in `.env.local` has **Cloudflare Pages — Edit** permissions only.
DNS/zone management requires a separate token with **Zone Read** + **DNS Edit** permissions.

To create one:
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Create Token → Edit zone DNS template
3. Scope to the specific zone (aigon.build or aigon.dev)
4. Set `CLOUDFLARE_DNS_TOKEN=<token>` in `.env.local`

## Zone Check

!`TOKEN=$(grep -E '^CLOUDFLARE_DNS_TOKEN=' .env.local 2>/dev/null | cut -d= -f2); if [[ -n "$TOKEN" ]]; then echo "=== aigon.build ===" && curl -s "https://api.cloudflare.com/client/v4/zones?name=aigon.build" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; z=json.load(sys.stdin)['result']; print(f'Status: {z[0][\"status\"]}\\nNS: {z[0][\"name_servers\"]}\\nZone ID: {z[0][\"id\"]}') if z else print('Zone not found or token lacks access')" && echo "=== aigon.dev ===" && curl -s "https://api.cloudflare.com/client/v4/zones?name=aigon.dev" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; z=json.load(sys.stdin)['result']; print(f'Status: {z[0][\"status\"]}\\nNS: {z[0][\"name_servers\"]}\\nZone ID: {z[0][\"id\"]}') if z else print('Zone not found or token lacks access')"; else echo "No CLOUDFLARE_DNS_TOKEN found in .env.local"; echo "Token needs Zone Read permissions (Pages token won't work for DNS)"; fi`

## Project Domains

- **Primary**: `aigon.build` — Cloudflare Pages production site
- **Secondary**: `aigon.dev` — may redirect to aigon.build

## Nameserver Issue Diagnosis

If Cloudflare emails say a domain "is not benefiting from Cloudflare's network":

1. The domain was added as a zone to one Cloudflare account
2. But the registrar (where the domain was purchased) still has old nameservers
3. Fix: ensure the domain's registrar settings use the nameservers assigned to the zone
   - If registered via Cloudflare Registrar: zone and registrar must be in the **same account**
   - If registered elsewhere: update nameservers at the registrar to the Cloudflare-assigned NS records

Cloudflare-assigned nameservers for this project: `craig.ns.cloudflare.com` and `mallory.ns.cloudflare.com`

Report:
1. Whether CLOUDFLARE_DNS_TOKEN is set and has zone access
2. Zone status for aigon.build and aigon.dev (active vs pending)
3. What nameservers are assigned vs what the email expects
4. Next steps to resolve any nameserver mismatch
