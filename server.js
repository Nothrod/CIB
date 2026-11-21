const express = require('express');
const path = require('node:path');
const youtubeMp3 = require('./routes/youtube-mp3');

const app = express();
const port = process.env.PORT || 3004;

app.use('/youtube-mp3', youtubeMp3);

app.get(['/qrcode.html', '/qrcode'], (req, res) => {
  res.redirect(301, '/services/qrcode/');
});
app.get(['/convertisseur', '/convertisseur/index.html'], (req, res) => {
  res.redirect(301, '/services/convertisseur/');
});
app.get(['/youtube-mp3', '/youtube-mp3/index.html'], (req, res) => {
  res.redirect(301, '/services/youtube-mp3/');
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(port, () => {
  console.log(`Club Informatique lancé sur http://localhost:${port}`);
});
