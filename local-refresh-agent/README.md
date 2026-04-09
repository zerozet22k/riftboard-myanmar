# Local Refresh Agent

This folder now uses a native Windows tray executable.

Use:

- Double-click `RiftBoardRefreshTray.exe`
- left-click the tray icon to open the settings window
- right-click the tray icon to exit

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

Edit [config.json](/C:/Users/Zet/burmese-lp-ranking/local-refresh-agent/config.json) if you want to change the port, interval, or batch size.

Notes:

- the tray app auto-starts the refresh loop
- the settings window can start, stop, save, and open the agent folder
- all refresh helper code now lives inside this folder
- the helper uses `next start`, so run `npm run build` after code changes
- logs live in this folder as `app.log`, `server.out.log`, and `server.err.log`
