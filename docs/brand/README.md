# Brand

The flâneur, the 19th-century Parisian who strolls the city watching everything and noticed by no one, drawn as a
gentleman in a top hat walking with a cane. The SVGs here are the masters; the PNGs and the favicon are exported from
them.

## Files

|File|Use|
|-|-|
|`signet.svg`|The primary mark: the walking figure on a rounded tile|
|`signet-hat.svg`|The small mark: the top hat alone, for every favicon-sized use|
|`hat.svg`|The hat with no tile, on a transparent background, cropped to it: the Chrome extension's icons|
|`lockup.svg` / `lockup-dark.svg`|Signet and wordmark side by side, for light and dark backgrounds|
|`wordmark.svg` / `wordmark-dark.svg`|The name alone, for light and dark backgrounds|
|`favicon.ico`|The hat at 16 and 32 px, the figure at 48 px|
|`/favicon.svg`|A link to `signet-hat.svg` at the repo root, where tools that show a project icon look for one|
|`png/signet-{32,48,128,512}.png`|The figure, e.g. a Chrome extension's 32, 48 and 128 px icons|
|`png/signet-hat-{16,32}.png`|The hat, e.g. a Chrome extension's 16 px icon|
|`social-preview.svg`, `png/social-preview.png`|The repo's social preview, 1280 × 640: lockup, tagline and the eval's headline result|

The figure needs room: at 16 px its cane disappears. A favicon shows at 16 px, drawn from the 32 px image on a
HiDPI screen, so every favicon, the ICO's 16 and 32 px and the root SVG, is the hat; the figure starts at 48 px.

## Colours

|Role|Colours|
|-|-|
|Tile|`#FFFFFF` → `#FBE4EF` top to bottom, `#F0C9DC` hairline|
|Figure and hat|`#E0368F` → `#A80F6A` top to bottom|
|Crown top, hat band|`#E8529A`, `#F9CFE3`|
|Wordmark on light|`#C8237F` → `#A80F6A` top to bottom|
|Wordmark on dark|`#FBE4EF` → `#F2B8D4` top to bottom|

Gradients stay subtle: one hue, a slight shift in lightness.

## Type

The wordmark is [Lora](https://fonts.google.com/specimen/Lora) Italic at weight 500, set without ligatures so the `f`
and `l` stay apart at small sizes, and converted to outlines: the SVGs need no font. Lora is under the SIL Open Font
License.

## Social preview

GitHub shows `png/social-preview.png` when a link to the repo is shared. It has no API for it: upload the PNG in the
repo's Settings → General → Social preview. Its text is in Lora 500, italic for the tagline, converted to outlines like
the wordmark. The PNG is exported from the SVG with Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1280,640 \
    --screenshot="$PWD/docs/brand/png/social-preview.png" "file://$PWD/docs/brand/social-preview.svg"
```

Its last line quotes the eval ([What it has been tested against](../../README.md#what-it-has-been-tested-against)):
when the results change, change it too.
