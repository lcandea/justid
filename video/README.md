# JustID demo videos

Short, silent product demos rendered with [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP → MP4).
This folder is dev tooling only: it is not part of the site, `tools/build-site.sh` never copies it, and the
app's tests and typecheck don't look at it.

Eight videos: `{send, request} × {es, en} × {9x16, 16x9}` → `video/out/justid-<flow>-<lang>-<aspect>.mp4`
(1080×1920 or 1920×1080, 30 fps, H.264 yuv420p, CRF 18, no audio track).

## Pipeline

```
config.json + strings/<lang>.json
        │
        ├─ capture/capture.mjs ──► .cache/captures/<lang>/   real app screens (Playwright, 390×844 @3x,
        │                                                     language set with the app's own toggle) and
        │                                                     real card renders (the app's renderRedacted on
        │                                                     the official specimen, fixed seed and date)
        │
        ├─ tools/build.mjs ──────► .build/<flow>-<lang>-<aspect>/   a HyperFrames project: src/<flow>/ templates
        │                                                     filled with strings, config, sizes and captures
        │
        └─ tools/run.mjs ────────► out/justid-<flow>-<lang>-<aspect>.mp4   render + ffprobe check
```

`.cache/`, `.build/` and `out/` are git-ignored; everything in them can be regenerated.

## Commands

```sh
npm run video:capture -- --lang es            # or --lang en; --flow send|request|all
npm run video:preview -- --flow send --lang es --aspect 9x16   # HyperFrames Studio in the browser
npm run video:check   -- --flow send --lang es --aspect 9x16   # lint + layout audit
npm run video:snapshot -- --flow send --lang es --aspect 9x16 --at 1,4,7.5
npm run video:render  -- --flow send --lang es --aspect 9x16
npm run video:render:all                       # all 8 (capture both languages first)
npm run video:compress                         # 720p web copies + posters -> landing/video/ (shipped)
```

The landing plays the files in `landing/video/` (`landing/landing.js` picks flow × language × vertical/16:9).
Poster frames are taken at `posterAt` in `config.json`: the moment the opening animation has landed.

Needs Node 22+, ffmpeg/ffprobe on the PATH and Google Chrome (Playwright uses the installed Chrome, like the app's tests).
HyperFrames and GSAP are pinned dev dependencies; GSAP is copied into each build, so renders need no network.
HyperFrames telemetry is turned off by the scripts (`HYPERFRAMES_NO_TELEMETRY=1`).

## Where things live

| Path | What |
|---|---|
| `config.json` | Scenario data: purpose, requester, fields, fixed date, device, aspects |
| `strings/es.json`, `strings/en.json` | Every on-screen word. Keys ending in `_app` reuse the app's wording (source keys in `$sources`). `*word*` = lime accent |
| `capture/capture.mjs` | Deterministic Playwright capture |
| `src/shared/` | `video.css` (stage, captions, phone, card, tap, logo; built on the app's `shared/theme.css` tokens) and `lib.js` (motion helpers) |
| `src/<flow>/index.html` | Root composition: one scene host per beat |
| `src/<flow>/compositions/*.html` | One scene per beat; layout per aspect via `.is-9x16` / `.is-16x9` and `<!--if:…-->` |
| `tools/build.mjs` | Template filling (syntax documented at the top of the file) |
| `tools/run.mjs` | build / check / snapshot / preview / render / render-all |

## Rules the videos follow

- Only the official specimen DNI the app ships (`templates/ref/`). Never a real ID.
- Real UI from the capture; moments that need smooth motion (detection, redaction, watermark, share sheet) are rebuilt
  in HTML with the app's styles, using real redaction output clipped per field zone.
- Claims: processing happens on the phone; the page's security policy blocks sending data; a request lives in the
  link (no server) and doesn't expire; free and open source.
- 16:9 is a recomposition (phone left, captions right), not a letterbox.
