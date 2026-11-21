import { ConversionError, convertFile, formats } from './conversion.js';

const zone = document.querySelector('#drop-zone');
const browse = document.querySelector('#browse');
const input = document.querySelector('#files');
const queue = document.querySelector('#queue');
const convert = document.querySelector('#convert');
const list = document.querySelector('#file-list');
const notice = document.querySelector('#notice');
const template = document.querySelector('#file-row');
const rows = new Set();
const maxFileSize = 50 * 1024 * 1024;
const sizeFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
let running = false;

function clearResult(row) {
  for (const url of row.urls) URL.revokeObjectURL(url);
  row.urls = [];
  row.downloads.replaceChildren();
  row.status.classList.remove('error');
  row.status.textContent = '';
}

function updateQueue() {
  queue.hidden = rows.size === 0;
  convert.disabled = running || ![...rows].some(row => row.urls.length === 0);
}

function addFiles(files) {
  const errors = [];

  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const source = extension === 'jpg' ? 'jpeg' : extension;

    if (!file.name.includes('.') || !Object.hasOwn(formats, source)) {
      errors.push(`${file.name} · format non pris en charge.`);
      continue;
    }
    if (!file.size || file.size > maxFileSize) {
      errors.push(`${file.name} · ${file.size ? 'taille supérieure à 50 Mo.' : 'fichier vide.'}`);
      continue;
    }

    const element = template.content.firstElementChild.cloneNode(true);
    const format = element.querySelector('.format');
    const remove = element.querySelector('.remove');
    const row = {
      file, source, format, remove,
      status: element.querySelector('.file-status'),
      downloads: element.querySelector('.downloads'),
      urls: [],
    };
    const size = file.size < 1024 * 1024
      ? `${sizeFormat.format(Math.max(0.1, file.size / 1024))} Ko`
      : `${sizeFormat.format(file.size / (1024 * 1024))} Mo`;

    element.querySelector('.file-name').textContent = file.name;
    element.querySelector('.file-meta').textContent = `${formats[source].label} · ${size}`;
    format.setAttribute('aria-label', `Format de sortie pour ${file.name}`);
    remove.setAttribute('aria-label', `Retirer ${file.name}`);

    for (const [value, { label }] of Object.entries(formats)) {
      format.add(new Option(label, value));
    }
    format.value = source === 'pdf' ? 'png' : 'pdf';

    format.addEventListener('change', () => {
      clearResult(row);
      updateQueue();
    });
    remove.addEventListener('click', () => {
      clearResult(row);
      rows.delete(row);
      element.remove();
      updateQueue();
    });

    rows.add(row);
    list.append(element);
  }

  notice.textContent = errors.join('\n');
  updateQueue();
}

function showDownloads(row, outputs) {
  const target = row.format.value;
  const baseName = row.file.name.slice(0, row.file.name.lastIndexOf('.')) || 'fichier';
  const multiPage = outputs.length > 1;
  const digits = String(outputs.length).length;

  outputs.forEach((blob, index) => {
    const page = index + 1;
    const suffix = multiPage ? `-page-${String(page).padStart(digits, '0')}` : '';
    const link = document.createElement('a');
    const downloadName = `${baseName}${suffix}.${target}`;
    link.href = URL.createObjectURL(blob);
    link.download = downloadName;
    link.className = 'button secondary';
    link.textContent = multiPage ? `↓ Page ${page}` : '↓ Télécharger';
    link.setAttribute('aria-label', `Télécharger ${downloadName}`);
    row.urls.push(link.href);
    row.downloads.append(link);
  });

  row.status.textContent = multiPage ? `${outputs.length} pages prêtes` : 'Fichier prêt';
}

browse.addEventListener('click', () => input.click());
input.addEventListener('change', () => {
  addFiles(input.files);
  input.value = '';
});

let dragDepth = 0;
zone.addEventListener('dragenter', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  zone.classList.add('dragging');
});
zone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) zone.classList.remove('dragging');
});
window.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = zone.contains(event.target) ? 'copy' : 'none';
});
window.addEventListener('drop', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth = 0;
  zone.classList.remove('dragging');
  if (zone.contains(event.target)) addFiles(event.dataTransfer.files);
});

convert.addEventListener('click', async () => {
  if (running) return;
  running = true;
  updateQueue();
  const pending = [...rows].filter(row => !row.urls.length);
  const idleLabel = convert.textContent;
  convert.textContent = 'Conversion en cours…';

  for (const row of pending) {
    row.format.disabled = row.remove.disabled = true;
    row.status.classList.remove('error');
    row.status.textContent = 'En attente…';
  }

  try {
    for (const row of pending) {
      row.status.textContent = 'Conversion en cours…';
      try {
        const outputs = await convertFile(row.file, row.source, row.format.value, progress => {
          row.status.textContent = progress;
        });
        showDownloads(row, outputs);
      } catch (error) {
        clearResult(row);
        row.status.classList.add('error');
        row.status.textContent = error instanceof ConversionError
          ? error.message
          : 'Impossible de convertir ce fichier. Vérifiez qu’il s’ouvre correctement.';
      } finally {
        row.format.disabled = row.remove.disabled = false;
      }
    }
  } finally {
    running = false;
    convert.textContent = idleLabel;
    updateQueue();
  }
});
