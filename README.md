# World Simulator

A hex-map world simulator inspired by *Guns, Germs, and Steel*.
Stage 1: 4,000 hex tiles (80 × 50), wrapping east–west, with zoom and scroll.
Stage 2: tectonic plates produce 5 continents and a 30% land / 70% ocean split, from a seed.

## Run locally
Browsers block ES modules over `file://`, so use a tiny local server:

    python3 -m http.server 8000

then open http://localhost:8000

## Publish on GitHub Pages
1. Create a new GitHub repository and upload everything in this folder (so `index.html` is at the repo root).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. After a minute your site is live at `https://<your-username>.github.io/<repo-name>/`.

## Files
- `js/map.js` world data (tile arrays, wrapping, neighbors). No rendering code.
- `js/renderer.js` canvas drawing, camera, zoom, tile picking.
- `js/main.js` input handling (drag, wheel, pinch, keyboard) and the render loop.
- `js/random.js` seeded random numbers and east-west tileable noise.
- `js/worldgen.js` layer 1: plates -> land and ocean. All tuning numbers are in `DEFAULTS` at the top.

## Sharing a world
The seed is stored in the page address (`#myseed`), so copying the URL shares the exact same world.
