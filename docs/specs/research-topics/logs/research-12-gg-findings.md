---
status: submitted
updated: 2026-03-17T02:24:16.390Z
---

# Research Findings: local dev proxy reliability

**Agent:** Gemini (gg)
**Research ID:** 12
**Date:** 2026-03-17

---

## Key Findings

### 1. The built-in `.localhost` TLD
The most impactful finding is that modern browsers (Chrome, Safari, Firefox, Edge) and macOS automatically resolve `*.localhost` to `127.0.0.1`.
- **Pros:** Completely eliminates the need for `dnsmasq` and the associated `sudo` setup for DNS resolution.
- **Cons:** Requires transitioning Aigon's dev domains from `.test` to `.localhost`.

### 2. Traefik
- **Pros:** Dynamic route registration via REST API. No file generation or reload step needed, which solves the Caddyfile desync issue perfectly.
- **Cons:** Needs a separate system DNS config for `*.test` (or switch to `.localhost`). Still requires `sudo` to bind to port 80 unless port forwarding is used.

### 3. Puma-dev
- **Pros:** A native macOS tool specifically designed for this. It handles `sudo` requirements via a one-time installer, manages its own `launchd` service on ports 80/443, and generates local SSL certs. Crucially, it supports dynamic routing via port files: writing `echo 4100 > ~/.puma-dev/cx-66` instantly creates `cx-66.test` proxying to `4100`.
- **Cons:** It's an external dependency (Ruby ecosystem).

### 4. macOS Port Forwarding (`pfctl`)
- **Pros:** macOS's built-in Packet Filter can silently redirect port 80 traffic to a non-privileged port (like 8080). This requires `sudo` to set up once, but no `sudo` to run the proxy.
- **Cons:** Modifying `/etc/pf.conf` and anchors via automated scripts can be brittle across macOS upgrades.

### 5. Node.js Dynamic Proxy
- **Pros:** Since Aigon already has a registry (`servers.json`), a lightweight Node.js `http-proxy` running on a non-privileged port (e.g. 8080) can simply read the registry in real-time for every request. Zero desync.
- **Cons:** Doesn't solve the port 80 binding issue unless paired with `pfctl` or forcing users to type `:8080` in URLs.

## Sources
- [Traefik dynamic configuration via API](https://doc.traefik.io/traefik/providers/api/)
- [Puma-dev documentation](https://github.com/puma/puma-dev)
- [Puma-dev port files](https://github.com/puma/puma-dev#advanced-usage)
- [macOS `.localhost` resolution behavior](https://datatracker.ietf.org/doc/html/rfc6761#section-6.3)

## Recommendation

**Architectural Pivot: `.localhost` + Node.js Proxy on Port 8080**

The current stack's fragility comes from external dependencies (`dnsmasq`, `caddy`) and the friction of `sudo`.
1. **Drop `.test` and `dnsmasq`**: Switch Aigon to use `*.localhost` for dev servers. This immediately removes half the complexity and setup friction.
2. **Replace Caddy with a built-in Node Proxy**: Create a lightweight Node.js HTTP proxy that reads `servers.json` in real-time on every request. This completely eliminates the "Caddyfile desync" and "reload failure" issues.
3. **Run on a non-privileged port**: Have the proxy run on `8080`. Users access URLs like `cx-66.aigon.localhost:8080`.
4. **(Optional/Progressive Enhancement) macOS PF**: Add an advanced `aigon proxy-setup` step that uses `sudo pfctl` to map `80 -> 8080` so users can drop the port number in the URL, but make it optional.

This drastically simplifies setup, requires zero external `brew` services, and gives us 100% control over the routing logic and error handling (which solves the "silent failure" problem).

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| switch-to-localhost | Update Aigon to use `.localhost` instead of `.test` for all dev servers. | high | none |
| node-dev-proxy | Implement a built-in Node.js HTTP proxy to replace Caddy, dynamically routing based on `servers.json`. | high | switch-to-localhost |
| proxy-setup-pfctl | Add an optional `aigon proxy-setup` command to set up macOS `pfctl` forwarding from port 80 to 8080. | medium | node-dev-proxy |
| puma-dev-spike | Alternative: Investigate integrating `puma-dev` if `.test` domains and automatic SSL are strictly required. | low | none |
