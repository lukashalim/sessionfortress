# Session Fortress

Save Chrome windows and Tab Groups. Sessions live in this browser. Export JSON when you want a copy that survives a profile reset or a new computer.

- Privacy policy: https://lukashalim.github.io/sessionfortress/
- Contact: lukas.halim@gmail.com

This is not a tab organizer. The working copy is in Chrome’s extension storage. A JSON export you save yourself is the copy that outlives this profile.

## Load unpacked

1. Install Node.js 20+.
2. In this folder: `npm install` then `npm run build`.
3. Open `chrome://extensions`, enable Developer mode.
4. Load unpacked → select the `dist/` directory (not the repo root).
5. Pin Session Fortress. Open the manager (toolbar, or Alt+Shift+M).

## How to test

1. Save a window with Tab Groups, pins, and more than one tab.
2. Reload the extension. The session is still in the list.
3. **Export JSON** — Chrome’s save dialog. Filename like `session-fortress-YYYY-MM-DD.json`.
4. Delete the session (or imagine a wiped profile). **Import JSON**. It is added as a new session (new id). If the name already exists, it gets ` (imported)`.
5. Restore → groups, pins, and URLs come back.

Related checks:

- Saves must not wait on a folder or a download. Capture writes `chrome.storage.local` immediately; the IndexedDB replica is debounced.
- Import of a broken file shows a clear error. Valid files never silently replace the existing list.
- Settings: weekly export reminder, include incognito in exports, startup health check (refill from the local replica if storage looks empty).
- Older `session-fortress-latest.json` folder-mirror files still import.
- Restore 200 tabs should batch (10 at a time). At ≥50 tabs, Chrome discards tabs after create so the restore does not freeze the browser.

## Threat model

| Failure | Hot store (`chrome.storage` + IndexedDB replica in the profile) | JSON export you saved |
| --- | --- | --- |
| Extension crash, Chrome restart | Survives | Survives |
| `chrome.storage` glitch | IndexedDB replica can refill the list | Survives |
| Profile reset, “Repair Chrome”, extension storage clear | Gone | **This is what Export is for** |
| You never exported, and the profile is gone | Gone | Gone |

## Permissions

- **Tabs & Tab Groups** — read and restore sessions (title, URL, pin, group name/color/collapsed). No page content.
- **Windows** — capture bounds and restore windows.
- **Storage / unlimitedStorage** — the session list.
- **Alarms** — keep long restores/stashes alive if the worker slept.
- **Downloads** — only when you export JSON. You pick the location each time.

No `<all_urls>`, history, webNavigation, analytics, network, or live folder access.

## Keyboard shortcuts

Rebind at `chrome://extensions/shortcuts`.

- Save this window — Alt+Shift+S
- Save all windows — unset by default
- Save & close — unset by default
- Open manager — Alt+Shift+M

## Chrome Web Store listing copy

**Headline:** Don’t let a Chrome crash wipe your tabs.

**Short description:** Save Chrome windows and Tab Groups in this browser. Export JSON so a reset or a new computer cannot wipe you.

**Full description:**

Session Fortress saves Chrome windows and Tab Groups so you can restore them after a crash, restart, or messy day.

Sessions stay on this device, in this Chrome profile. Export JSON when you want a copy that survives “Repair Chrome”, a profile reset, or moving to another machine. Import that file to get the sessions back — they are added as new, never silently overwritten.

Power users with dozens or hundreds of tabs, multiple windows, and named colored Tab Groups.

What it does: named sessions, Tab Group fidelity on restore, save & close (stash), JSON export/import.

What it does not do: accounts, cloud sync, AI grouping, new-tab takeover, a paywall, or a live backup folder that Chrome keeps revoking.

Privacy: https://lukashalim.github.io/sessionfortress/
Contact: lukas.halim@gmail.com

## Development

```
npm install
npm run build
npm run typecheck
npm test
```

Load `dist/` unpacked after each build. `npm run dev` rebuilds pages on change; reload the extension to pick up the service worker.
