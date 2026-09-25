// Copies the ZXing WebAssembly decoder used by the barcode scanner into /public/vendor,
// so the scanner works on browsers without a native BarcodeDetector and without a CDN.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const fromApp = createRequire(import.meta.url)
const fromDetector = createRequire(fromApp.resolve('barcode-detector'))
// .../zxing-wasm/dist/cjs/reader/index.js -> .../zxing-wasm/dist/reader/zxing_reader.wasm
const source = join(dirname(fromDetector.resolve('zxing-wasm/reader')), '../../reader/zxing_reader.wasm')
const target = join(import.meta.dirname, '../public/vendor/zxing_reader.wasm')

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log('[scanner] ZXing decoder ready at public/vendor/zxing_reader.wasm')
