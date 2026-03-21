# Feature: port-registry

## Summary

Replace manual `basePort` configuration with an automatic global port registry. When `aigon init` or `aigon install-agent` runs, aigon auto-allocates a unique port range from `~/.aigon/ports.json` so no two repos ever conflict. `aigon doctor` detects and resolves port collisions across all registered repos.

## Acceptance Criteria

- [ ] `~/.aigon/ports.json` is the global port registry, mapping repo paths to allocated base ports
- [ ] `aigon init` auto-allocates a basePort if none exists — scans registry, picks next free range
- [ ] `aigon install-agent` also ensures a port is allocated (idempotent)
- [ ] Port ranges allocated in blocks of 10 (basePort + offsets for cc/gg/cx/cu + worktree dev servers)
- [ ] Starting range: 3000, incrementing by 10 (3000, 3010, 3020...) — avoids conflicts with common services
- [ ] Dashboard port (4100) is reserved and never allocated to a project
- [ ] `aigon doctor` checks for port conflicts across all registered repos and reports them
- [ ] `aigon doctor --fix` resolves conflicts by re-allocating the conflicting repo to the next free range
- [ ] `aigon dev-server start` reads the allocated port from the registry (no manual `.aigon/config.json` edit needed)
- [ ] Existing repos with manual `basePort` in `.aigon/config.json` are respected (registry doesn't override explicit config)
- [ ] `aigon board` or `aigon doctor` shows port assignments for visibility

## Validation

```bash
node -c lib/config.js
node -c lib/commands/setup.js
aigon doctor  # should show port assignments without conflicts
```

## Technical Approach

### Registry format (`~/.aigon/ports.json`)

```json
{
  "/Users/jviner/src/farline": { "basePort": 3000, "allocatedAt": "2026-03-22" },
  "/Users/jviner/src/aigon": { "basePort": 3010, "allocatedAt": "2026-03-22" },
  "/Users/jviner/src/brewboard": { "basePort": 3020, "allocatedAt": "2026-03-22" }
}
```

### Allocation logic

```js
function allocateBasePort(repoPath) {
    const registry = loadPortRegistry();
    // Check if already allocated
    if (registry[repoPath]) return registry[repoPath].basePort;
    // Find next free slot (blocks of 10, starting at 3000)
    const usedPorts = Object.values(registry).map(r => r.basePort);
    let candidate = 3000;
    while (usedPorts.includes(candidate)) candidate += 10;
    // Reserve
    registry[repoPath] = { basePort: candidate, allocatedAt: new Date().toISOString().split('T')[0] };
    savePortRegistry(registry);
    return candidate;
}
```

### Integration points

- `aigon init` → calls `allocateBasePort(cwd)`
- `aigon install-agent` → calls `allocateBasePort(cwd)` if not already allocated
- `aigon dev-server start` → reads from registry if no explicit `devProxy.basePort` in project config
- `aigon doctor` → scans registry for conflicts, dead entries (repos that no longer exist)

## Dependencies

- None

## Out of Scope

- Dynamic port allocation at runtime (this is static reservation)
- Network-level port scanning to find truly available ports
- Docker/container port mapping

## Related

- Existing `devProxy.basePort` in `.aigon/config.json`
- Existing port allocation in `lib/commands/infra.js` (dev-server start)
- Dashboard fixed at port 4100
