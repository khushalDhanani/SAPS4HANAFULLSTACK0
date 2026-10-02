const fs = require('fs');
const path = require('path');

describe('Repository Guard: No forbidden queue prefix references', () => {
  const ROOT_DIR = path.resolve(__dirname, '../../..');

  // Dynamically constructed so this test file never matches the forbidden literal
  const FORBIDDEN_TERM = ['GI', 'QUEUE'].join('-');
  const FORBIDDEN_REGEX = new RegExp(FORBIDDEN_TERM, 'i');

  const TARGET_SCAN_AREAS = [
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

  function collectFiles(dirPath, fileList = []) {
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
        collectFiles(fullPath, fileList);
      } else if (entry.isFile() && isTextFile(fullPath)) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  it('scans source, tests, docs, gen/ and the UI5 dist and asserts 0 occurrences of forbidden queue prefix', () => {
    const selfPath = path.resolve(__filename);
    const findings = [];
    let totalFilesScanned = 0;

    for (const area of TARGET_SCAN_AREAS) {
      const areaFullPath = path.join(ROOT_DIR, area.path);
      if (!fs.existsSync(areaFullPath)) {
        if (area.required) {
          throw new Error(`Required target scan area does not exist: ${area.path}`);
        }
        continue;
      }

      const files = collectFiles(areaFullPath);
      if (area.required && files.length === 0) {
        throw new Error(`No scannable text files found in required area: ${area.path}`);
      }

      for (const filePath of files) {
        if (path.resolve(filePath) === selfPath) {
          continue; // Ignore guard test file itself
        }

        totalFilesScanned++;
        const content = fs.readFileSync(filePath, 'utf8');
        if (FORBIDDEN_REGEX.test(content)) {
          const lines = content.split(/\r?\n/);
          lines.forEach((line, idx) => {
            if (FORBIDDEN_REGEX.test(line)) {
              findings.push({
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

    // Ensure our scanner actually visited files across the repo
    expect(totalFilesScanned).toBeGreaterThan(50);

    if (findings.length > 0) {
      const errorReport = findings
        .map(f => `  - [${f.area}] ${f.file}:${f.line} -> "${f.snippet}"`)
        .join('\n');
      fail(new Error(`Found ${findings.length} forbidden "${FORBIDDEN_TERM}" reference(s):\n${errorReport}`));
    }

    expect(findings).toEqual([]);
  });
});
