export const formats = {
  pdf: { label: 'PDF', mime: 'application/pdf' },
  jpeg: { label: 'JPEG', mime: 'image/jpeg' },
  png: { label: 'PNG', mime: 'image/png' },
  webp: { label: 'WebP', mime: 'image/webp' },
};

const pdfAssets = new URL('./vendor/pdfjs/', import.meta.url);
const maxPdfPages = 50;

export class ConversionError extends Error {}

function canvasFor(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function imageBlob(canvas, format) {
  const { mime } = formats[format];
  const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.92));

  if (blob?.type !== mime) {
    throw new ConversionError(`Ce navigateur ne peut pas créer de fichier ${formats[format].label}.`);
  }

  return blob;
}

async function assertFileFormat(file, format) {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const header = new TextDecoder().decode(bytes);
  const isExpected = {
    pdf: header.includes('%PDF-'),
    jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    png: [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte),
    webp: header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP',
  };

  if (!isExpected[format]) {
    throw new ConversionError('Le contenu du fichier ne correspond pas à son extension.');
  }
}

async function convertImage(file, format) {
  const bitmap = await createImageBitmap(file);
  let canvas;

  try {
    if (bitmap.width * bitmap.height > 32_000_000 || Math.max(bitmap.width, bitmap.height) > 8192) {
      throw new ConversionError('L’image dépasse 32 mégapixels ou 8 192 pixels sur un côté.');
    }

    canvas = canvasFor(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');

    if (format === 'jpeg') {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(bitmap, 0, 0);

    if (format !== 'pdf') return await imageBlob(canvas, format);

    await import('./vendor/jspdf/jspdf.umd.min.js');
    const png = await imageBlob(canvas, 'png');
    const width = canvas.width * 0.75;
    const height = canvas.height * 0.75;
    const pdf = new globalThis.jspdf.jsPDF({
      orientation: width > height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [width, height],
      compress: true,
    });

    pdf.addImage(new Uint8Array(await png.arrayBuffer()), 'PNG', 0, 0, width, height);
    return pdf.output('blob');
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

async function convertPdf(file, format, onProgress) {
  const { AnnotationMode, GlobalWorkerOptions, getDocument } = await import('./vendor/pdfjs/pdf.min.mjs');
  GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', pdfAssets).href;

  const task = getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: new URL('cmaps/', pdfAssets).href,
    standardFontDataUrl: new URL('standard_fonts/', pdfAssets).href,
    iccUrl: new URL('iccs/', pdfAssets).href,
    wasmUrl: new URL('wasm/', pdfAssets).href,
    maxImageSize: 32_000_000,
    enableXfa: true,
    stopAtErrors: true,
  });

  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPdfPages) {
      throw new ConversionError(`Un PDF peut contenir jusqu’à ${maxPdfPages} pages pour l’export en images.`);
    }

    const results = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      onProgress(`Conversion de la page ${number} sur ${pdf.numPages}…`);
      const page = await pdf.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 3000 / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });
      const canvas = canvasFor(Math.ceil(viewport.width), Math.ceil(viewport.height));

      try {
        await page.render({
          canvas,
          viewport,
          annotationMode: AnnotationMode.ENABLE,
          background: '#ffffff',
        }).promise;
        results.push(await imageBlob(canvas, format));
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }

    return results;
  } catch (error) {
    if (error.name === 'PasswordException') {
      throw new ConversionError('Ce PDF est protégé par un mot de passe.');
    }
    throw error;
  } finally {
    await task.destroy();
  }
}

export async function convertFile(file, source, target, onProgress) {
  await assertFileFormat(file, source);
  if (source === target) return [file];
  if (source === 'pdf') return convertPdf(file, target, onProgress);
  return [await convertImage(file, target)];
}
