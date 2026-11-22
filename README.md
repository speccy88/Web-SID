# Web-SID

Web-SID is a browser port of P1 SIDcog v1.4. It synthesizes SID register dumps in an AudioWorklet and shows the resulting waveform, voice envelopes, and register activity in real time.

[Open Web-SID on GitHub Pages](https://speccy88.github.io/Web-SID/)

Tap **Start audio** to play `013.dmp`. The track menu also includes **Lost Friend** and two synthesis demonstrations. Use **Register dump playback** to import a local raw `.dmp` file, with 25 bytes per frame. Imported files stay in the browser.

## Run locally

Run `python3 -m http.server 8000 --directory docs` and open `http://localhost:8000/`. Use Node.js 20 or newer to run `npm test`. The static site has no build step.

See [the technical notes](docs/assets/README.md) and [upstream notices](docs/assets/NOTICE.txt).
