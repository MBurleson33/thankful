# 🍂 Who's Thankful For That?

A pass-the-phone gratitude guessing game for small groups.

1. Pass one phone around the table. Each person adds their name and one thing they're thankful for; their answer hides right away.
2. Start the reveal: answers come out shuffled, one at a time. Everyone guesses who wrote it, then tap to reveal.

Single static file (`index.html`), no server. Answers are saved in the phone's browser so a refresh won't lose them.

## Run it
Open `index.html`, or enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).

## Gobble Minds

A second game lives at `/gobble/` (TV mode at `/gobble/tv.html`), using the same Upstash database through `api/gobble.js`. Everyone answers a prompt; matching the most popular answer scores, and a lone unique answer takes the turkey.
