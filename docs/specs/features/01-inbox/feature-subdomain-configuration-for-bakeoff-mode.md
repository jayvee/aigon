# Feature: Subdomain Configuration for Bakeoff Mode

## Summary

When running Aigon in bakeoff (multi-agent) mode, each agent works in a separate worktree and runs its own Next.js dev server. Currently, agents access their servers via `localhost` with different ports (3001, 3002, 3003), making it difficult to distinguish which agent you're testing in browser tabs and history. This feature adds automatic subdomain configuration so each agent gets a meaningful URL like `http://cc.myapp.test:3001`, making multi-agent testing more intuitive and organized.

## User Stories

- [ ] As a developer running a bakeoff, I want each agent's dev server to have a distinct subdomain (e.g., `cc.myapp.test`, `gg.myapp.test`) so I can easily identify which agent's implementation I'm testing in my browser
- [ ] As a developer, I want Aigon to automatically detect my project name from `package.json` and use it in subdomain generation so I don't have to manually configure domain names
- [ ] As a developer, I want clear setup instructions for configuring local DNS resolution so I can get subdomains working with minimal friction
- [ ] As a developer who hasn't set up DNS resolution, I want the system to gracefully fall back to `localhost` URLs so I can still run bakeoffs without additional setup

## Acceptance Criteria

- [ ] When running `aigon bakeoff-setup`, each agent's `.env.local` includes both `PORT` and `HOSTNAME` environment variables
- [ ] The `HOSTNAME` follows the pattern `{agent-id}.{project-name}.test` (e.g., `cc.surfing-explorer.test`)
- [ ] Project name is auto-detected from `package.json` name field, with fallback to current directory name
- [ ] Project names are sanitized for domain usage (lowercase, remove npm scope, replace invalid characters with hyphens)
- [ ] Console output shows full URLs for each agent after setup (e.g., `✅ cc: http://cc.surfing-explorer.test:3001`)
- [ ] The `.test` TLD is used (not `.local`) to avoid mDNS conflicts on macOS
- [ ] Users can override auto-detected project name via `AIGON_PROJECT_NAME` environment variable
- [ ] Documentation includes dnsmasq setup guide for macOS, Linux, and Windows (WSL)
- [ ] Documentation includes troubleshooting section for DNS resolution issues
- [ ] Existing PORT-based configuration continues to work unchanged

## Technical Approach

**Implementation Changes:**

1. **Add Project Name Detection** (`aigon-cli.js`)
   - New `getProjectName()` function:
     - Check `AIGON_PROJECT_NAME` env var first
     - Read `package.json` name field
     - Fall back to `path.basename(process.cwd())`
   - New `sanitizeDomainName(name)` function:
     - Convert to lowercase
     - Remove npm scope prefix (`@org/` → ``)
     - Replace invalid characters with hyphens
     - Collapse multiple hyphens
     - Trim leading/trailing hyphens

2. **Update Agent Configuration** (`aigon-cli.js`)
   - Add `subdomain` field to `AGENT_CONFIGS`:
     ```js
     cc: { id: 'cc', subdomain: 'cc', port: 3001, ... }
     ```

3. **Modify bakeoff-setup Command** (`aigon-cli.js`)
   - In worktree `.env.local` creation:
     ```js
     const projectName = getProjectName();
     const hostname = `${agentConfig.subdomain}.${projectName}.test`;
     envContent += `PORT=${port}\n`;
     envContent += `HOSTNAME=${hostname}\n`;
     ```
   - Update console output to show full URL:
     ```js
     console.log(`✅ ${agentId}: http://${hostname}:${port}`);
     ```

4. **Documentation Updates**
   - Add "Local DNS Setup" section to README with:
     - dnsmasq installation for macOS (Homebrew)
     - dnsmasq configuration for `.test` TLD
     - DNS resolver setup (`/etc/resolver/test`)
     - Verification steps (`ping myapp.test`)
     - Troubleshooting common issues
   - Add note about optional HTTPS setup with mkcert
   - Document `AIGON_PROJECT_NAME` override

**Key Technical Decisions:**

- **TLD**: Use `.test` (IETF-reserved for testing) instead of `.local` (conflicts with macOS mDNS)
- **Port Strategy**: Keep unique ports per agent (required for parallel servers)
- **DNS Solution**: dnsmasq for wildcard domain support
- **SSL**: HTTP only (HTTPS via mkcert documented as optional enhancement)
- **Framework**: Next.js only for initial implementation (HOSTNAME env var support)

**Non-Functional Requirements:**

- Zero breaking changes to existing Aigon workflows
- Graceful degradation if DNS not configured (localhost still works)
- Cross-platform documentation (macOS primary, Linux/Windows WSL secondary)
- Minimal one-time setup burden for users

## Dependencies

**External Tools (User-Installed):**
- dnsmasq (for wildcard `.test` domain resolution)
- Homebrew (macOS package manager for dnsmasq installation)

**Project Requirements:**
- Next.js project with `package.json`
- Next.js version that supports `HOSTNAME` environment variable (most recent versions)

**No Aigon Code Dependencies:**
- This feature extends existing `bakeoff-setup` command only
- No changes to other Aigon commands

## Out of Scope

**Explicitly NOT Included:**

- Automatic dnsmasq installation/configuration script
- HTTPS/SSL certificate generation (mkcert setup documented as optional)
- Support for frameworks other than Next.js
- Reverse proxy setup for port-free URLs (e.g., nginx/Caddy)
- Cloud-based development environments
- Automatic `.local` to `.test` migration for existing projects
- DNS verification/health check commands
- Single-agent mode subdomain configuration (remains `localhost` or user-configured)

**Future Enhancements (Phase 2):**
- Automatic dnsmasq setup wizard
- Support for additional frameworks (Vite, Create React App, etc.)
- Optional HTTPS with automatic mkcert integration
- Windows-native DNS configuration (without WSL)

## Open Questions

- Should we add a verification step in `bakeoff-setup` that checks if DNS resolution works and warns users if not?
- Should we support an alternative to dnsmasq for users who prefer different DNS solutions?
- Should single-agent mode also use subdomains for consistency, or keep using `localhost`?
- How should we handle projects without `package.json` (non-Node.js projects in future)?

## Related

- Research: [Subdomains for Multi-Agent Mode](../../research-topics/03-in-progress/research-01-subdomains-for-multi-agent-mode.md)
- External Docs:
  - [Next.js allowedDevOrigins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins)
  - [dnsmasq setup on macOS](https://gist.github.com/ogrrd/5831371)
  - [mkcert for local HTTPS](https://github.com/FiloSottile/mkcert)
