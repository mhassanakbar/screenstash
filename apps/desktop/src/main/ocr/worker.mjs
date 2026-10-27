import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import worker from './node_modules/tesseract.js/src/worker-script/index.js';
import core from './node_modules/tesseract.js-core/tesseract-core-lstm.js';

const denyNetwork = () => {
  throw new Error('OCR network access is disabled');
};
globalThis.fetch = denyNetwork;
console.log = () => {};
console.warn = () => {};
console.error = () => {};
worker.setAdapter({
  getCore: async () => (options) =>
    core({ ...options, print: () => {}, printErr: () => {} }),
  gunzip: gunzipSync,
  fetch: denyNetwork,
  readCache: readFile,
  writeCache: async () => {},
  deleteCache: async () => {},
  checkCache: async () => false,
});
parentPort.on('message', (packet) => {
  worker.dispatchHandlers(packet, (response) => {
    if (response.status === 'progress') return;
    if (response.status === 'reject') response.data = 'recognition_failed';
    parentPort.postMessage(response);
  });
});
