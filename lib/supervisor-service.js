'use strict';

/**
 * System service installation for aigon server.
 *
 * `aigon server start --persistent` installs the server as:
 *   - macOS: ~/Library/LaunchAgents/com.aigon.server.plist (KeepAlive)
 *   - Linux: ~/.config/systemd/user/aigon-server.service (Restart=on-failure)
 *
 * The service runs `aigon server start` which includes both the HTTP
 * dashboard module and the supervisor loop.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SERVICE_LABEL = 'com.aigon.server';
const SYSTEMD_UNIT_NAME = 'aigon-server.service';

// ---------------------------------------------------------------------------
// Resolve the aigon launch command + working directory
// ---------------------------------------------------------------------------

function resolveServiceLaunchConfig() {
  const localCli = path.resolve(__dirname, '..', 'aigon-cli.js');
  if (fs.existsSync(localCli)) {
    return {
      workingDirectory: path.dirname(localCli),
      commandParts: [process.execPath, localCli, 'server', 'start'],
    };
  }

  // Fallback: global `aigon` on PATH — use home dir as cwd so the service
  // is not anchored to the npm bin directory and process.cwd() stays neutral.
  try {
    const bin = execSync('which aigon 2>/dev/null', { encoding: 'utf8' }).trim();
    if (bin) {
      return {
        workingDirectory: os.homedir(),
        commandParts: [bin, 'server', 'start'],
      };
    }
  } catch (_) { /* fall through */ }

  throw new Error('Cannot resolve aigon binary path. Ensure aigon is installed globally or run from the repo.');
}

// ---------------------------------------------------------------------------
// macOS launchd
// ---------------------------------------------------------------------------

function installLaunchd() {
  const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(agentsDir, `${SERVICE_LABEL}.plist`);
  const launchCfg = resolveServiceLaunchConfig();
  const logDir = path.join(os.homedir(), '.aigon', 'logs');

  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const programArgs = launchCfg.commandParts;
  const argsXml = programArgs.map(a => `        <string>${a}</string>`).join('\n');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${path.join(logDir, 'server-stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logDir, 'server-stderr.log')}</string>
    <key>WorkingDirectory</key>
    <string>${launchCfg.workingDirectory}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.PATH || ''}</string>
    </dict>
</dict>
</plist>
`;

  // Unload existing service if present
  try {
    execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'ignore' });
  } catch (_) { /* not loaded yet */ }

  fs.writeFileSync(plistPath, plist);
  execSync(`launchctl load ${plistPath}`);

  console.log(`Installed launchd service: ${plistPath}`);
  console.log('  Auto-restarts on crash (KeepAlive: true)');
  console.log(`  Logs: ${logDir}/server-*.log`);
  console.log('');
  console.log('To uninstall:');
  console.log(`  launchctl unload ${plistPath}`);
  console.log(`  rm ${plistPath}`);
}

// ---------------------------------------------------------------------------
// Linux systemd (user unit)
// ---------------------------------------------------------------------------

function installSystemd() {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const unitPath = path.join(unitDir, SYSTEMD_UNIT_NAME);
  const launchCfg = resolveServiceLaunchConfig();
  const logDir = path.join(os.homedir(), '.aigon', 'logs');

  if (!fs.existsSync(unitDir)) fs.mkdirSync(unitDir, { recursive: true });
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const quotedExec = launchCfg.commandParts.map(part => JSON.stringify(part)).join(' ');
  const unit = `[Unit]
Description=Aigon Server (Dashboard + Supervisor)
After=default.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart=${quotedExec}
Restart=on-failure
RestartSec=10
WorkingDirectory=${launchCfg.workingDirectory}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(unitPath, unit);

  let systemdActive = false;
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
    execSync(`systemctl --user enable ${SYSTEMD_UNIT_NAME}`, { stdio: 'ignore' });
    execSync(`systemctl --user start ${SYSTEMD_UNIT_NAME}`, { stdio: 'ignore' });
    systemdActive = true;
  } catch (_) {
    // systemd is not running (container, headless server, or no D-Bus session).
    // The unit file is installed and will be picked up when systemd is available.
  }

  console.log(`Installed systemd user unit: ${unitPath}`);
  console.log('  Auto-restarts on failure (Restart=on-failure)');
  console.log('');
  if (systemdActive) {
    console.log('To check status:');
    console.log(`  systemctl --user status ${SYSTEMD_UNIT_NAME}`);
    console.log('To uninstall:');
    console.log(`  systemctl --user disable --now ${SYSTEMD_UNIT_NAME}`);
    console.log(`  rm ${unitPath}`);
  } else {
    console.log('Note: systemd is not active in this environment (container or headless server).');
    console.log('The unit file is installed and will activate when systemd is available.');
    console.log('To start the server now, run: aigon server start');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function installService() {
  if (process.platform === 'darwin') {
    installLaunchd();
  } else if (process.platform === 'linux') {
    installSystemd();
  } else {
    console.error(`Persistent mode is not supported on ${process.platform}.`);
    console.error('Supported platforms: macOS (launchd), Linux (systemd).');
    process.exitCode = 1;
  }
}

function uninstallService() {
  if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    try { execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}
    try { fs.unlinkSync(plistPath); } catch (_) {}
    console.log('Launchd service removed.');
  } else if (process.platform === 'linux') {
    const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT_NAME);
    try { execSync(`systemctl --user disable --now ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}
    try { fs.unlinkSync(unitPath); } catch (_) {}
    try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch (_) {}
    console.log('Systemd user unit removed.');
  }
}

/**
 * Check if the persistent service is currently installed.
 */
function isServiceInstalled() {
  if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    return fs.existsSync(plistPath);
  } else if (process.platform === 'linux') {
    const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT_NAME);
    return fs.existsSync(unitPath);
  }
  return false;
}

/**
 * Restart the persistent service via the system service manager.
 * On macOS: launchctl kickstart -k (atomic kill-and-restart, no race window).
 *   Avoids the unload+load pattern which is non-atomic: unload sends SIGTERM
 *   but the process may still be alive when load fires a new instance; both
 *   processes then race via the "Taking over" registry logic, causing a
 *   cascade of SIGTERMs as launchd's KeepAlive fires between kills.
 * On Linux: systemctl --user restart.
 */
function restartService() {
  if (process.platform === 'darwin') {
    const uid = (() => {
      try { return parseInt(execSync('id -u', { encoding: 'utf8', stdio: 'pipe' }).trim(), 10); } catch (_) { return null; }
    })();
    if (uid != null) {
      try {
        // kickstart -k: kills existing process and starts fresh atomically (macOS 10.10+)
        execSync(`launchctl kickstart -k gui/${uid}/${SERVICE_LABEL}`, { stdio: 'ignore' });
        return;
      } catch (_) { /* service not loaded — fall through to load */ }
    }
    // Fallback: service not currently loaded, load it fresh
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}
    execSync(`launchctl load "${plistPath}"`, { stdio: 'ignore' });
  } else if (process.platform === 'linux') {
    execSync(`systemctl --user restart ${SYSTEMD_UNIT_NAME}`, { stdio: 'ignore' });
  }
}

/**
 * Stop the persistent service via the system service manager.
 * On macOS: unload the plist so launchd won't restart it.
 * On Linux: systemctl --user stop.
 */
function stopService() {
  if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    try { execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}
  } else if (process.platform === 'linux') {
    try { execSync(`systemctl --user stop ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}
  }
}

module.exports = {
  installService,
  uninstallService,
  isServiceInstalled,
  restartService,
  stopService,
  SERVICE_LABEL,
  SYSTEMD_UNIT_NAME,
};
