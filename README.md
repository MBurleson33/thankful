# 🍂 Who's Thankful For That?

A pass-the-phone gratitude guessing game for small groups.

1. Pass one phone around the table. Each person adds their name and one thing they're thankful for; their answer hides right away.
2. Start the reveal: answers come out shuffled, one at a time. Everyone guesses who wrote it, then tap to reveal.

Single static file (`index.html`), no server. Answers are saved in the phone's browser so a refresh won't lose them.

## Run it
Open `index.html`, or enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).

## Gobble Minds

A second game lives at `/gobble/` (TV mode at `/gobble/tv.html`), using the same Upstash database through `api/gobble.js`. Everyone answers a prompt; matching the most popular answer scores, and a lone unique answer takes the turkey.

## Scribble Telephone

At `/scribble/` (TV mode at `/scribble/tv.html`), using `api/scribble.js`. Write, draw, guess, pass it on; the host reveals each chain step by step. Drawings are stored as compact strokes.

## Party mode

`/party/` lets everyone join once; the host picks a game and every phone (and `/party/tv.html`) follows. Each game room reuses the party code (`want` on create). `party-link.js` adds the party bar and follows switches. Chameleon is also served here at `/chameleon/` via `api/chameleon.js` (same data prefix as the standalone Chameleon project).
