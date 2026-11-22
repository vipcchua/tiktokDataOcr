export async function prepareScreenshot(url) {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight))
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const prepared = { width: canvas.width, height: canvas.height, base64: canvas.toDataURL('image/jpeg', 0.82) }
  const previewScale = Math.min(1, 210 / Math.max(canvas.width, canvas.height))
  const preview = document.createElement('canvas')
  preview.width = Math.max(1, Math.round(canvas.width * previewScale))
  preview.height = Math.max(1, Math.round(canvas.height * previewScale))
  preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height)
  return { ...prepared, preview: preview.toDataURL('image/jpeg', 0.8) }
}
