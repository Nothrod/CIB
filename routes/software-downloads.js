const express = require('express');

const router = express.Router();
const links = new Map();
const pending = new Map();
const cacheTime = 30 * 60 * 1000;
const retryTime = 60 * 1000;

const libreOfficeIndex = 'https://download.documentfoundation.org/libreoffice/stable/';
const vlcIndex = 'https://download.videolan.org/pub/videolan/vlc/last/win64/';
const versionOrder = new Intl.Collator('en', { numeric: true });

async function getMetadata(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Source de téléchargement : HTTP ${response.status}`);
  return response;
}

function versionLinks(html, pattern) {
  return Array.from(html.matchAll(pattern), match => match[1])
    .sort((left, right) => versionOrder.compare(right, left));
}

async function latestLibreOffice() {
  const index = await getMetadata(libreOfficeIndex);
  const [version] = versionLinks(await index.text(), /href="(\d+\.\d+\.\d+)\/"/g);
  if (!version) return;

  const folder = `${libreOfficeIndex}${version}/win/x86_64/`;
  const file = `LibreOffice_${version}_Win_x86-64.msi`;
  const listing = await getMetadata(folder);
  if ((await listing.text()).includes(`href="${file}"`)) return folder + file;
}

async function latestVlc() {
  const listing = await getMetadata(vlcIndex);
  const [version] = versionLinks(await listing.text(), /href="vlc-(\d+\.\d+\.\d+)-win64\.exe"/g);
  if (version) return `${vlcIndex}vlc-${version}-win64.exe`;
}

function github(repo, installer) {
  const repoUrl = `https://github.com/${repo}`;
  return {
    options: `${repoUrl}/releases`,
    async latest() {
      const response = await getMetadata(`https://api.github.com/repos/${repo}/releases/latest`, {
        Accept: 'application/vnd.github+json',
      });
      const release = await response.json();
      if (release.draft || release.prerelease || typeof release.tag_name !== 'string') return;

      const asset = release.assets.find(({ name }) => installer.test(name));
      if (!asset) return;

      const expectedUrl = `${repoUrl}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`;
      if (asset.browser_download_url === expectedUrl) return expectedUrl;
    },
  };
}

const software = new Map([
  ['fluentcleaner', github('builtbybel/FluentCleaner', /^FluentCleaner-win-x64\.zip$/i)],
  ['libreoffice', {
    options: 'https://fr.libreoffice.org/download/download-libreoffice/',
    latest: latestLibreOffice,
  }],
  ['genoffice', github('genspark-ai/genoffice', /^GenOfficeSetup-v[\d.]+-x64\.exe$/i)],
  ['vlc', {
    options: 'https://www.videolan.org/vlc/index.fr.html',
    latest: latestVlc,
  }],
  ['openshot', github('OpenShot/openshot-qt', /^OpenShot-v[\d.]+-x86_64\.exe$/i)],
  ['peazip', github('peazip/PeaZip', /^peazip-[\d.]+\.WIN64\.exe$/i)],
]);

async function downloadLink(slug, source) {
  const cached = links.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  if (!pending.has(slug)) {
    const lookup = source.latest()
      .catch(error => {
        console.warn(`Téléchargement ${slug} : ${error.message}`);
      })
      .then(url => {
        const destination = url || source.options;
        links.set(slug, { url: destination, expiresAt: Date.now() + (url ? cacheTime : retryTime) });
        return destination;
      })
      .finally(() => pending.delete(slug));
    pending.set(slug, lookup);
  }

  return pending.get(slug);
}

router.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  const source = software.get(slug);
  if (!source) return res.status(404).type('text').send('Logiciel introuvable.');

  const url = await downloadLink(slug, source);
  res.set('Cache-Control', 'no-store').redirect(302, url);
});

module.exports = router;
