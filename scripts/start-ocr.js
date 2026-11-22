import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'vite'

const host = '127.0.0.1'
const port = 8087
const url = `http://${host}:${port}/`

async function openPage() {
  console.log(`Open ${url} in your browser.`)
  const browser = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true })
  if ((await once(browser, 'exit'))[0] !== 0) console.log('Open the URL above manually.')
}

async function alreadyRunning() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok && (await response.text()).includes('name="application-name" content="matrix-ocr"')
  } catch {
    return false
  }
}

if (await alreadyRunning()) {
  await openPage()
} else {
  const server = await createServer({ server: { host, port, strictPort: true } })
  try {
    await server.listen()
  } catch (error) {
    await server.close()
    if (await alreadyRunning()) {
      await openPage()
    } else {
      console.error(error.message)
      console.error('If another program is using port 8087, close it and run start-ocr.bat again.')
      process.exitCode = 1
    }
  }
  if (server.httpServer?.listening) {
    console.log('Keep this window open while using OCR. Press Ctrl+C to stop.')
    await openPage()
  }
}
