# Implementation Log: Feature 437 - dashboard-terminal-load-quickwins
Agent: cx

## Status
- **Review Status**: Completed
- **Performance**: PTY output is now buffered (12ms window) to reduce browser main-thread congestion.
- **Reliability**: Client-side token caching and auto-retry on 4001 status codes implemented.

## New API Surface
- `window.__ptyToken`: Client-side cache for PTY authentication tokens.
- `getPtyToken()` / `clearPtyToken()`: Helpers for managed token retrieval.

## Key Decisions
- **Buffering Window**: Settled on 12ms for output flushing. This provides a good balance between "snappy" terminal feel and efficient batching for high-frequency output (e.g., `cat` of large files).
- **Two-phase Handshake**: PTY spawning is now deferred until the first `resize` frame from the client to ensure `tmux attach` starts with exact dimensions.

## Gotchas / Known Issues
- **Memory Leak Fixed**: Corrected a potential leak where `pendingOutput` would grow if the WebSocket closed while the PTY was still emitting data.

## Explicitly Deferred
- None.

## For the Next Feature in This Set
- Consider compression (zlib) for PTY streams if latency over WAN becomes a bottleneck.

## Test Coverage
- Verified via `tests/integration/pty-terminal.test.js`.
