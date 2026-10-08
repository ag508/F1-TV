# Formula1 Display fonts (optional)

The app uses the official Formula1 Display typefaces when their files are in
this folder, and the free Saira font otherwise. The F1 fonts are proprietary
(© Marc Rouault / W+K, all rights reserved), so they aren't included. Only add
files you have the rights to use.

Expected file names (any of .woff2, .woff, .ttf, .otf). The name decides how
each file is used:

| File name contains | Used as |
|---|---|
| `Wide` | Display headlines (`F1 Wide`) |
| `Regular` | Body text (`F1 Regular`, 400) |
| `Bold` | Body text (`F1 Regular`, 700) |
| `Black` | Body text (`F1 Regular`, 900) |
| `Italic` | the italic of the above |

For example `Formula1-Display-Wide.woff2`, `Formula1-Display-Regular.woff2`,
`Formula1-Display-Bold.woff2`.

Font files here are git-ignored so they never end up in the repository or a
public Docker image by accident.
