# Local Refresh Agent

This folder uses a native Windows tray executable.

There are two self-contained Windows x64 package types:

```powershell
npm run tray:host
npm run tray:community
```

- Host package: uses `config.json` and keeps direct host mode (`cronOnly: false`).
- Community package: uses `community-config.example.json` as `config.json` and stays cron-only (`cronOnly: true`).

`npm run tray:host` also refreshes the root `RiftBoardRefreshTray.exe` in this folder for the host machine.

Use:

- Double-click `RiftBoardRefreshTray.exe`
- left-click the tray icon to open the settings window
- right-click the tray icon to exit

Safe community mode:

- Use `community-config.example.json` as the template for a shared build.
- Copy it to `config.json`.
- Set `cronOnly` to `true`.
- Paste only the shared cron runner token into `cronToken`.
- Do not include `.env`, MongoDB keys, Riot keys, or Discord bot tokens in a shared folder.
- In cron-only mode, the tray only calls RiftBoard cron routes on the website. It does not connect to MongoDB or Riot directly.

Behavior:

- no visible app window
- stays in the Windows system tray like a small background app
- uses the RiftBoard app icon in the tray
- hover the tray icon to see quick status
- left-click opens a small control window with live status
- you can change interval, players per run, and match sync settings there
- the app shows a rough Riot-load hint so it is easier to stay gentle on the API
- shows Windows notifications for start, stop, and failures
- refreshes `5` players every `10` minutes by default
- checks live games every `15` minutes by default
- includes rank refresh and the latest `5` LoL/TFT matches, with historical backfill disabled
- spaces direct Riot calls and pauses all direct polling when Riot returns `429`
- direct mode shares one Mongo-backed Riot lease with the website, so two runners cannot spend the same key at once

Edit `config.json` if you want to change interval or batch size.

Notes:

- the tray app auto-starts the refresh loop
- the settings window can start, stop, save, and open the agent folder
- all refresh helper code now lives inside this folder
- logs live in this folder as `app.log`, `server.out.log`, and `server.err.log`
- rebuild the executable with `npm run tray:host` or `npm run tray:community` after source changes
