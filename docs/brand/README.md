# Brand

The flâneur, the 19th-century Parisian who strolls the city watching everything and noticed by no one, drawn as a
gentleman in a top hat walking with a cane. The SVGs here are the masters; the PNGs and the favicon are exported from
them.

## Files

|File|Use|
|-|-|
|`signet.svg`|The primary mark: the walking figure on a rounded tile|
|`signet-hat.svg`|The small mark: the top hat alone, for 16 px and below|
|`lockup.svg` / `lockup-dark.svg`|Signet and wordmark side by side, for light and dark backgrounds|
|`wordmark.svg` / `wordmark-dark.svg`|The name alone, for light and dark backgrounds|
|`favicon.ico`|The hat at 16 px, the figure at 32 and 48 px|
|`/favicon.svg`|A link to `signet.svg` at the repo root, where tools that show a project icon look for one|
|`png/signet-{32,48,128,512}.png`|The figure, e.g. a Chrome extension's 32, 48 and 128 px icons|
|`png/signet-hat-{16,32}.png`|The hat, e.g. a Chrome extension's 16 px icon|

The figure reads from 32 px up; below that its cane disappears, so 16 px uses the hat.

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
