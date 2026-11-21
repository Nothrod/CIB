# Club Informatique de Bethoncourt

```sh
npm ci
npm start
```

Le site est accessible sur http://localhost:3004. La variable d’environnement `PORT` permet de changer le port. La commande `node server.js` fonctionne également.

- `public/index.html` présente le club et mène aux outils.
- `public/assets/` contient le logo et les styles communs.
- `public/services/` contient les pages, scripts et bibliothèques navigateur propres à chaque outil.
- `routes/youtube-mp3.js` traite les conversions MP3 côté serveur. Il nécessite yt-dlp et FFmpeg dans le `PATH`. La variable `YT_DLP_PATH` permet d’indiquer le chemin vers yt-dlp.
