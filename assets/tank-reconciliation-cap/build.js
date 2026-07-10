/**
 * Custom build script for the BTP build pipeline.
 *
 * The platform calls `npm run custom_build` inside a build container with:
 *   COMPONENT_TYPE  — "srv" | "hdi-deployer"
 *   OUTPUT_PATH     — relative output path (e.g. "gen/srv" or "gen/db")
 *
 * CRITICAL: the platform copies /outputs into the runtime image as-is and
 * runs `npm start`. It does NOT run `npm install` at runtime.
 * Therefore we MUST include node_modules in /outputs.
 *
 * For "srv":
 *   1. npm install (ensure all deps including @sap/cds-dk are present)
 *   2. cds build --production  ->  gen/srv  and  gen/db
 *   3. Vite build of the React UI  ->  app/dist
 *   4. Copy React UI dist into gen/srv/app/dist
 *   5. Patch gen/srv/package.json (start command, strip devDeps)
 *   6. Copy server.js into gen/srv/
 *   7. npm install --production inside gen/srv  (ships node_modules)
 *   8. Copy gen/srv/** -> /outputs/
 *
 * For "hdi-deployer":
 *   Steps 1-2 run. Then gen/db/** -> /outputs/
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const COMPONENT_TYPE = process.env.COMPONENT_TYPE || 'srv';
const OUTPUT_PATH    = process.env.OUTPUT_PATH    || (COMPONENT_TYPE === 'srv' ? 'gen/srv' : 'gen/db');
// /outputs is the mandatory handoff directory inside the build container.
// Locally it won't exist — we fall back to OUTPUT_PATH so local test runs still work.
const OUTPUTS_DIR = fs.existsSync('/outputs') ? '/outputs' : path.join(__dirname, OUTPUT_PATH);

const ROOT = __dirname;

function run(cmd, opts) {
  console.log('\n> ' + cmd);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn('Warning: source dir not found, skipping copy: ' + src);
    return;
  }
  if (src === dest) {
    console.log('Source and destination are the same, skipping copy: ' + src);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Step 1: npm install
console.log('\n=== Step 1: Installing dependencies ===');
run('npm install --cache /tmp/npm-cache --prefer-offline');

// Step 2: CDS build
console.log('\n=== Step 2: CDS build --production ===');
run('node_modules/.bin/cds build --production');

if (COMPONENT_TYPE === 'srv') {

  // Step 3: React UI build
  const uiDir = path.join(ROOT, 'app', 'react-ui');
  if (fs.existsSync(uiDir)) {
    console.log('\n=== Step 3: Installing React UI dependencies ===');
    run('npm install --cache /tmp/npm-cache --prefer-offline', { cwd: uiDir });
    console.log('\n=== Step 3b: Building React UI (Vite) ===');
    run('node_modules/.bin/vite build', { cwd: uiDir });
    const uiDist   = path.join(ROOT, 'app', 'dist');
    const uiTarget = path.join(ROOT, 'gen', 'srv', 'app');
    console.log('\n=== Step 3c: Copying React UI dist -> gen/srv/app (flat) ===');
    copyDir(uiDist, uiTarget);
  } else {
    console.log('\n=== Step 3: No React UI found — skipping ===');
  }

  // Step 4: Patch gen/srv/package.json
  const genPkgPath = path.join(ROOT, 'gen', 'srv', 'package.json');
  if (fs.existsSync(genPkgPath)) {
    console.log('\n=== Step 4: Patching gen/srv/package.json ===');
    const pkg = JSON.parse(fs.readFileSync(genPkgPath, 'utf8'));
    pkg.scripts       = pkg.scripts || {};
    pkg.scripts.start = 'node node_modules/@sap/cds/bin/serve.js all --production';
    // Ensure @cap-js/hana is present for HANA production mode
    pkg.dependencies = pkg.dependencies || {};
    if (!pkg.dependencies['@cap-js/hana']) {
      pkg.dependencies['@cap-js/hana'] = '^2';
      console.log('    injected @cap-js/hana into gen/srv/package.json dependencies');
    }
    delete pkg.devDependencies;
    fs.writeFileSync(genPkgPath, JSON.stringify(pkg, null, 2));
    console.log('    start command set, devDependencies removed');
  }

  // Step 5: Copy server.js into gen/srv
  const serverSrc  = path.join(ROOT, 'server.js');
  const serverDest = path.join(ROOT, 'gen', 'srv', 'server.js');
  if (fs.existsSync(serverSrc)) {
    console.log('\n=== Step 5: Copying server.js -> gen/srv/server.js ===');
    fs.copyFileSync(serverSrc, serverDest);
  }

  // Step 6: npm install --production inside gen/srv (ships node_modules with output)
  const genSrvDir = path.join(ROOT, 'gen', 'srv');
  console.log('\n=== Step 6: npm install --production in gen/srv ===');
  run('npm install --omit=dev --cache /tmp/npm-cache --prefer-offline', { cwd: genSrvDir });

  // Step 6b: Create + seed SQLite DB (production)
  const dbFile = path.join(genSrvDir, 'db.sqlite');
  const csnFile = path.join(genSrvDir, 'srv', 'csn.json');
  if (fs.existsSync(csnFile)) {
    console.log('\n=== Step 6b: Deploying schema to SQLite and seeding data ===');
    // Use cds deploy to create schema
    run(`node_modules/.bin/cds deploy ${csnFile} --to sqlite:${dbFile}`, { cwd: ROOT, env: { ...process.env, CDS_ENV: 'production' } });
    // Seed from CSV data files using node/sqlite3 directly
    const csvDir = path.join(ROOT, 'db', 'data');
    if (fs.existsSync(csvDir)) {
      const seedScript = `
const sqlite3 = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const db = new sqlite3('${dbFile}');
const csvDir = '${csvDir}';
const map = {
  'tank.reconciliation-TankConfiguration.csv': 'tank_reconciliation_TankConfiguration',
  'tank.reconciliation-ReconciliationRun.csv': 'tank_reconciliation_ReconciliationRun',
  'tank.reconciliation-TankResult.csv': 'tank_reconciliation_TankResult',
  'tank.reconciliation-AuditLogEntry.csv': 'tank_reconciliation_AuditLogEntry',
};
for (const [file, table] of Object.entries(map)) {
  const p = path.join(csvDir, file);
  if (!fs.existsSync(p)) { console.log('SKIP', file); continue; }
  const lines = fs.readFileSync(p, 'utf8').split('\\n').filter(l => l.trim());
  const headers = lines[0].split(',');
  const cols = db.pragma('table_info(' + table + ')').map(c => c.name);
  const useCols = headers.filter(h => cols.includes(h));
  const stmt = db.prepare('INSERT OR REPLACE INTO ' + table + ' (' + useCols.map(c => '"' + c + '"').join(',') + ') VALUES (' + useCols.map(() => '?').join(',') + ')');
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const row = useCols.map((c, j) => { const v = vals[headers.indexOf(c)] || ''; return v === 'true' ? 1 : v === 'false' ? 0 : v === '' ? null : v; });
    try { stmt.run(row); n++; } catch(e) { console.error('  Row', i, e.message); }
  }
  console.log('Seeded', table + ':', n, 'rows');
}
db.close();
`;
      fs.writeFileSync('/tmp/seed_db.js', seedScript);
      run(`node /tmp/seed_db.js`, { cwd: genSrvDir });
    }
  } else {
    console.log('   csn.json not found, skipping SQLite deploy');
  }

  // Step 7: Copy gen/srv -> /outputs
  console.log('\n=== Step 7: Copying gen/srv -> ' + OUTPUTS_DIR + ' ===');
  copyDir(genSrvDir, OUTPUTS_DIR);

} else {
  // hdi-deployer: copy gen/db -> /outputs
  const srcDir = path.join(ROOT, 'gen', 'db');
  console.log('\n=== Step 3 (hdi-deployer): Copying gen/db -> ' + OUTPUTS_DIR + ' ===');
  copyDir(srcDir, OUTPUTS_DIR);
}

console.log('\n=== Custom build completed successfully ===');
