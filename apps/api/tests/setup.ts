import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Test isolation: dedicated data dir + a local fixture project on disk.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectpack-data-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
// The website crawler delays between requests by default — disable for tests.
process.env.WEBSITE_REQUEST_DELAY_MS = '0';
// Keep AI enhancement deterministic in tests (no key configured).
delete process.env.AI_API_KEY;

const fixtureDir = path.join(dataDir, 'fixture-project');
fs.mkdirSync(path.join(fixtureDir, 'session01'), { recursive: true });
fs.mkdirSync(path.join(fixtureDir, 'session02'), { recursive: true });
fs.mkdirSync(path.join(fixtureDir, 'empty'), { recursive: true });
fs.writeFileSync(path.join(fixtureDir, 'session01', 's01.py'), 'def hello():\n    return "alpha hello world"\n');
fs.writeFileSync(path.join(fixtureDir, 'session02', 's02.py'), 'def hello():\n    return "alpha hello world"\n');
fs.writeFileSync(path.join(fixtureDir, 'session02', 'config.json'), '{"name": "sample", "version": 1}');
fs.writeFileSync(path.join(fixtureDir, 'README.md'), '# readme\nmarkdown content here\n');
fs.writeFileSync(
  path.join(fixtureDir, 'session01', 'data.csv'),
  'name,qty\napple,3\nbanana,5\n',
);
fs.writeFileSync(path.join(fixtureDir, 'session01', 'dupe.py'), 'def hello():\n    return "alpha hello world"\n');
fs.writeFileSync(path.join(fixtureDir, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 5, 6, 7, 0, 9]));

// a small zip archive for archive-inspection tests (archiver is an api dependency)
{
  const archiver = (await import('archiver')).default;
  const output = fs.createWriteStream(path.join(fixtureDir, 'bundle.zip'));
  const archive = archiver('zip');
  archive.pipe(output);
  archive.append('alpha zip content one', { name: 'one.txt' });
  archive.append('alpha zip content two', { name: 'sub/two.txt' });
  await archive.finalize();
  await new Promise((resolve) => output.on('close', resolve));
}

export const TEST = { dataDir, fixtureDir };
