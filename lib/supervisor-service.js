'use strict';

/**
 * System service installation for aigon server.
 *
 * `aigon server start --persistent` installs the server as:
 *   - macOS: ~/Library/LaunchAgents/com.aigon.server.plist (KeepAlive)
 *   - Linux: ~/.config/systemd/user/aigon-server.service (Restart=on-failure)
 *
 * The service runs `aigon dashboard start` which includes both the HTTP
 * dashboard and the supervisor loop.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SERVICE_LABEL = 'com.aigon.server';
const SYSTEMD_UNIT_NAME = 'aigon-server.service';

// ---------------------------------------------------------------------------
// Resolve the aigon CLI binary path
// ---------------------------------------------------------------------------

function resolveAigonBin() {
  // Prefer the global `aigon` if on PATH
  try {
    const bin = execSync('which aigon 2>/dev/null', { encoding: 'utf8' }).trim();
    if (bin) return bin;
  } catch (_) { /* fall through */ }

  // Fallback: node + aigon-cli.js in this repo
  const cliPath = path.resolve(__dirname, '..', 'aigon-cli.js');
  if (fs.existsSync(cliPath)) {
    return `${process.execPath} ${cliPath}`;
  }

  throw new Error('Cannot resolve aigon binary path. Ensure aigon is installed globally or run from the repo.');
}

// ---------------------------------------------------------------------------
// macOS launchd
// ---------------------------------------------------------------------------

function installLaunchd() {
  const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(agentsDir, `${SERVICE_LABEL}.plist`);
  const aigonBin = resolveAigonBin();
  const logDir = path.join(os.homedir(), '.aigon', 'logs');

  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  // Split the command for ProgramArguments
  const parts = aigonBin.split(' ');
  const programArgs = [...parts, 'dashboard', 'start'];
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
    <key>StandardOutPath</key>
    <string>${path.join(logDir, 'server-stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logDir, 'server-stderr.log')}</string>
    <key>WorkingDirectory</key>
    <string>${os.homedir()}</string>
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
  const aigonBin = resolveAigonBin();
  const logDir = path.join(os.homedir(), '.aigon', 'logs');

  if (!fs.existsSync(unitDir)) fs.mkdirSync(unitDir, { recursive: true });
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const unit = `[Unit]
Description=Aigon Server (Dashboard + Supervisor)
After=default.target

[Service]
Type=simple
ExecStart=${aigonBin} dashboard start
Restart=on-failure
RestartSec=5
WorkingDirectory=${os.homedir()}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(unitPath, unit);

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
    execSync(`systemctl --user enable ${SYSTEMD_UNIT_NAME}`, { stdio: 'ignore' });
    execSync(`systemctl --user start ${SYSTEMD_UNIT_NAME}`, { stdio: 'ignore' });
  } catch (e) {
    console.error(`Warning: systemctl commands failed: ${e.message}`);
    console.error('You may need to run: systemctl --user daemon-reload && systemctl --user enable --now aigon-server');
  }

  console.log(`Installed systemd user unit: ${unitPath}`);
  console.log('  Auto-restarts on failure (Restart=on-failure)');
  console.log('');
  console.log('To check status:');
  console.log(`  systemctl --user status ${SYSTEMD_UNIT_NAME}`);
  console.log('To uninstall:');
  console.log(`  systemctl --user disable --now ${SYSTEMD_UNIT_NAME}`);
  console.log(`  rm ${unitPath}`);
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

module.exports = {
  installService,
  uninstallService,
  SERVICE_LABEL,
  SYSTEMD_UNIT_NAME,
};
