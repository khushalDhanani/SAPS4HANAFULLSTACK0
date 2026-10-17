const fs = require('fs');
const path = require('path');

describe('Repository Guard: No forbidden queue prefix or legacy artifacts', () => {
  const ROOT_DIR = path.resolve(__dirname, '../../..');

  // Dynamically constructed so this test file never matches the forbidden literals
  const FORBIDDEN_PATTERNS = [
    { label: 'GI-QUEUE', regex: new RegExp(['GI', 'QUEUE'].join('-'), 'i') },
    { label: 'ZAPI_MATERIAL_DOCUM', regex: new RegExp(['ZAPI', 'MATERIAL', 'DOCUM'].join('_'), 'i') },
    { label: 'randSuffix', regex: new RegExp(['rand', 'Suffix'].join(''), '') }
  ];

  const TARGET_SCAN_AREAS = [
    { name: 'repo root (root files & WORKSTATUS.md)', path: '.', shallow: true, required: true },
    { name: 'source (srv)', path: 'srv', required: true },
    { name: 'source (app webapp)', path: 'app/fiori-app/webapp', required: true },
    { name: 'source (db)', path: 'db', required: true },
    { name: 'source (tools)', path: 'tools', required: true },
    { name: 'tests (test)', path: 'test', required: true },
    { name: 'docs (docs)', path: 'docs', required: true },
    { name: 'build output (gen)', path: 'gen', required: false },
    { name: 'UI5 dist (app/fiori-app/dist)', path: 'app/fiori-app/dist', required: false }
  ];

  const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.cds-services',
    '.cache',
    'coverage'
  ]);

  // Gitignored, regenerable raw dumps of SAP data (tools/refresh-catalog.sh). They echo SAP's own
  // Gateway technical service names (this system prefixes registered standard APIs with Z), which is
  // SAP state, not a repo artifact. Only repo-authored files are guarded.
  const IGNORED_FILES = new Set([
    'srv/external/all_catalog_services.json'
  ]);

  // A repo-relative path (forward-slash) is ignored when it is a known raw SAP dump, or when it is the
  // regenerated copy of such a dump that `cds build` writes under gen/**/external/** - that copy echoes
  // SAP's own Z-prefixed Gateway service names (SAP state), not a repo-authored artifact. Other gen/
  // files are still guarded.
  const isIgnoredRelPath = (relPath) => {
    const norm = relPath.split(path.sep).join('/');
    if (IGNORED_FILES.has(norm)) return true;
    if (/^gen\/(.*\/)?external\//.test(norm)) return true;
    return false;
  };

  const TEXT_FILE_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.ts',
    '.cds', '.json', '.xml', '.properties',
    '.html', '.css', '.md', '.txt',
    '.sql', '.yaml', '.yml', '.sh'
  ]);

  function isTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return TEXT_FILE_EXTENSIONS.has(ext);
  }

  function collectFiles(dirPath, fileList = [], shallow = false) {
    if (!fs.existsSync(dirPath)) {
      return fileList;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') {
        continue;
      }
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!shallow) {
          collectFiles(fullPath, fileList, false);
        }
      } else if (entry.isFile() && isTextFile(fullPath)) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  it('scans repo root, WORKSTATUS.md, source, tests, docs, gen/ and the UI5 dist and asserts 0 occurrences of forbidden patterns (GI-QUEUE, ZAPI_MATERIAL_DOCUM, randSuffix)', () => {
    const selfPath = path.resolve(__filename);
    const findings = [];
    let totalFilesScanned = 0;
    const scannedRelativePaths = new Set();

    for (const area of TARGET_SCAN_AREAS) {
      const areaFullPath = path.join(ROOT_DIR, area.path);
      if (!fs.existsSync(areaFullPath)) {
        if (area.required) {
          throw new Error(`Required target scan area does not exist: ${area.path}`);
        }
        continue;
      }

      const files = collectFiles(areaFullPath, [], Boolean(area.shallow));
      if (area.required && files.length === 0) {
        throw new Error(`No scannable text files found in required area: ${area.path}`);
      }

      for (const filePath of files) {
        if (path.resolve(filePath) === selfPath) {
          continue; // Ignore guard test file itself
        }

        const relPath = path.relative(ROOT_DIR, filePath);
        if (isIgnoredRelPath(relPath)) {
          continue;
        }
        scannedRelativePaths.add(relPath);
        totalFilesScanned++;
        const content = fs.readFileSync(filePath, 'utf8');
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.regex.test(content)) {
            const lines = content.split(/\r?\n/);
            lines.forEach((line, idx) => {
              if (pattern.regex.test(line)) {
                findings.push({
                  pattern: pattern.label,
                  area: area.name,
                  file: path.relative(ROOT_DIR, filePath),
                  line: idx + 1,
                  snippet: line.trim()
                });
              }
            });
          }
        }
      }
    }

    // Ensure our scanner actually visited files across the repo including root files
    expect(totalFilesScanned).toBeGreaterThan(50);
    expect(scannedRelativePaths.has('WORKSTATUS.md')).toBe(true);
    expect(scannedRelativePaths.has('README.md')).toBe(true);

    if (findings.length > 0) {
      const errorReport = findings
        .map(f => `  - [${f.pattern}] [${f.area}] ${f.file}:${f.line} -> "${f.snippet}"`)
        .join('\n');
      throw new Error(`Found ${findings.length} forbidden reference(s):\n${errorReport}`);
    }

    expect(findings).toEqual([]);
  });

  it('ignores the regenerated SAP catalog dump under gen/**/external/** but still guards other files', () => {
    // excluded: the source dump and its gen/ copies (any depth) under an external/ folder
    expect(isIgnoredRelPath('srv/external/all_catalog_services.json')).toBe(true);
    expect(isIgnoredRelPath('gen/srv/srv/external/all_catalog_services.json')).toBe(true);
    expect(isIgnoredRelPath('gen/external/all_catalog_services.json')).toBe(true);
    expect(isIgnoredRelPath('gen/a/b/external/x.json')).toBe(true);
    // still guarded: other gen/ files and all real source
    expect(isIgnoredRelPath('gen/srv/srv/service.js')).toBe(false);
    expect(isIgnoredRelPath('srv/wm/mvt261/service.js')).toBe(false);
    expect(isIgnoredRelPath('srv/external/other.json')).toBe(false);
  });
});
