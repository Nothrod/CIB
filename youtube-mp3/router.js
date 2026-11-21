'use strict'

const express = require('express')
const { spawn } = require('node:child_process')
const { createReadStream } = require('node:fs')
const { mkdtemp, stat, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createInterface } = require('node:readline')
const { pipeline } = require('node:stream/promises')

const router = express.Router()
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])
const maxDuration = 600
const maxConcurrent = 2
const conversionTimeout = 90_000
const progressType = 'application/vnd.cib.mp3-progress'
let active = 0

function canonicalVideoUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null

  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    return null
  }

  let id
  if (url.hostname === 'youtu.be') {
    id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1]
  } else if (youtubeHosts.has(url.hostname)) {
    id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)\/?$/)?.[1]
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
}

function mp3Filename(title) {
  const cleaned = (title || '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ').trim()
  let stem = ''
  let size = 0
  for (const character of cleaned) {
    size += Buffer.byteLength(character)
    if (size > 240) break
    stem += character
  }
  stem = stem.replace(/^[ .]+|[ .]+$/g, '')
  const safeStem = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)
    ? `_${stem}`
    : stem
  return `${safeStem || 'youtube'}.mp3`
}

function convert(url, directory, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.env.YT_DLP_PATH || 'yt-dlp', [
      '--ignore-config', '--no-playlist', '--quiet', '--encoding', 'utf-8',
      '--progress', '--newline', '--progress-delta', '0.5',
      '--progress-template', 'download:CIB_DOWNLOAD %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
      '--progress-template', 'postprocess:CIB_CONVERT',
      '--no-simulate', '--print', 'after_move:CIB_TITLE %(title)j',
      '--js-runtimes', 'node',
      '--socket-timeout', '15', '--retries', '1', '--fragment-retries', '1',
      '--match-filters', `!is_live & duration <= ${maxDuration}`,
      '--max-filesize', '30M',
      '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '160K',
      '-o', join(directory, 'audio.%(ext)s'), '--', url
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    let diagnostics = ''
    let title
    let converting = false
    const stop = () => worker.kill('SIGKILL')
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()

    const readLine = (line) => {
      if (line.startsWith('CIB_TITLE ')) {
        try {
          const value = JSON.parse(line.slice('CIB_TITLE '.length))
          if (typeof value === 'string') title = value
        } catch {
          // A missing title falls back to youtube.mp3.
        }
      } else if (line === 'CIB_CONVERT' && !converting) {
        converting = true
        onProgress({ stage: 'converting' })
      } else if (line.startsWith('CIB_DOWNLOAD ') && !converting) {
        const [downloaded, total] = line.slice('CIB_DOWNLOAD '.length).split(' ').map(Number)
        const percent = Number.isFinite(downloaded) && total > 0
          ? Math.min(100, Math.max(0, Math.floor(downloaded * 100 / total)))
          : null
        onProgress({ stage: 'downloading', percent })
      } else {
        diagnostics = `${diagnostics}\n${line}`.slice(-2400)
      }
    }
    for (const stream of [worker.stdout, worker.stderr]) {
      stream.setEncoding('utf8')
      createInterface({ input: stream, crlfDelay: Infinity }).on('line', readLine)
    }
    let spawnError
    worker.once('error', (error) => { spawnError = error })
    worker.once('close', (code) => {
      signal.removeEventListener('abort', stop)
      if (signal.aborted) return reject(signal.reason)
      if (spawnError) return reject(spawnError)
      if (code !== 0) return reject(new Error(diagnostics || `yt-dlp a quitté avec le code ${code}`))
      resolve(title)
    })
  })
}

router.get('/', (req, res) => res.sendFile(join(__dirname, 'index.html')))
router.get('/style.css', (req, res) => res.sendFile(join(__dirname, 'style.css')))
router.get('/page.js', (req, res) => res.sendFile(join(__dirname, 'page.js')))

router.post('/convertir', express.json({ limit: '4kb' }), async (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  const url = canonicalVideoUrl(req.body?.url)
  if (!url) return res.status(400).json({ message: 'Collez un lien valide vers une vidéo YouTube ou un Short.' })
  if (active >= maxConcurrent) {
    return res.set('Retry-After', '15').status(503).json({
      message: 'Deux conversions sont déjà en cours. Réessayez dans quelques secondes.'
    })
  }

  active += 1
  const controller = new AbortController()
  const disconnect = () => {
    if (!res.writableFinished) controller.abort(new Error('Connexion fermée'))
  }
  res.once('close', disconnect)
  const timeout = setTimeout(() => controller.abort(new Error('Délai dépassé')), conversionTimeout)
  const wantsProgress = req.get('Accept') === progressType
  const sendUpdate = (event) => {
    if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`)
  }
  let sendingFile = false
  const fail = (status, message) => {
    if (wantsProgress && res.headersSent) {
      sendUpdate({ stage: 'error', message })
      return res.end()
    }
    res.removeHeader('Content-Type')
    return res.status(status).json({ message })
  }
  let directory

  try {
    if (wantsProgress) {
      res.set('Content-Type', progressType)
      sendUpdate({ stage: 'preparing' })
    }
    directory = await mkdtemp(join(tmpdir(), 'cib-mp3-'))
    controller.signal.throwIfAborted()
    const title = await convert(url, directory, controller.signal, (event) => {
      if (wantsProgress) sendUpdate(event)
    })
    const file = join(directory, 'audio.mp3')
    const info = await stat(file).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (!info?.size) {
      return fail(422, 'Aucun MP3 généré. Vérifiez que la vidéo est publique et dure 10 minutes maximum.')
    }

    clearTimeout(timeout)
    const filename = mp3Filename(title)
    if (wantsProgress) {
      sendingFile = true
      // JSON progress lines end with the file event. Raw MP3 bytes follow it.
      sendUpdate({ stage: 'file', filename, size: info.size })
      await pipeline(createReadStream(file), res)
      return
    }

    res.type('audio/mpeg')
    await new Promise((resolve, reject) => {
      res.download(file, filename, { acceptRanges: false }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  } catch (error) {
    if (res.destroyed) return
    if (res.headersSent && (!wantsProgress || sendingFile)) return next(error)
    if (controller.signal.aborted) {
      return fail(504, 'La conversion a pris trop de temps. Réessayez avec une vidéo plus courte.')
    }
    console.error('[YouTube MP3]', error.message)
    if (error.code === 'ENOENT') {
      return fail(503, 'Le convertisseur est indisponible sur le serveur.')
    }
    fail(502, 'Impossible de récupérer l’audio de cette vidéo. Essayez un autre lien.')
  } finally {
    clearTimeout(timeout)
    res.off('close', disconnect)
    try {
      if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.error('[YouTube MP3] Suppression du dossier temporaire', error.message)
    } finally {
      active -= 1
    }
  }
})

router.use((error, req, res, next) => {
  if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed') {
    return res.status(error.status).json({ message: 'Le lien envoyé est trop long ou illisible.' })
  }
  next(error)
})

module.exports = router
