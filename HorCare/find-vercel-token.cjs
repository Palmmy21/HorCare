// Use vercel CLI binary to get the token path
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Vercel CLI v33+ stores config in:
// Windows: %LOCALAPPDATA%\vercel\config.json  or %APPDATA%\vercel\config.json
// The actual token file location varies by version

const home = os.homedir();
const possiblePaths = [
  path.join(home, 'AppData', 'Roaming', 'Vercel', 'auth.json'),
  path.join(home, 'AppData', 'Local', 'Vercel', 'auth.json'),
  path.join(home, 'AppData', 'Roaming', 'Vercel', 'config.json'),
  path.join(home, 'AppData', 'Local', 'Vercel', 'config.json'),
  path.join(home, '.vercel', 'auth.json'),
  // Vercel uses a different location in newer versions
  path.join(home, 'AppData', 'Roaming', 'com.vercel.cli', 'auth.json'),
];

console.log('Searching...');
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    console.log('FOUND:', p);
    try {
      const content = fs.readFileSync(p, 'utf8');
      console.log(content.substring(0, 200));
    } catch(e) {}
  } else {
    // Try case variations
    const dir = path.dirname(p);
    const base = path.basename(p);
    try {
      const files = fs.readdirSync(dir);
      const match = files.find(f => f.toLowerCase() === base.toLowerCase());
      if (match) {
        const fullPath = path.join(dir, match);
        console.log('FOUND (case):', fullPath);
        console.log(fs.readFileSync(fullPath, 'utf8').substring(0, 200));
      }
    } catch(e2) {}
  }
}

// Search in npm global
try {
  const npmGlobal = execSync('npm root -g', { encoding: 'utf8', shell: 'cmd.exe' }).trim();
  const vercelPkg = path.join(npmGlobal, 'vercel', 'package.json');
  if (fs.existsSync(vercelPkg)) {
    const pkg = JSON.parse(fs.readFileSync(vercelPkg, 'utf8'));
    console.log('Vercel version:', pkg.version);
    
    // Read vercel source to find config path
    const vercelDist = path.join(npmGlobal, 'vercel', 'dist', 'index.js');
    if (fs.existsSync(vercelDist)) {
      const content = fs.readFileSync(vercelDist, 'utf8');
      const match = content.match(/getConfigFilePath[^"']*["']([^"']+auth[^"']+)["']/);
      if (match) console.log('Config path found in source:', match[1]);
    }
  }
} catch(e) {
  console.log('npm global search failed');
}
