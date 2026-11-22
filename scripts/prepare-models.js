import { copyFile, mkdir } from 'node:fs/promises'

const destination = new URL('../public/ocr-models/', import.meta.url)
await mkdir(destination, { recursive: true })
const filename = 'chi_sim.traineddata.gz'
const source = new URL(`../node_modules/@tesseract.js-data/chi_sim/4.0.0/${filename}`, import.meta.url)
await copyFile(source, new URL(filename, destination))
