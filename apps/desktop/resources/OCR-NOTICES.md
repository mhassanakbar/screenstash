# Offline English OCR third-party notices

ScreenStash ships Tesseract.js 6.0.1 and Tesseract.js-core 6.0.0
(Apache-2.0), including its compiled Tesseract/Leptonica engine, together with
English LSTM integer trained data from @tesseract.js-data/eng 1.0.0
(4.0.0_best_int/eng.traineddata.gz). The data package declares MIT;
the underlying Tesseract English model is distributed under Apache-2.0.
The Apache license is included at node_modules/tesseract.js/LICENSE.md and
node_modules/tesseract.js-core/LICENSE in this resource directory.

Runtime support code includes bmp-js 0.1.0 (MIT, LICENSE), is-url 1.2.4
(MIT, LICENSE-MIT), and regenerator-runtime 0.13.11 (MIT, LICENSE).
Each original license is included in the corresponding node_modules directory.

The WASM engine's native dependencies also retain their original license texts
in licenses/: Leptonica, giflib, libjpeg, libpng, libtiff, libwebp (including
PATENTS), openlibm and zlib. These were retrieved from the exact submodule
commits recorded by tesseract.js-core v6.0.0, not from unpinned default branches:

- Leptonica: DanBloomberg/leptonica, 4af068b56a9674da915debea4ed7e1b9885b17e8
- giflib: mirrorer/giflib, fa37672085ce4b3d62c51627ab3c8cf2dda8009a
- libjpeg: LuaDist/libjpeg, 6c0fcb8ddee365e7abc4d332662b06900612e923
- libpng: glennrp/libpng, a37d4836519517bdce6cb9d956092321eca3e73b
- libtiff: libsdl-org/libtiff mirror, b51bb157123264e26d34c09cc673d213aea61fc7
- libwebp: webmproject/libwebp, 20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c
- openlibm: JuliaMath/openlibm, ae2d91698508701c83cab83714d42a1146dccf85
- zlib: madler/zlib, 21767c654d31d2dccdde4330529775c6c5fd5389

The language package's original metadata is preserved at lang/package.json.

Upstream projects:

- https://github.com/naptha/tesseract.js
- https://github.com/naptha/tesseract.js-core
- https://github.com/naptha/tessdata
- https://github.com/tesseract-ocr/tessdata_best
- https://github.com/shaozilee/bmp-js
- https://github.com/segmentio/is-url
- https://github.com/facebook/regenerator

Preparation copies only installed, lockfile-pinned packages. It verifies the
fixed SHA-256 checksums of the worker sources, core JavaScript, core WASM, and English model,
then records every shipped file's SHA-256 in manifest.json. No CDN, download,
installation-directory cache, or network fallback is used during recognition.
Tesseract's disk cache is disabled: trained data is read from the bundled
language directory and lives only in the disposable worker's WASM filesystem.
