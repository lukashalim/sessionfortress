# Session Fortress

Save Chrome windows and Tab Groups. Mirror every save to a folder you control so a crash, update, or “Repair Chrome” cannot wipe you.

- Privacy policy: https://lukashalim.github.io/sessionfortress/
- Contact: lukas.halim@gmail.com

This is not a tab organizer. The product is a **hot working copy** plus an **off-profile folder mirror**. If the folder mirror is missing, the extension is unfinished.

## Load unpacked

1. Install Node.js 20+.
2. In this folder: `npm install` then `npm run build`.
3. Open `chrome://extensions`, enable Developer mode.
4. Load unpacked → select the `dist/` directory (not the repo root).
5. Pin Session Fortress. Open the manager (toolbar, or Alt+Shift+M).
6. Pick a backup folder. `Documents/SessionFortress` is a good default. Dropbox, Drive desktop, and iCloud folders work if they are real folders on disk.

## How to test folder restore (the v1 bar)

A reviewer should be able to do this:

1. Install unpacked. Pick `Documents/SessionFortress`.
2. Make two named sessions that include Tab Groups (names + colors), pins, and more than one window.
3. Confirm `session-fortress-latest.json` and a dated `session-fortress-YYYY-MM-DDTHHMMSS.json` appear in that folder.
4. In the service worker console (`chrome://extensions` → Service worker → Inspect): `chrome.storage.local.clear()`. Reload. The IndexedDB hot replica should refill the list (you will see a recovery notice).
5. To force the **folder** path: also run `indexedDB.deleteDatabase("session-fortress-hot")`, then reload. The folder handle stays in `session-fortress-folder`. Click **Restore from folder**.
6. Groups, pins, and URLs come back.

A true profile reset also drops the folder handle. Pick the same folder again, then restore. Session Fortress will not overwrite a non-empty `latest.json` with an empty vault.

Related checks:

- Revoke folder permission in `chrome://settings/content/filesystem` (or site settings for the extension origin). The next save must show **permission expired**, badge `!`, and a banner. Click re-allow; write succeeds.
- Delete the last session only after confirm. An empty vault must not overwrite a non-empty `latest.json` unless that confirm happened.
- Save & close (stash) on the last window opens the manager first so Chrome does not quit with nowhere to stand. Stash waits for a folder write attempt (or a no-folder / permission-expired return) before closing the window. Rename and ordinary saves still debounce. After stash, last-delete, or restore, `chrome.alarms.getAll()` should have no leftover `critical-keepalive` alarms.
- Restore 200 tabs should batch (10 at a time). At ≥50 tabs, Chrome discards (unloads from memory) tabs after create so the restore does not freeze the browser for 30s — every tab is still restored.
- Incognito windows are captured into the hot store if the extension is allowed in incognito. Restore skips them by default. Folder mirror and Download JSON omit them unless Settings includes incognito in backups. Save toasts do not claim incognito was skipped on capture.

## Threat model

| Failure | Hot store (`chrome.storage` + IndexedDB in the profile) | Folder mirror (Documents / Dropbox / Drive / iCloud) |
| --- | --- | --- |
| Extension crash, Chrome restart | Survives | Survives |
| `chrome.storage` glitch | IndexedDB replica can refill the list | Survives |
| Profile reset, “Repair Chrome”, extension storage clear | Gone | **This is what the product is for** |
| Disk wipe, ransomware, you deleted the folder | May still be in the profile | Gone — keep a JSON export elsewhere if that matters |
| Both profile and folder gone | Gone | Gone |

A true Chrome profile reset also destroys IndexedDB, including the stored folder handle. The JSON files on disk survive. Pick the same folder again (Chrome remembers the last one when `id` is `session-fortress-backup`), then **Restore from folder**. Session Fortress will not overwrite a non-empty `latest.json` with an empty hot store.

## Permissions

- **Tabs & Tab Groups** — read and restore sessions (title, URL, pin, group name/color/collapsed). No page content.
- **Windows** — capture bounds and restore windows.
- **Storage / unlimitedStorage** — the hot session list.
- **Alarms** — finish a pending folder write if the worker slept.
- **Offscreen** — write JSON into the chosen folder from the background.
- **Folder access** — File System Access API, only after you pick a folder, only that folder. No extra manifest host permission.

No `<all_urls>`, history, webNavigation, analytics, or network.

## Keyboard shortcuts

Rebind at `chrome://extensions/shortcuts`.

- Save this window — Alt+Shift+S
- Save all windows — unset by default
- Save & close — unset by default
- Open manager — Alt+Shift+M

## Chrome Web Store listing copy

**Headline:** Don’t let a Chrome crash wipe your tabs.

**Short description:** Save Chrome windows and Tab Groups. Mirror every save to a folder you control so crashes can’t wipe you.

**Full description:**

Session Fortress saves Chrome windows and Tab Groups so you can restore them after a crash, restart, or messy day — without trusting a single fragile database inside Chrome’s profile.

Browser session tools store everything in the profile. That store vanishes after a crash, update, “Repair Chrome”, or profile reset. Session Fortress keeps a hot working copy for speed and mirrors every save to a folder you choose (Documents, Dropbox, Drive desktop, iCloud). If the hot store looks empty or corrupt, restore from that mirror in one click.

Power users with dozens or hundreds of tabs, multiple windows, and named colored Tab Groups. If Session Buddy, OneTab, or Chrome’s own restore has burned you, this is the backup those tools skipped.

What v1 does: named sessions, Tab Group fidelity on restore, save & close (stash), import/export JSON, and an off-profile folder mirror on day one.

What v1 does not do: accounts, cloud sync, AI grouping, new-tab takeover, or a paywall.

Privacy: https://lukashalim.github.io/sessionfortress/
Contact: lukas.halim@gmail.com

## Manual test matrix

See the prompt checklist. Automate what you can with `npm test` (import parse + filename helpers). The restore and folder permission paths require Chrome.

## Development

```
npm install
npm run build
npm run typecheck
npm test
```

Load `dist/` unpacked after each build. `npm run dev` rebuilds pages on change; reload the extension to pick up the service worker.
