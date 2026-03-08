import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const repoRoot = resolve(desktopDir, '..');

const requiredPaths = [
  resolve(desktopDir, 'src-tauri/icons/32x32.png'),
  resolve(desktopDir, 'src-tauri/icons/128x128.png'),
  resolve(desktopDir, 'src-tauri/icons/icon.png'),
  resolve(desktopDir, 'src-tauri/icons/icon.ico'),
  resolve(desktopDir, 'src-tauri/icons/icon.icns'),
  resolve(desktopDir, 'public/logo.png'),
  resolve(desktopDir, 'public/logo.jpg'),
];

function ensurePrebuiltAssets() {
  const missing = requiredPaths.filter((path) => !existsSync(path));
  if (missing.length === 0) {
    console.error('Using checked-in icon assets.');
    return;
  }

  console.error('Missing required icon assets:');
  for (const path of missing) {
    console.error(`  ${path}`);
  }
  process.exit(1);
}

if (process.platform !== 'darwin') {
  ensurePrebuiltAssets();
  process.exit(0);
}

const scriptPath = resolve(scriptDir, 'generate-icons.sh');
if (!existsSync(resolve(repoRoot, 'logo.png')) && !existsSync(resolve(repoRoot, 'logo.jpg'))) {
  console.error('Source logo not found. Expected repo root logo.png or logo.jpg.');
  process.exit(1);
}

const result = spawnSync('zsh', [scriptPath], {
  stdio: 'inherit',
  cwd: desktopDir,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
