# Verification

- Final MP4: 74.000 seconds, 2,220 frames, 1920 x 1080, 30 fps.
- H.264 video, AAC stereo at 48 kHz, fast-start MP4. Size: 5,076,784 bytes.
- Audio peak: -4.9 dBFS; mean: -24.7 dB. No clipping.
- Poster: new opening at 2.0 seconds, baked into frame zero.
- Hyperframes 0.8.43 check: passed at 19 sample times.
- No runtime, layout or motion assertion errors.
- All 69 sampled text contrast checks passed WCAG AA.
- Lint has no errors. One warning reflects the intentionally repeated icon.
- Visual inspection covered the poster, prompts, send interaction, title-only
  bridge, building and completed server, settings and each separate daily task.
- Final-MP4 frames checked at 9.5, 17.5, 19.3 and 49 seconds, plus the thumbnail
  and final frame.
- Keyframe proof verified the build-title's center-to-left handoff. The static
  CLI selector parser cannot resolve selectors constructed inside the shared
  prompt helper; send-button motion was instead checked in rendered frames.
- Render used hardware GPU screenshot capture and completed successfully.

The original 25-second cut is preserved. No live Discord data or writes were used.
