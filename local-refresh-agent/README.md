# Local Refresh Agent

This folder uses a native Windows tray executable.

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
- refreshes `5` players every `5` minutes by default
- includes rank refresh and latest match sync

Edit `config.json` if you want to change interval or batch size.

Notes:

- the tray app auto-starts the refresh loop
- the settings window can start, stop, save, and open the agent folder
- all refresh helper code now lives inside this folder
- logs live in this folder as `app.log`, `server.out.log`, and `server.err.log`
