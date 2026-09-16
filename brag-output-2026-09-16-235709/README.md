# Discord MCP launch film: paced revision

74 seconds, 1920 x 1080, 30 fps. This revision replaces the dense 25-second edit
with separate ask, send and result scenes. The original remains in `../brag-output/`.

- `brag.mp4`: finished H.264/AAC video with a poster baked into frame zero.
- `brag.jpg`: new "Your agent meets Discord" poster.
- `share-copy.txt`: ready-to-post caption.
- `brag-plan.md`: complete revised storyboard.
- `composition/`: editable Hyperframes source, local assets and original score.
- `verification.md`: delivery checks.

## What changed

The opening now uses "Your agent meets Discord" as the large headline, with no
small kicker or subtitle. Build and Configure each begin with a full-screen
typed prompt and a visible Send interaction, followed by the result. Server
assembly has 15 seconds to unfold. Messages, forums and events each have their
own six-second scene. Persistent chrome and secondary copy are reduced.

The interfaces are illustrative, with fictional content. The server-building
example starts with an existing server the bot has joined. No live Discord
server is changed by making or playing this film.

## Preview and render

Requires Node.js 22+, FFmpeg and FFprobe on PATH. Run from `composition/`:

```sh
npm run check
npm run dev
npx --yes hyperframes@0.8.43 render --quality delivery --fps 30 --output ../brag.raw.mp4
```

From this directory, select the settled opening and bake it into frame zero:

```sh
ffmpeg -y -ss 2 -i brag.raw.mp4 -frames:v 1 -q:v 2 brag.jpg
ffmpeg -y -i brag.raw.mp4 -i brag.jpg -filter_complex "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]" -map "[v]" -map 0:a? -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a copy -movflags +faststart brag.mp4
```

To regenerate the original 74-second, 100 BPM score, run from `composition/`:

```sh
node scripts/create-score.mjs
ffmpeg -y -i assets/score.wav -c:a libmp3lame -b:a 192k assets/score.mp3
```

## Credits

- Unmodified product icon: supplied by the project owner.
- Original score and film composition: repository MIT license.
- Manrope: SIL Open Font License 1.1, included in `composition/assets/Manrope-OFL.txt`.
- UI sounds: Kenney, CC0, from the brag skill's bundled library.
- GSAP 3.14.2: [GSAP Standard License](https://gsap.com/standard-license/).
- Text entrance recipe: adapted from Hyperframes `text-stagger` in the first cut.
- Renderer: [Hyperframes](https://github.com/heygen-com/hyperframes), pinned to 0.8.43.

The launch files are excluded from installable plugin archives via `.gitattributes`.
