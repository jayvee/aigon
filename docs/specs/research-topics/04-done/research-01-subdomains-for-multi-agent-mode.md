# Research: subdomains for multi-agent mode

## Context

In Aigon's bakeoff (multi-agent) mode, multiple agents work on the same feature in separate worktrees. Each agent needs to run the Next.js dev server on a unique subdomain to enable isolated testing and comparison.

**Desired behavior:**
- **Single-agent mode**: Dev server runs on `http://surfing-explorer.local` (project name as domain)
- **Multi-agent mode**: Dev servers run on subdomains like `http://cc.surfing-explorer.local`, `http://gg.surfing-explorer.local`, `http://cx.surfing-explorer.local`

This research will determine the best approach for configuring Next.js dev servers, managing local DNS resolution, and integrating with the existing Aigon workflow.

## Questions to Answer

- [x] What are the available methods for running Next.js dev server on custom domains?
  - `next dev --hostname` flag (works, but some console output issues)
  - Environment variables (`HOSTNAME`, supported; `HOST`, not standard)
  - Next.js configuration file options (`allowedDevOrigins` recommended)
  - Custom server (most control, but complex)
- [x] How should `.local` domains be resolved locally?
  - `/etc/hosts` file entries (works, but no wildcard support)
  - Local DNS server (dnsmasq recommended for wildcard support)
  - mDNS/Bonjour (built-in macOS, but `.local` causes conflicts - avoid!)
  - Other solutions (nginx/Caddy reverse proxy - overkill for this use case)
  - **Decision**: Use `.test` TLD instead of `.local`, with dnsmasq
- [x] How can Aigon automatically configure subdomains per agent?
  - Where: `bakeoff-setup` command (already creates `.env.local`)
  - Project name: Read from `package.json` name field, fall back to directory name
  - Agent mapping: Use existing agent IDs (cc, gg, cx) as subdomain prefixes
  - Pattern: `{agent}.{project}.test:{port}`
- [x] How should this integrate with existing PORT configuration?
  - Aigon currently sets unique PORT values per agent (3001, 3002, 3003)
  - **Decision**: Complement, not replace - use domains with ports
  - URLs: `http://cc.myapp.test:3001`, `http://gg.myapp.test:3002`
- [x] What's the developer experience for setup?
  - One-time: Install and configure dnsmasq for `.test` TLD
  - Per-project: None - Aigon auto-detects project name
  - Troubleshooting: Document DNS verification, common issues
- [x] How to handle SSL/HTTPS for local development?
  - HTTP is sufficient for local multi-agent testing
  - HTTPS optional - document mkcert setup for users who want it
  - **Decision**: Ship with HTTP, document HTTPS as optional enhancement

## Scope

### In Scope
- Next.js dev server domain configuration methods
- Local DNS resolution approaches for `.local` domains
- Automatic subdomain setup in bakeoff workflow
- Integration with existing PORT-based configuration
- Detecting project name from Next.js app structure
- Cross-platform considerations (macOS, Linux, Windows)
- Documentation and troubleshooting guides

### Out of Scope
- Production domain configuration
- Other frameworks beyond Next.js (initial implementation)
- Automatic SSL certificate generation (unless trivial)
- Cloud-based development environments

## Findings

### Next.js Dev Server Custom Domain Configuration

**Methods Available:**

1. **`next dev -H` flag** - Command-line flag to specify custom hostname
   - Example: `next dev -p 3000 -H myapp.local`
   - Note: Some versions had issues with console output not showing custom hostname

2. **Environment Variables**
   - `HOSTNAME` - Supported in recent Next.js versions
   - `PORT` - Also supported via environment variable
   - Example: `HOSTNAME=myapp.local PORT=3001 npm run dev`
   - **Caveat**: Can conflict with AWS ECS deployments (which sets `$HOSTNAME` to container ID)

3. **`allowedDevOrigins` configuration** (Recommended for 2025)
   - New Next.js config option in `next.config.js`
   - Allows requests from origins other than localhost
   - Enables multiple custom domains in development
   - Example:
     ```js
     module.exports = {
       allowedDevOrigins: ['http://cc.myapp.local:3001', 'http://gg.myapp.local:3002']
     }
     ```

4. **Custom Server** (Most control, but complex)
   - Create a custom `server.js` with explicit hostname/port
   - Required when using middleware with custom domains
   - Example:
     ```js
     const hostname = 'myapp.local'
     const port = 3000
     const app = next({ dev, hostname, port })
     ```

**Sources:**
- [Next.js Custom Server Guide](https://nextjs.org/docs/pages/guides/custom-server)
- [GitHub: Unable to run dev server with custom hostname](https://github.com/vercel/next.js/issues/55364)
- [Next.js allowedDevOrigins documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins)
- [GitHub: Middleware hostname requirement](https://github.com/vercel/next.js/discussions/33835)

### Local DNS Resolution for .local Domains

**Critical Issue with .local TLD:**
- `.local` is reserved for Multicast DNS (mDNS) used by Apple's Bonjour
- macOS treats `.local` domains differently, causing performance and resolution issues
- **Recommendation**: Avoid `.local` - use `.test`, `.lan`, or `.dev` instead
- `.test` is officially reserved by IETF for testing purposes

**DNS Resolution Options:**

1. **`/etc/hosts` File** (Simplest, but no wildcard support)
   - Manual entries: `127.0.0.1 cc.myapp.test`
   - Pros: Simple, no additional software
   - Cons: No wildcard support, must add each subdomain manually
   - Cons: Doesn't work well with `.local` on macOS

2. **dnsmasq** (Recommended for wildcard domains)
   - Install via Homebrew: `brew install dnsmasq`
   - Configure to resolve `*.myapp.test` to `127.0.0.1`
   - Setup DNS resolver to query dnsmasq first
   - Pros: Wildcard support, reads `/etc/hosts` automatically
   - Cons: Requires one-time system setup
   - Configuration steps:
     1. Install dnsmasq
     2. Configure to resolve custom TLD (e.g., `address=/.test/127.0.0.1`)
     3. Add resolver config: `/etc/resolver/test` with `nameserver 127.0.0.1`
     4. Restart dnsmasq

3. **nginx/Caddy Reverse Proxy** (Over-engineered for this use case)
   - Route subdomains to different ports
   - Pros: Can handle SSL, advanced routing
   - Cons: Complex setup, additional moving parts

**Recommended TLD: `.test`**
- Officially reserved for testing (IETF RFC 2606)
- Won't conflict with real domains
- Works correctly with DNS resolution tools
- Example domains: `myapp.test`, `cc.myapp.test`, `gg.myapp.test`

**Sources:**
- [dnsmasq setup on macOS gist](https://gist.github.com/ogrrd/5831371)
- [Local wildcard DNS with dnsmasq on macOS](https://til.simonwillison.net/macos/wildcard-dns-dnsmasq)
- [How to Setup Automatic Local Domains with Dnsmasq on macOS](https://medium.com/@hjblokland/how-to-setup-automatic-local-domains-with-dnsmasq-and-nginx-on-macos-5f34174bdf82)
- [Setting up dnsmasq on macOS](https://gist.github.com/tmslnz/51064056f947cec2de34e4d40081deb6)

### SSL/HTTPS for Local Development

**Tool: mkcert** (Recommended)
- Zero-config tool for locally-trusted development certificates
- Automatically installs a local CA in system trust store
- Generates valid certificates for any hostname/IP

**Setup:**
```bash
# Install
brew install mkcert
brew install nss  # if using Firefox

# Install local CA
mkcert -install

# Generate certificate for domains
mkcert myapp.test "*.myapp.test"
```

**Browser Compatibility:**
- Safari: Works automatically (uses system keychain)
- Chrome: Works automatically (uses system keychain)
- Firefox: Requires NSS package installation

**Security Considerations:**
- The `rootCA-key.pem` file gives complete MITM capability
- Never share or commit this file
- Only for development, not production

**Is HTTPS Required for This Use Case?**
- **No** - HTTP is sufficient for local multi-agent testing
- Modern browsers don't require HTTPS for localhost/127.0.0.1
- Can add HTTPS later as optional enhancement
- Recommendation: Start with HTTP, document HTTPS as optional

**Sources:**
- [mkcert GitHub repository](https://github.com/FiloSottile/mkcert)
- [Self-Signed Wildcard SSL with mkcert on macOS](https://medium.com/@hjblokland/how-to-create-self-signed-wildcard-ssl-certificates-with-mkcert-on-macos-a6a3663aa157)
- [Using mkcert for HTTPS on local dev sites](https://dev.to/aschmelyun/using-the-magic-of-mkcert-to-enable-valid-https-on-local-dev-sites-3a3c)
- [web.dev: HTTPS for local development](https://web.dev/articles/how-to-use-local-https)

### PORT vs Domain Configuration Trade-offs

**Current Aigon Approach:**
- Sets unique PORT per agent (cc=3001, gg=3002, cx=3003)
- Creates `.env.local` in each worktree with agent-specific PORT
- Agents access via `http://localhost:3001`, `http://localhost:3002`, etc.

**Proposed Domain-Based Approach:**
- Each agent gets subdomain: `http://cc.myapp.test`, `http://gg.myapp.test`, etc.
- Can still use different ports (required for parallel servers)
- Access via `http://cc.myapp.test:3001`, `http://gg.myapp.test:3002`

**Key Decision: Domains + Ports vs Domains Only**

*Option A: Domains with Ports (Recommended)*
- Domains: `cc.myapp.test`, `gg.myapp.test`, `cx.myapp.test`
- Ports: 3001, 3002, 3003 (required - can't run multiple servers on same port)
- Full URLs: `http://cc.myapp.test:3001`, `http://gg.myapp.test:3002`
- Pros:
  - Easy to distinguish agents by domain in browser tabs/history
  - PORT configuration already works
  - No reverse proxy needed
  - Simple setup
- Cons:
  - Still need to specify port in URL

*Option B: Domains Only (via Reverse Proxy)*
- Domains: `cc.myapp.test`, `gg.myapp.test`, `cx.myapp.test` (all port 80)
- Backend ports: 3001, 3002, 3003
- Requires: nginx/Caddy to route `cc.myapp.test` → `localhost:3001`
- Pros:
  - Clean URLs without ports
  - More "production-like"
- Cons:
  - Complex setup (reverse proxy configuration)
  - Additional dependency
  - Overkill for development workflow

**Recommendation: Option A (Domains + Ports)**
- Simpler, more reliable
- Minimal changes to existing Aigon PORT logic
- Developer can still distinguish agents by domain name
- Ports are acceptable for development URLs

### Project Name Detection

**Sources to Detect Project Name:**

1. **package.json `name` field** (Primary source)
   - Standard location for project name
   - May contain npm scope: `@scope/project-name`
   - Need to sanitize for domain usage (remove @, /, convert to lowercase)
   - Example: `@acme/surfing-explorer` → `surfing-explorer`

2. **Git repository name** (Fallback)
   - Extract from `.git/config` or current directory name
   - Example: `/Users/dev/my-project` → `my-project`

3. **Manual override** (Environment variable)
   - `AIGON_PROJECT_NAME=custom-name`
   - Allows users to override auto-detection

**Sanitization Rules:**
- Convert to lowercase
- Remove npm scope prefix (`@scope/` → ``)
- Replace spaces/underscores with hyphens
- Remove invalid domain characters
- Example: `@MyOrg/Cool_Project` → `cool-project`

**Sources:**
- [npm package.json documentation](https://docs.npmjs.com/cli/v6/configuring-npm/package-json/)
- [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation)

### Aigon Integration Design

**Where to Implement:**

1. **`bakeoff-setup` command** (Primary integration point)
   - Already creates `.env.local` with PORT
   - Should add HOSTNAME to `.env.local`
   - Example addition: `HOSTNAME=cc.myapp.test`

2. **Project name detection function**
   - Add to `aigon-cli.js`
   - Read from package.json, fall back to directory name
   - Sanitize for domain usage

3. **User setup documentation**
   - One-time dnsmasq installation guide
   - Troubleshooting common issues
   - Add to Aigon README or docs/

**Implementation Steps:**

1. Add `getProjectName()` function to `aigon-cli.js`
   ```js
   function getProjectName() {
     // Try AIGON_PROJECT_NAME env var
     if (process.env.AIGON_PROJECT_NAME) return process.env.AIGON_PROJECT_NAME;

     // Try package.json name field
     const pkgPath = path.join(process.cwd(), 'package.json');
     if (fs.existsSync(pkgPath)) {
       const pkg = JSON.parse(fs.readFileSync(pkgPath));
       if (pkg.name) return sanitizeDomainName(pkg.name);
     }

     // Fall back to directory name
     return path.basename(process.cwd());
   }

   function sanitizeDomainName(name) {
     return name
       .toLowerCase()
       .replace(/^@[^/]+\//, '')  // Remove npm scope
       .replace(/[^a-z0-9-]/g, '-')  // Replace invalid chars
       .replace(/-+/g, '-')  // Collapse multiple hyphens
       .replace(/^-|-$/g, '');  // Trim hyphens
   }
   ```

2. Update `AGENT_CONFIGS` to include domain pattern
   ```js
   const AGENT_CONFIGS = {
     cc: { id: 'cc', port: 3001, subdomain: 'cc' },
     gg: { id: 'gg', port: 3002, subdomain: 'gg' },
     cx: { id: 'cx', port: 3003, subdomain: 'cx' }
   };
   ```

3. Modify `.env.local` creation in `bakeoff-setup`
   ```js
   const projectName = getProjectName();
   const hostname = `${agentConfig.subdomain}.${projectName}.test`;
   envContent += `# Bakeoff configuration for agent ${agentId}\n`;
   envContent += `PORT=${port}\n`;
   envContent += `HOSTNAME=${hostname}\n`;
   ```

4. Update console output to show full URLs
   ```js
   console.log(`✅ ${agentId}: http://${hostname}:${port}`);
   ```

**User Setup Requirements:**

*One-time system setup:*
1. Install dnsmasq: `brew install dnsmasq`
2. Configure for `.test` TLD:
   ```bash
   echo 'address=/.test/127.0.0.1' >> /opt/homebrew/etc/dnsmasq.conf
   ```
3. Create resolver:
   ```bash
   sudo mkdir -p /etc/resolver
   sudo bash -c 'echo "nameserver 127.0.0.1" > /etc/resolver/test'
   ```
4. Start dnsmasq: `sudo brew services start dnsmasq`

*Per-project:*
- No additional setup needed
- Aigon automatically configures subdomains based on project name

**Documentation Needs:**
- Add setup guide to Aigon README
- Troubleshooting section for DNS resolution issues
- Note about cross-platform considerations (macOS-focused initially)

## Recommendation

### Recommended Approach: Agent-Specific Subdomains with `.test` TLD

**Summary:**
Implement automatic subdomain configuration for bakeoff mode using:
- **TLD**: `.test` (not `.local`)
- **Pattern**: `{agent}.{project}.test:{port}`
- **Example**: `cc.surfing-explorer.test:3001`, `gg.surfing-explorer.test:3002`
- **DNS**: dnsmasq with wildcard `.test` resolution
- **SSL**: HTTP only (HTTPS optional, document mkcert for users who want it)

### Why This Approach?

1. **Simpler than alternatives**: Avoids reverse proxy complexity while providing clear agent identification
2. **Works with existing PORT logic**: No need to refactor current port-based setup
3. **Better UX than localhost:port**: Browser tabs/history show meaningful agent names
4. **Cross-platform compatible**: dnsmasq works on macOS, Linux, Windows (WSL)
5. **Low setup burden**: One-time dnsmasq install, automatic per-project

### Implementation Scope

**Phase 1: Core Feature**
- Add project name detection to `aigon-cli.js`
- Modify `bakeoff-setup` to add `HOSTNAME` to `.env.local`
- Update console output to show full URLs
- Document dnsmasq setup in README

**Phase 2: Optional Enhancements** (Future)
- Automatic dnsmasq installation/configuration script
- HTTPS support via mkcert (optional)
- Support for other frameworks beyond Next.js
- Windows-specific DNS resolution guide

### Decision Points

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TLD | `.test` | IETF-reserved for testing, avoids mDNS conflicts |
| DNS Solution | dnsmasq | Wildcard support, simple setup, cross-platform |
| Port Strategy | Keep unique ports | Required for parallel servers, simple |
| SSL/HTTPS | Optional (HTTP default) | Not needed for local testing, adds complexity |
| Project Name | package.json → directory | Standard npm convention, simple fallback |

### Risk Mitigation

**Risk**: Users don't have dnsmasq installed
- **Mitigation**: Clear setup documentation, graceful degradation to localhost URLs

**Risk**: `.test` domains don't resolve
- **Mitigation**: Troubleshooting guide, verification script (e.g., `ping cc.myapp.test`)

**Risk**: HOSTNAME env var conflicts (AWS ECS, etc.)
- **Mitigation**: Only set in `.env.local` for local dev, document for users deploying to AWS

**Risk**: Non-Next.js projects
- **Mitigation**: Initial implementation Next.js-only, document framework requirements

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [x] Feature: [Subdomain Configuration for Bakeoff Mode](../../features/01-inbox/feature-subdomain-configuration-for-bakeoff-mode.md)
