# Medical Genetics Learning Hub

Static web app with 3 levels:
- Chapters
- Subchapters
- Resource buttons (Video, Podcast, Infogram, Questions)

## Run

Open `index.html` in a browser.

## Resource files

Add your files inside `public/` using **chapter + subchapter + type** (either naming style works):

- `MG_BG_T_V.<ext>` or `BG_T_V.<ext>`
- `MG_BG_MP_P.<ext>` or `BG_MP_P.<ext>`
- `MG_IM_M_I.<ext>` or `IM_M_I.<ext>`
- `MG_CA_GD_Q.<ext>` or `CA_GD_Q.<ext>`
- …and so on for each subchapter.

Supported extensions auto-detected by the app:
`mp4`, `webm`, `mp3`, `wav`, `html`, `htm`, `pdf`, `png`, `jpg`, `jpeg`, `svg`, `csv`.

**Questions (`.csv`)** open in an in-app flashcard viewer. Other types open in a new browser tab.

For reliable loading (especially CSV), run a local static server from this folder, for example: `npx serve`.
