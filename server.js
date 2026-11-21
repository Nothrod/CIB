// server.js
const express = require('express');
const path = require('path');
const youtubeMp3 = require('./youtube-mp3/router');

const app = express();
const PORT = process.env.PORT || 3004;

// Convertisseur YouTube en MP3
app.use('/youtube-mp3', youtubeMp3);

// Sert les fichiers du site : HTML, CSS, images…
app.use(express.static(path.join(__dirname, 'public')));

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(
        `💻 Club Informatique lancé sur http://localhost:${PORT}`
    );
});
