'use strict'

const form = document.querySelector('#converter')
const button = form.querySelector('button')
const input = document.querySelector('#video-url')
const status = document.querySelector('#status')
const progressPanel = document.querySelector('#progress-panel')
const progress = document.querySelector('#progress')
const progressValue = document.querySelector('#progress-value')
const download = document.querySelector('#download')
const progressType = 'application/vnd.cib.mp3-progress'
let objectUrl

function showProgress(message, percent) {
  if (status.textContent !== message) status.textContent = message
  if (Number.isFinite(percent)) {
    progress.value = percent
    progressValue.textContent = `${percent} %`
  } else {
    progress.removeAttribute('value')
    progressValue.textContent = ''
  }
}

function showStage(event) {
  switch (event.stage) {
    case 'downloading':
      showProgress('Téléchargement de l’audio depuis YouTube…', event.percent)
      break
    case 'converting':
      showProgress('Conversion en MP3…')
      break
    case 'error':
      throw new Error(event.message)
  }
}

async function receiveMp3(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const parts = []
  let line = ''
  let file
  let received = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      let offset = 0
      // Read progress lines until the file event, then collect the raw MP3 bytes.
      while (!file && offset < value.length) {
        const end = value.indexOf(10, offset)
        if (end === -1) {
          line += decoder.decode(value.subarray(offset), { stream: true })
          break
        }
        const event = JSON.parse(line + decoder.decode(value.subarray(offset, end)))
        line = ''
        offset = end + 1
        if (event.stage === 'file') {
          file = event
          progress.setAttribute('aria-label', 'Transfert du fichier MP3')
          showProgress('Réception du fichier MP3…', 0)
        } else {
          showStage(event)
        }
      }

      if (file && offset < value.length) {
        const bytes = value.subarray(offset)
        parts.push(bytes)
        received += bytes.length
        showProgress('Réception du fichier MP3…', Math.floor(received * 100 / file.size))
      }
    }

    if (!file || !received || received !== file.size) {
      throw new Error('Le téléchargement du MP3 a été interrompu. Réessayez.')
    }
    return { blob: new Blob(parts, { type: 'audio/mpeg' }), filename: file.filename }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  button.disabled = true
  input.readOnly = true
  download.hidden = true
  download.removeAttribute('href')
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
  }
  progressPanel.hidden = false
  progress.setAttribute('aria-label', 'Progression du traitement')
  status.dataset.error = 'false'
  showProgress('Préparation de la vidéo…')

  try {
    const response = await fetch('/youtube-mp3/convertir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: progressType },
      body: JSON.stringify({ url: input.value.trim() })
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || 'La conversion a échoué. Réessayez dans un instant.')
    }
    if (!response.headers.get('content-type')?.startsWith(progressType) || !response.body) {
      throw new Error('Le serveur n’a pas renvoyé le téléchargement attendu.')
    }

    const { blob, filename } = await receiveMp3(response.body)
    objectUrl = URL.createObjectURL(blob)
    download.href = objectUrl
    download.download = filename
    download.hidden = false
    showProgress('Votre MP3 est prêt.', 100)
  } catch (error) {
    progressPanel.hidden = true
    status.dataset.error = 'true'
    status.textContent = error instanceof TypeError
      ? 'Connexion au serveur interrompue. Réessayez dans un instant.'
      : error.message
  } finally {
    button.disabled = false
    input.readOnly = false
  }
})
