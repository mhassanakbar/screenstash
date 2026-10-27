import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');
const require = createRequire(path.join(desktop, 'package.json'));
const destination = path.join(desktop, 'resources', 'ocr');
const packages = [
  ['tesseract.js', '6.0.1', ['src', 'LICENSE.md', 'package.json']],
  [
    'tesseract.js-core',
    '6.0.0',
    [
      'tesseract-core-lstm.js',
      'tesseract-core-lstm.wasm',
      'LICENSE',
      'package.json',
    ],
  ],
  ['bmp-js', '0.1.0', ['index.js', 'lib', 'LICENSE', 'package.json']],
  ['is-url', '1.2.4', ['index.js', 'LICENSE-MIT', 'package.json']],
  ['regenerator-runtime', '0.13.11', ['runtime.js', 'LICENSE', 'package.json']],
];
const pinned = [
  [
    'tesseract.js-core/tesseract-core-lstm.js',
    '48a3ee8e00924cb8c7f0cc0d099b1318fea120af56b3ee8fb3a70dd2311806c2',
  ],
  [
    'tesseract.js-core/tesseract-core-lstm.wasm',
    '220e2e87551edccb85519796a170469f8ab2a8055216789e3b8b1ada18b7bc2b',
  ],
  [
    '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
  ],
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function sourceFingerprint(directory, names) {
  const digest = createHash('sha256');
  async function visit(name) {
    const filename = path.join(directory, name);
    const entries = await readdir(filename).catch((error) => {
      if (error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (entries) {
      for (const entry of entries.sort()) await visit(name + '/' + entry);
    } else {
      digest.update(name + '\0');
      digest.update(await readFile(filename));
    }
  }
  for (const name of [...names].sort()) await visit(name);
  return digest.digest('hex');
}
if (
  (await sourceFingerprint(
    path.dirname(require.resolve('tesseract.js/package.json')),
    ['src', 'LICENSE.md', 'package.json'],
  )) !== '8d42f47ec8a14da44cda9e1fcda8a9a757305dfd5c9e9d3676b24745f35bd267'
)
  throw new Error('OCR worker source checksum mismatch');
for (const [filename, expected] of pinned) {
  if (hash(await readFile(require.resolve(filename))) !== expected)
    throw new Error('OCR resource checksum mismatch: ' + filename);
}
for (const [name, version, files] of packages) {
  const packagePath = require.resolve(name + '/package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  if (manifest.version !== version)
    throw new Error('Unexpected OCR dependency: ' + name);
  const target = path.join(destination, 'node_modules', name);
  await mkdir(target, { recursive: true });
  for (const filename of files)
    await cp(
      path.join(path.dirname(packagePath), filename),
      path.join(target, filename),
      { recursive: true },
    );
}
const dataPackage = JSON.parse(
  await readFile(
    require.resolve('@tesseract.js-data/eng/package.json'),
    'utf8',
  ),
);
if (dataPackage.version !== '1.0.0')
  throw new Error('Unexpected English language package');
await mkdir(path.join(destination, 'lang'), { recursive: true });
await cp(
  require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  path.join(destination, 'lang', 'eng.traineddata.gz'),
);
await cp(
  path.join(desktop, 'src', 'main', 'ocr', 'worker.mjs'),
  path.join(destination, 'worker.mjs'),
);
await unlink(path.join(destination, 'worker.cjs')).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
await cp(
  path.join(desktop, 'resources', 'OCR-NOTICES.md'),
  path.join(destination, 'NOTICES.md'),
);
await cp(
  path.join(desktop, 'resources', 'ocr-licenses'),
  path.join(destination, 'licenses'),
  { recursive: true },
);
await cp(
  require.resolve('@tesseract.js-data/eng/package.json'),
  path.join(destination, 'lang', 'package.json'),
);
const files = {};
async function inventory(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await inventory(filename);
    else if (entry.name !== 'manifest.json')
      files[path.relative(destination, filename).split(path.sep).join('/')] =
        hash(await readFile(filename));
  }
}
await inventory(destination);
await writeFile(
  path.join(destination, 'manifest.json'),
  JSON.stringify(
    {
      language: 'eng',
      packages: Object.fromEntries(
        packages
          .map(([name, version]) => [name, version])
          .concat([['@tesseract.js-data/eng', '1.0.0']]),
      ),
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Prepared offline English OCR resources (' +
    Object.keys(files).length +
    ' files).',
);
