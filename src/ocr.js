import { createWorker, PSM } from 'tesseract.js'
import workerPath from 'tesseract.js/dist/worker.min.js?url'
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'

const metrics = ['播放量', '点赞量', '评论量', '分享量', '收藏量', '弹幕量', '完播率', '跳出率']
export const columns = ['标题', '发布时间', ...metrics, '作品状态']

function crop(image, [x, y, width, height], threshold = 175, padding = 16) {
  x = Math.max(0, Math.floor(x))
  y = Math.max(0, Math.floor(y))
  width = Math.min(image.width - x, Math.ceil(width))
  height = Math.min(image.height - y, Math.ceil(height))
  const canvas = document.createElement('canvas')
  canvas.width = width + padding * 2
  canvas.height = height + padding * 2
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, x, y, width, height, padding, padding, width, height)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const shade = pixels.data[offset] < threshold ? 0 : 255
    pixels.data.fill(shade, offset, offset + 3)
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

function trimWhitespace(canvas) {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] !== 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right >= left ? crop(canvas, [left, top, right - left + 1, bottom - top + 1]) : canvas
}

function prepareScan(canvas) {
  const context = canvas.getContext('2d')
  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height)
  let dark = 0
  let samples = 0
  for (let y = 0; y < height; y += 24) {
    for (let x = 0; x < width; x += 24) {
      const offset = (y * width + x) * 4
      if (Math.max(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]) < 80) dark++
      samples++
    }
  }
  if (dark < samples * 0.6) return canvas

  const scan = document.createElement('canvas')
  scan.width = width
  scan.height = height
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const luminance = pixels.data[offset] * 0.2126 + pixels.data[offset + 1] * 0.7152 + pixels.data[offset + 2] * 0.0722
    const shade = Math.max(0, Math.min(255, (185 - luminance) * 1.85))
    pixels.data.fill(shade, offset, offset + 3)
  }
  scan.getContext('2d').putImageData(pixels, 0, 0)
  return scan
}

async function readCount(worker, image, region, canvas) {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
  const spans = []
  let previous = null
  for (let x = 0; x < width; x++) {
    let top = height
    let bottom = 0
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * 4] !== 0) continue
      top = Math.min(top, y)
      bottom = y
    }
    if (top === height) continue
    if (!previous || x - previous.end > 1) {
      previous = { start: x, end: x, top, bottom }
      spans.push(previous)
    } else {
      previous.end = x
      previous.top = Math.min(previous.top, top)
      previous.bottom = Math.max(previous.bottom, bottom)
    }
  }
  const last = spans.at(-1)
  const maxHeight = Math.max(0, ...spans.map(span => span.bottom - span.top))
  if (spans.length > 1 && last.bottom - last.top < maxHeight * 0.84 && last.end - last.start > maxHeight * 0.45) {
    const [x, y, , regionHeight] = region
    const split = last.start - 16
    const suffix = crop(image, [x + split, y, last.end - last.start + 2, regionHeight])
    await worker.setParameters({ tessedit_char_whitelist: '万亿' })
    try {
      const { data } = await worker.recognize(suffix)
      const unit = data.text.match(/[万亿]/)?.[0]
      if (unit) {
        await worker.setParameters({ tessedit_char_whitelist: '0123456789.' })
        const digits = await worker.recognize(crop(image, [x, y, split, regionHeight]))
        let value = digits.data.text.trim()
        const numeral = spans.slice(0, -1)
        const dot = numeral.findIndex(span => span.bottom - span.top < maxHeight * 0.3 &&
          span.end - span.start < maxHeight * 0.3 && span.top > last.top)
        if (/^\d+$/.test(value) && dot > 0 && dot < value.length && numeral.length === value.length + 1) {
          value = value.slice(0, dot) + '.' + value.slice(dot)
        }
        return value + unit
      }
    } finally {
      await worker.setParameters({ tessedit_char_whitelist: '' })
    }
  }
  return (await worker.recognize(canvas)).data.text
}

function parseLines(tsv, offsetX = 0, offsetY = 0) {
  const lines = new Map()
  for (const entry of tsv.split('\n')) {
    const [level, page, block, paragraph, line, , x, y, width, height, , text] = entry.split('\t')
    if (level !== '5' || !text?.trim()) continue
    const key = [page, block, paragraph, line].join('/')
    if (!lines.has(key)) lines.set(key, [])
    lines.get(key).push({ x: Number(x) + offsetX, y: Number(y) + offsetY, width: Number(width), height: Number(height), text })
  }
  return [...lines.values()].map(words => {
    words.sort((a, b) => a.x - b.x)
    const heights = words.map(word => word.height).sort((a, b) => a - b)
    const height = heights[Math.floor(heights.length / 2)]
    const centers = words.map(word => word.y + word.height / 2).sort((a, b) => a - b)
    return {
      words,
      left: Math.min(...words.map(word => word.x)),
      center: centers[Math.floor(centers.length / 2)],
      height,
      text: words.map(word => word.text).join(' ').normalize('NFKC'),
    }
  }).sort((a, b) => a.center - b.center || a.left - b.left)
}

async function scanSections(worker, image) {
  const horizontal = image.width > image.height
  const length = horizontal ? image.width : image.height
  const cross = horizontal ? image.height : image.width
  const span = Math.max(Math.ceil(length / 5), Math.min(1600, cross * 2))
  if (span >= length) return []
  const lines = []
  for (let start = 0; start < length;) {
    const size = Math.min(span, length - start)
    const x = horizontal ? start : 0
    const y = horizontal ? 0 : start
    const section = document.createElement('canvas')
    section.width = horizontal ? size : cross
    section.height = horizontal ? cross : size
    section.getContext('2d').drawImage(image, x, y, section.width, section.height, 0, 0, section.width, section.height)
    const { data } = await worker.recognize(section, {}, { tsv: true })
    lines.push(...parseLines(data.tsv, x, y))
    if (start + size === length) break
    start += Math.floor(span * 0.8)
  }
  return lines
}

function findLabels(lines) {
  const patterns = [/^[播擎撒]放量?$/, /^点赞量?$/, /^评论[量垂]?$/, /^分[享京]量?$/,
    /^收藏[量春]?$/, /^弹[幕蔡蔚]量?$/, /^完[播擎振][率幸]$/, /^(?:2[s5秒])?[跳跟珥]出[率根玄]$/i]
  const labels = patterns.map(pattern => lines.find(line => pattern.test(line.text.replace(/\s/g, ''))))
  const located = labels.filter(Boolean)
  const compactOrder = [0, 1, 2, 3, 4, 6, 7]
  for (const anchor of located) {
    const row = compactOrder.flatMap((metric, slot) => {
      const label = labels[metric]
      return label && Math.abs(label.center - anchor.center) < anchor.height ? [{ label, slot }] : []
    })
    if (row.length < 4) continue
    const first = row[0]
    const last = row.at(-1)
    const spacing = (last.label.left - first.label.left) / (last.slot - first.slot)
    const leftAt = slot => first.label.left + spacing * (slot - first.slot)
    if (spacing < anchor.height * 2 || row.some(({ label, slot }) => Math.abs(label.left - leftAt(slot)) > spacing * 0.12)) {
      return labels
    }
    return labels.map((label, metric) => {
      const slot = compactOrder.indexOf(metric)
      if (label || slot < 0) return label
      const left = leftAt(slot)
      const valueBelow = lines.some(line => Math.abs(line.left - left) < anchor.height &&
        line.center > anchor.center && line.center - anchor.center < anchor.height * 3 &&
        /^\d+(?:\.\d+)?\s*[%万亿]?$/.test(line.text))
      return valueBelow ? { ...anchor, left } : undefined
    })
  }
  // Recover a missing label when the other cards identify both its row and column.
  return labels.map((label, index) => {
    if (label) return label
    const row = labels.slice(Math.floor(index / 3) * 3, Math.floor(index / 3) * 3 + 3).find(Boolean)
    const column = labels.find((item, position) => item && position % 3 === index % 3)
    return row && column ? { ...row, left: column.left } : undefined
  })
}

async function readLayout(worker, original, onProgress) {
  const image = prepareScan(original)
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
  const { data } = await worker.recognize(image, {}, { tsv: true })
  const originalLines = parseLines(data.tsv)
  let lines = originalLines
  let labels = findLabels(lines)
  if (labels.filter(Boolean).length < 6) {
    const sections = await scanSections(worker, image)
    lines = [...lines, ...sections].sort((a, b) => a.center - b.center || a.left - b.left)
    const sectionLabels = findLabels(lines)
    if (sectionLabels.filter(Boolean).length > labels.filter(Boolean).length) labels = sectionLabels
  }
  for (const threshold of [215, 230, 190]) {
    if (labels.filter(Boolean).length >= 7 && lines.some(line => clean(line.text, 1))) break
    const enhanced = crop(image, [0, 0, image.width, image.height], threshold, 0)
    const retry = await worker.recognize(enhanced, {}, { tsv: true })
    const retryLines = parseLines(retry.data.tsv)
    const retryLabels = findLabels(retryLines)
    if (retryLabels.filter(Boolean).length > labels.filter(Boolean).length) {
      labels = retryLabels
    }
    lines = [...lines, ...retryLines].sort((a, b) => a.center - b.center)
  }
  const horizontal = labels.filter(Boolean).length >= 4 &&
    Math.max(...labels.filter(Boolean).map(label => label.center)) -
    Math.min(...labels.filter(Boolean).map(label => label.center)) < Math.max(...labels.filter(Boolean).map(label => label.height))
  const firstMetric = Math.min(...labels.filter(Boolean).map(line => line.center))
  const isDateLine = line => line.center < firstMetric && clean(line.text, 1)
  const dateLine = originalLines.find(isDateLine) ?? lines.find(isDateLine)
  const statusText = lines.filter(line => line.center < firstMetric && (!dateLine || line.center > dateLine.center))
    .map(line => line.text.replace(/\s/g, '')).join('\n')
  const limited = /作品(?:状态)?限流|流量减少|限制(?:流量|推荐)|不予推荐/.test(statusText)
  let normal = /作品状态[:：]?正常/.test(statusText)

  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
  if (!normal) {
    const candidate = lines.find(line => line.center < firstMetric &&
      (!dateLine || line.center > dateLine.center) && /作.{0,2}状.{0,2}正/.test(line.text.replace(/\s/g, '')))
    if (candidate) {
      const right = Math.max(...candidate.words.map(word => word.x + word.width))
      const region = [candidate.left - 3, candidate.center - candidate.height, right - candidate.left + candidate.height, candidate.height * 2]
      const text = (await worker.recognize(crop(image, region))).data.text.replace(/\s/g, '')
      normal = /作品状态[:：]?正常/.test(text)
      if (!normal) {
        const iconWidth = Math.ceil(candidate.height * 1.4)
        const top = Math.max(0, Math.floor(candidate.center - candidate.height / 2))
        const pixels = original.getContext('2d').getImageData(candidate.left, top, iconWidth, candidate.height).data
        let green = 0
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 1] - pixels[offset] > 45 && pixels[offset + 1] - pixels[offset + 2] > 25) green++
        }
        normal = green > iconWidth * candidate.height * 0.08
      }
    }
  }
  const status = limited === normal ? '未知' : limited ? '限流' : '正常'
  let title = ''
  onProgress(1)
  if (dateLine) {
    const dateWord = dateLine.words.find(word => /^\d{4}/.test(word.text)) ?? dateLine.words[0]
    const x = Math.max(0, dateWord.x - dateWord.height * 0.3)
    const isTitleLine = line => line.center < dateLine.center - dateWord.height &&
      dateLine.center - line.center < dateWord.height * 4 &&
      line.words.some(word => word.x >= x && word.height < dateWord.height * 2.8)
    const nearest = originalLines.findLast(isTitleLine) ?? lines.findLast(isTitleLine)
    if (nearest) {
      const y = nearest.center - nearest.height * 0.65
      const bottom = Math.min(dateWord.y - dateWord.height * 0.15, nearest.center + nearest.height * 0.8)
      title = horizontal ? clean(nearest.words.filter(word => word.x >= x).map(word => word.text).join(' '), 0)
        : clean((await worker.recognize(crop(image, [x, y, image.width - x, bottom - y]))).data.text, 0)
    }
  }
  const results = [title, dateLine ? clean(dateLine.text, 1) : '']
  for (const [index, label] of labels.entries()) {
    onProgress(index + 3)
    if (!label) {
      results.push('')
      continue
    }
    const height = Math.min(label.height, ...label.words.filter(word => word.height >= label.height * 0.45).map(word => word.height))
    const x = Math.max(0, Math.floor(label.left - height * 0.35))
    const y = label.center + height * 0.58
    const neighbor = labels.filter(other => other && other.left > label.left &&
      Math.abs(other.center - label.center) < height).sort((a, b) => a.left - b.left)[0]
    const right = neighbor ? neighbor.left - height * 0.45 : image.width
    const region = [x, Math.floor(y), Math.min(right - x, height * 8), height * 3.4]
    const canvas = crop(image, region)
    const text = index < 6 ? await readCount(worker, image, region, canvas) : (await worker.recognize(canvas)).data.text
    const nearby = lines.find(line => line.center > y && line.center < y + height * 3 &&
      Math.abs(line.left - label.left) < height * 0.55 && /^\d+(?:\.\d+)?\s*[%万亿]?$/.test(line.text))
    const fallback = nearby ? clean(nearby.text, index + 2) : ''
    let result = /[万亿]$/.test(fallback) ? fallback : clean(text, index + 2) || fallback
    if (!result && index < 6) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.RAW_LINE, tessedit_char_whitelist: '0123456789.,万亿' })
      try {
        result = clean((await worker.recognize(trimWhitespace(canvas))).data.text, index + 2)
      } finally {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '' })
      }
    }
    results.push(result)
  }
  onProgress(columns.length)
  return [...results, status]
}

function clean(text, index) {
  const value = text.normalize('NFKC').trim()
  if (index === 0) {
    return value.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han}|[!?,])/gu, '')
      .replace(/#\s+/g, '#')
      .replace(/(#\p{Script=Han}+)\s+(?=[a-z])/giu, '$1')
  }
  if (index === 1) {
    const date = value.match(/(\d{4})\s*[-–—./年][\s~]*(\d{1,2})\s*[-–—./月][\s~]*(\d{1,2})\s*日?\s*(\d{1,2})\s*:\s*(\d{2})(?!\d|\s*:)/)
    if (!date) return ''
    const [, year, month, day, hour, minute] = date.map(item => item.padStart(2, '0'))
    return `${year}-${month}-${day} ${hour}:${minute}`
  }
  const number = value.replace(/[\s,]/g, '').match(/\d+(?:\.\d+)?(?:万|亿|%)?/)
  if (!number) return ''
  if (index >= 8) {
    const percentage = value.replace(/\s/g, '').match(/^(\d+(?:\.\d{1,2})?)(?:%|[xX])?$/)
    return percentage && Number(percentage[1]) <= 100 ? percentage[1] + '%' : ''
  }
  return /^\d+$|^\d+(?:\.\d+)?[万亿]$/.test(number[0]) ? number[0] : ''
}

async function downloadModel(url, onLoad) {
  const cache = await globalThis.caches?.open('matrix-ocr-model-v1').catch(() => null)
  const cached = await cache?.match(url).catch(() => null)
  if (cached) {
    onLoad(0.65, '正在读取已缓存的中文模型')
    return cached.blob()
  }
  const controller = new AbortController()
  let timeout
  const resetTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => controller.abort(), 45000)
  }
  const mb = bytes => (bytes / 1000000).toFixed(1)
  resetTimeout()
  try {
    onLoad(0, '正在下载中文模型 · 0.0 MB', true)
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error('OCR 模型下载失败')
    const total = Number(response.headers.get('content-length'))
    const reader = response.body?.getReader()
    const chunks = []
    let loaded = 0
    let lastUpdate = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        resetTimeout()
        chunks.push(value)
        loaded += value.byteLength
        if (performance.now() - lastUpdate < 100) continue
        lastUpdate = performance.now()
        onLoad(total > 0 ? Math.min(0.65, loaded / total * 0.65) : 0,
          `正在下载中文模型 · ${mb(loaded)}${total > 0 ? ` / ${mb(total)}` : ''} MB`, !total)
      }
    } else {
      const bytes = await response.arrayBuffer()
      chunks.push(bytes)
      loaded = bytes.byteLength
    }
    const blob = new Blob(chunks, { type: 'application/gzip' })
    onLoad(0.65, `中文模型下载完成 · ${mb(loaded)} MB`)
    cache?.put(url, new Response(blob)).catch(() => {})
    return blob
  } finally {
    clearTimeout(timeout)
  }
}

export async function createRecognizer(onLoad = () => {}) {
  const langPath = new URL(`${import.meta.env.BASE_URL}ocr-models/`, location.href).href
  const modelUrl = new URL('chi_sim.traineddata.gz', langPath).href
  const modelFile = URL.createObjectURL(await downloadModel(modelUrl, onLoad))
  // Let Tesseract load the bytes already downloaded by the progress-aware request.
  const workerScript = URL.createObjectURL(new Blob([`
    const nativeFetch = self.fetch.bind(self);
    self.fetch = (url, options) => nativeFetch(url === ${JSON.stringify(modelUrl)} ? ${JSON.stringify(modelFile)} : url, options);
    importScripts(${JSON.stringify(new URL(workerPath, location.href).href)});
  `], { type: 'text/javascript' }))
  const stages = {
    'loading tesseract core': [0.65, 0.10, '加载识别引擎'],
    'initializing tesseract': [0.75, 0.05, '初始化识别引擎'],
    'loading language traineddata': [0.80, 0.08, '解压中文模型'],
    'initializing api': [0.88, 0.11, '初始化中文模型'],
  }
  let rejectLoad
  const loadError = new Promise((_, reject) => { rejectLoad = reject })
  let worker
  try {
    worker = await Promise.race([loadError, createWorker('chi_sim', 1, {
      workerPath: workerScript, workerBlobURL: false, corePath, langPath, cacheMethod: 'none',
      logger: ({ status, progress }) => {
        const stage = stages[status]
        if (stage) onLoad(stage[0] + stage[1] * (progress || 0), stage[2])
      },
      errorHandler: rejectLoad,
    })])
  } finally {
    URL.revokeObjectURL(workerScript)
    URL.revokeObjectURL(modelFile)
  }
  async function recognize(url, onProgress, { quick = false } = {}) {
    const image = new Image()
    image.src = url
    await image.decode()
    const { naturalWidth: width, naturalHeight: height } = image
    // Wide desktop captures can have small text even when the overall image is large.
    const targetWidth = width > height ? 3400 : 1800
    const limit = Math.sqrt(12_000_000 / (width * height))
    const scales = [targetWidth / width, 3, 2, 1.5].map(scale => Math.min(4.5, scale, limit))
    let best
    const observed = []
    const score = row => row.filter(value => value && value !== '未知').length
    for (const [attempt, scale] of [...new Set(scales)].entries()) {
      onProgress(0, attempt > 0)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const result = await readLayout(worker, canvas, count => onProgress(count, attempt > 0))
      // A lost decimal point or magnitude suffix can make plays smaller than likes.
      if (/^\d+$/.test(result[2]) && /^\d+$/.test(result[3]) && Number(result[2]) < Number(result[3])) {
        result[2] = ''
      }
      observed.push(result)
      if (!best || score(result) > score(best)) best = result
      if (best.slice(0, -1).every(Boolean)) break
      if (quick && best[1] && best.slice(2, -1).filter(Boolean).length >= 7) break
    }
    return best.map((value, index) => {
      if (value && value !== '未知') return value
      const candidates = new Set(observed.map(row => row[index]).filter(item => item && item !== '未知'))
      return candidates.size === 1 ? [...candidates][0] : value
    })
  }
  return { recognize, close: () => worker.terminate() }
}
