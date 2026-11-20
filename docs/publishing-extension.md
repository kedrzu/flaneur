# Publishing the extension on the Chrome Web Store

The flaneur extension (`packages/chrome-extension/`) lets `flaneur --chrome own` drive the user's own Chrome. Until it is on
the Chrome Web Store, users load it unpacked. Why it exists and why it is thin:
[`docs/decisions/own-chrome.md`](decisions/own-chrome.md).

## Once: the developer account

1. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) with the
   Google account that will own the item, and pay the one-time registration fee
   ([developer.chrome.com/docs/webstore/register](https://developer.chrome.com/docs/webstore/register)).
2. Turn on 2-Step Verification on that account: the store requires it to publish.
3. Fill in the publisher details on the dashboard's account page (name, contact email, verified).

## First release

### 1. Build and pack

```bash
bun run build
bun run --cwd packages/chrome-extension pack
```

`pack` prints the zip it wrote: `packages/chrome-extension/dist/flaneur-chrome-extension-<version>.zip`. It holds only the files the
extension loads, and its manifest has no `key`: the store refuses one and signs the item with its own.

### 2. Create the item as a draft

On the dashboard, **Add new item** and upload the zip. Do not submit yet. The upload creates the item and fixes its ID.

### 3. Give the development build the store's ID

Done once, on 2026-11-20, for the item `goimhkigkmnddobemofljbnlmlgbikcl`; repeat it only for a new item.

The native messaging host admits one extension ID only, so the unpacked build must have the store's ID too:

1. On the item's **Package** page, copy its public key (**View public key**), without the `-----BEGIN/END PUBLIC
   KEY-----` lines, into `key` in `packages/chrome-extension/manifest.json`.
2. Copy the item's ID into `OWN_CHROME_EXTENSION_ID` (`grep -rn OWN_CHROME_EXTENSION_ID packages/flaneur/src`).
3. Load `packages/chrome-extension` unpacked in `chrome://extensions` and check that it shows the same ID.

### 4. Store listing

- **Description:** what the options page says. flaneur lets AI agents running on this computer browse in this
  Chrome, signed in to the sites the user is signed in to; by default agents see only the tabs they open, in a window
  of their own.
- **Images:** the listing takes its own, not the package's; they are in `packages/chrome-extension/store/`:
  `store-icon-128.png` (the hat, 96 px with 16 px of transparent margin), `screenshot-options-1280x800.png` (the
  options page) and `small-promo-440x280.png` (the lockup on the tile's colours). A second screenshot, the agent
  window with a page an agent opened and the yellow debugging bar showing, has to be taken by hand.
- **Single purpose:** "Lets AI agents that the user runs on this computer with flaneur browse in this Chrome, in tabs
  the user allows."

### 5. Privacy practices

Justify each permission:

- `debugger`: drives the tabs an AI agent opens, at the user's request.
- `tabs`: opens and lists tabs in the agent window.
- `nativeMessaging`: talks to the flaneur program on this computer.
- `storage`: keeps the user's setting of which tabs agents see.
- `alarms`: retries the connection while no flaneur is connected.

Data use: no data leaves the computer through the extension, and nothing is collected; tick no data category and
certify the disclosures.

The privacy policy URL is the page that says the same,
`https://github.com/kedrzu/flaneur/blob/main/docs/extension-privacy.md`.

### 6. Submit for review

`debugger` is a sensitive permission, so review may take longer than usual. Publish as soon as it passes.

### 7. After publishing

- Put the store URL into `EXTENSION_URL` in `packages/flaneur/src/connectOwnChrome.ts`, the error the CLI prints
  when the extension does not connect.
- Replace the "Load unpacked" steps in the package README's "Your own Chrome" section with the store link.

## Updates

1. Bump `version` in `packages/chrome-extension/manifest.json`; the store refuses a version it already has.
2. Build and pack as above, upload the zip on the item's **Package** page and submit it.

`OWN_CHROME_PROTOCOL_VERSION` in `packages/flaneur/src/OwnChromeProtocol.ts` must match between flaneur and the
extension: flaneur refuses an extension that speaks another version and names the side to update. The extension takes
the constant from the flaneur package it is built with. Whenever it changes, publish the
extension first, then the npm package, so a new flaneur never waits for a store review.
