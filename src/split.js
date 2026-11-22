export async function splitScreenshot(url) {
  const image = new Image()
  image.src = url
  await image.decode()
  const scale = Math.min(1, 480 / image.naturalWidth)
  const scan = document.createElement('canvas')
  scan.width = Math.max(1, Math.round(image.naturalWidth * scale))
  scan.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = scan.getContext('2d')
  context.drawImage(image, 0, 0, scan.width, scan.height)
  const { data } = context.getImageData(0, 0, scan.width, scan.height)
  const gapSize = Math.max(3, Math.round(scan.width * 0.012))
  const minCard = scan.width * 0.09
  const ranges = []
  let start = 0
  let gap = 0
  for (let y = 0; y <= scan.height; y++) {
    let marks = 0
    for (let x = 0; x < scan.width && y < scan.height; x++) {
      const offset = (y * scan.width + x) * 4
      if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < 224) marks++
    }
    if (marks < scan.width * 0.018) {
      gap++
      if (y < scan.height) continue
    }
    if (gap >= gapSize || y === scan.height) {
      const boundary = y === scan.height && gap < gapSize ? y : y - gap / 2
      if (boundary - start >= minCard) ranges.push([start, boundary])
      start = boundary
    }
    gap = 0
  }
  if (ranges.length < 2) return []
  return Promise.all(ranges.map(async ([top, bottom]) => {
    const canvas = document.createElement('canvas')
    const y = Math.round(top * image.naturalHeight / scan.height)
    canvas.width = image.naturalWidth
    canvas.height = Math.round(bottom * image.naturalHeight / scan.height) - y
    canvas.getContext('2d').drawImage(image, 0, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  }))
}
