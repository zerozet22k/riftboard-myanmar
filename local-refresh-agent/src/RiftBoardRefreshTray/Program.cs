using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Http.Json;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

namespace RiftBoardRefreshTray;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var instance = new SingleInstanceGuard("Local\\RiftBoardMyanmarRefreshTrayExe");
        if (!instance.IsPrimary)
        {
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext());
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private const string TrayLogoFileName = "logo.png";
    private readonly NotifyIcon _notifyIcon;
    private readonly Icon _trayIcon;
    private readonly SynchronizationContext _uiContext;
    private readonly RefreshLoop _loop;
    private readonly string _baseDirectory;
    private readonly string _configPath;
    private SettingsForm? _settingsForm;
    private string _state = "stopped";
    private string _progress = "Idle";
    private string? _lastRun;
    private DateTimeOffset? _nextRunAt;

    public TrayContext()
    {
        if (SynchronizationContext.Current is null)
        {
            SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        }

        _uiContext = SynchronizationContext.Current!;
        _baseDirectory = AppContext.BaseDirectory;
        _configPath = Path.Combine(_baseDirectory, "config.json");
        var logger = new AgentLogger(Path.Combine(_baseDirectory, "app.log"));
        _trayIcon = LoadTrayIcon(_baseDirectory)
            ?? Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath)
            ?? (Icon)SystemIcons.Application.Clone();
        _loop = new RefreshLoop(
            _baseDirectory,
            logger,
            ShowNotification,
            UpdateState,
            UpdateProgress,
            UpdateLastRun,
            UpdateNextRun);

        _notifyIcon = new NotifyIcon
        {
            Icon = _trayIcon,
            Text = "RiftBoard Refresh",
            Visible = true,
        };
        _notifyIcon.MouseClick += OnNotifyIconMouseClick;

        var menu = new ContextMenuStrip();
        var exitItem = new ToolStripMenuItem("Exit");

        exitItem.Click += async (_, _) => await ExitAsync();

        menu.Items.Add(exitItem);

        _notifyIcon.ContextMenuStrip = menu;

        UpdateState(_loop.IsRunning ? "running" : "stopped");
        UpdateProgress("Waiting for the first refresh...");
        PushConfigToSettingsForm(AgentConfig.LoadOrCreate(_configPath));
        _ = StartLoopAsync();
    }

    private void OnNotifyIconMouseClick(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            ShowSettingsWindow();
        }
    }

    private async Task StartLoopAsync()
    {
        await _loop.StartAsync();
    }

    private async Task StopLoopAsync()
    {
        await _loop.StopAsync();
    }

    private void OpenAgentFolder()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"\"{_baseDirectory}\"",
            UseShellExecute = true,
        });
    }

    private void OpenLogs()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"\"{_baseDirectory}\"",
            UseShellExecute = true,
        });
    }

    private async Task ExitAsync()
    {
        await _loop.StopAsync();
        ExitThread();
    }

    private void ShowNotification(string title, string message, ToolTipIcon icon)
    {
        _uiContext.Post(_ =>
        {
            _notifyIcon.BalloonTipTitle = title;
            _notifyIcon.BalloonTipText = message;
            _notifyIcon.BalloonTipIcon = icon;
            _notifyIcon.ShowBalloonTip(4000);
        }, null);
    }

    private void UpdateState(string state)
    {
        _uiContext.Post(_ =>
        {
            _state = state;
            SyncTrayPresentation();
            PushStatusToSettingsForm();
        }, null);
    }

    private void UpdateProgress(string progress)
    {
        _uiContext.Post(_ =>
        {
            _progress = progress;
            SyncTrayPresentation();
            PushStatusToSettingsForm();
        }, null);
    }

    private void UpdateLastRun(string? lastRun)
    {
        _uiContext.Post(_ =>
        {
            _lastRun = lastRun;
            SyncTrayPresentation();
            PushStatusToSettingsForm();
        }, null);
    }

    private void UpdateNextRun(DateTimeOffset? nextRunAt)
    {
        _uiContext.Post(_ =>
        {
            _nextRunAt = nextRunAt;
            SyncTrayPresentation();
            PushStatusToSettingsForm();
        }, null);
    }

    private void SyncTrayPresentation()
    {
        _notifyIcon.Icon = _trayIcon;
        _notifyIcon.Text = TrimForTrayText(BuildTrayText());
    }

    private string BuildTrayText()
    {
        if (string.Equals(_state, "stopped", StringComparison.OrdinalIgnoreCase))
        {
            return "RiftBoard Refresh - Stopped";
        }

        if (string.Equals(_state, "refreshing", StringComparison.OrdinalIgnoreCase))
        {
            return $"RiftBoard Refresh - {TrimForTrayText(_progress)}";
        }

        if (_nextRunAt is not null)
        {
            return $"RiftBoard Refresh - Next {_nextRunAt.Value:hh:mm tt}";
        }

        if (!string.IsNullOrWhiteSpace(_lastRun))
        {
            return $"RiftBoard Refresh - {TrimForTrayText(_lastRun)}";
        }

        return "RiftBoard Refresh - Running";
    }

    private static string ToTitleCase(string value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? "Unknown"
            : char.ToUpperInvariant(value[0]) + value[1..].ToLowerInvariant();
    }

    private static string TrimForMenu(string value)
    {
        return value.Length <= 72 ? value : $"{value[..69]}...";
    }

    private static string TrimForTrayText(string value)
    {
        const int maxLength = 63;
        return value.Length <= maxLength ? value : $"{value[..(maxLength - 3)]}...";
    }

    private void ShowSettingsWindow()
    {
        if (_settingsForm is null || _settingsForm.IsDisposed)
        {
            _settingsForm = new SettingsForm(
                _trayIcon,
                _baseDirectory,
                SaveSettingsAsync,
                StartLoopAsync,
                StopLoopAsync);
        }

        PushConfigToSettingsForm(AgentConfig.LoadOrCreate(_configPath));
        PushStatusToSettingsForm();
        if (!_settingsForm.Visible)
        {
            _settingsForm.Show();
        }

        _settingsForm.WindowState = FormWindowState.Normal;
        _settingsForm.BringToFront();
        _settingsForm.Activate();
    }

    private async Task SaveSettingsAsync(AgentConfig config)
    {
        var normalized = config.Normalize();
        await normalized.SaveAsync(_configPath, CancellationToken.None);
        PushConfigToSettingsForm(normalized);
        PushStatusToSettingsForm();
        ShowNotification(
            "RiftBoard Refresh",
            "Settings saved. If a refresh is already running, the new values apply on the next cycle.",
            ToolTipIcon.Info);
    }

    private void PushConfigToSettingsForm(AgentConfig config)
    {
        _settingsForm?.SetConfig(config);
    }

    private void PushStatusToSettingsForm()
    {
        _settingsForm?.UpdateStatus(
            ToTitleCase(_state),
            TrimForMenu(_progress),
            string.IsNullOrWhiteSpace(_lastRun) ? "None yet" : TrimForMenu(_lastRun),
            _nextRunAt?.ToString("hh:mm tt") ?? "Pending");
    }

    protected override void ExitThreadCore()
    {
        if (_settingsForm is not null && !_settingsForm.IsDisposed)
        {
            _settingsForm.AllowClose();
            _settingsForm.Close();
        }

        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        _trayIcon.Dispose();
        base.ExitThreadCore();
    }

    private static Icon? LoadTrayIcon(string baseDirectory)
    {
        try
        {
            var current = new DirectoryInfo(baseDirectory);
            while (current is not null)
            {
                var assetPath = Path.Combine(current.FullName, "public", TrayLogoFileName);
                if (File.Exists(assetPath))
                {
                    using var source = new Bitmap(assetPath);
                    using var resized = new Bitmap(source, new Size(32, 32));
                    var handle = resized.GetHicon();
                    try
                    {
                        using var unmanagedIcon = Icon.FromHandle(handle);
                        return (Icon)unmanagedIcon.Clone();
                    }
                    finally
                    {
                        DestroyIcon(handle);
                    }
                }

                current = current.Parent;
            }
        }
        catch
        {
        }

        return null;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr hIcon);
}

internal sealed class SettingsForm : Form
{
    private readonly Func<AgentConfig, Task> _saveAsync;
    private readonly Func<Task> _startAsync;
    private readonly Func<Task> _stopAsync;
    private readonly string _baseDirectory;
    private AgentConfig _config = new();
    private bool _allowClose;
    private readonly Label _statusValueLabel;
    private readonly Label _progressValueLabel;
    private readonly Label _lastRunValueLabel;
    private readonly Label _nextRunValueLabel;
    private readonly NumericUpDown _intervalMinutesBox;
    private readonly NumericUpDown _playersPerRunBox;
    private readonly NumericUpDown _delayMsBox;
    private readonly CheckBox _syncMatchesBox;
    private readonly NumericUpDown _matchesCountBox;
    private readonly Label _riotHintLabel;
    private readonly Button _saveButton;
    private readonly Button _startButton;
    private readonly Button _stopButton;

    public SettingsForm(
        Icon trayIcon,
        string baseDirectory,
        Func<AgentConfig, Task> saveAsync,
        Func<Task> startAsync,
        Func<Task> stopAsync)
    {
        _saveAsync = saveAsync;
        _startAsync = startAsync;
        _stopAsync = stopAsync;
        _baseDirectory = baseDirectory;

        Text = "RiftBoard Refresh";
        Icon = (Icon)trayIcon.Clone();
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        ClientSize = new Size(560, 520);

        FormClosing += (_, e) =>
        {
            if (_allowClose || e.CloseReason != CloseReason.UserClosing)
            {
                return;
            }

            e.Cancel = true;
            Hide();
        };

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(14),
            ColumnCount = 1,
            RowCount = 4,
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var titleLabel = new Label
        {
            AutoSize = true,
            Text = "RiftBoard Refresh Settings",
            Font = new Font(Font, FontStyle.Bold),
            Margin = new Padding(0, 0, 0, 8),
        };
        root.Controls.Add(titleLabel);

        var statusBox = new GroupBox
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            Text = "Live Status",
            Padding = new Padding(12, 14, 12, 12),
            Margin = new Padding(0, 0, 0, 10),
        };

        var statusTable = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 2,
        };
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        statusTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _statusValueLabel = AddStatusRow(statusTable, "Status");
        _progressValueLabel = AddStatusRow(statusTable, "Progress");
        _lastRunValueLabel = AddStatusRow(statusTable, "Last Run");
        _nextRunValueLabel = AddStatusRow(statusTable, "Next Run");
        statusBox.Controls.Add(statusTable);
        root.Controls.Add(statusBox);

        var settingsBox = new GroupBox
        {
            Dock = DockStyle.Fill,
            Text = "Refresh Controls",
            Padding = new Padding(12, 14, 12, 12),
        };

        var settingsTable = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 7,
        };
        settingsTable.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220));
        settingsTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        _intervalMinutesBox = CreateNumericBox(1, 120, 1);
        _playersPerRunBox = CreateNumericBox(1, 200, 5);
        _delayMsBox = CreateNumericBox(0, 5000, 100);
        _matchesCountBox = CreateNumericBox(1, 100, 1);
        _syncMatchesBox = new CheckBox
        {
            AutoSize = true,
            Text = "Also sync latest matches",
            Margin = new Padding(0, 3, 0, 3),
        };
        _riotHintLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(480, 0),
            Margin = new Padding(0, 8, 0, 0),
        };

        _intervalMinutesBox.ValueChanged += (_, _) => UpdateGuidance();
        _playersPerRunBox.ValueChanged += (_, _) => UpdateGuidance();
        _delayMsBox.ValueChanged += (_, _) => UpdateGuidance();
        _matchesCountBox.ValueChanged += (_, _) => UpdateGuidance();
        _syncMatchesBox.CheckedChanged += (_, _) =>
        {
            _matchesCountBox.Enabled = _syncMatchesBox.Checked;
            UpdateGuidance();
        };

        AddSettingRow(settingsTable, "Interval between runs (minutes)", _intervalMinutesBox);
        AddSettingRow(settingsTable, "Players refreshed each run", _playersPerRunBox);
        AddSettingRow(settingsTable, "Delay between players (ms)", _delayMsBox);
        AddSettingRow(settingsTable, "Latest matches per player", _matchesCountBox);
        AddSettingRow(settingsTable, "Match syncing", _syncMatchesBox);

        var noteLabel = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(480, 0),
            Text =
                "Riot-safe default is 5 players every 5 minutes with 900ms between players and 10 latest matches. Lower intervals or bigger batches create more Riot load.",
            Margin = new Padding(0, 10, 0, 0),
        };
        settingsTable.Controls.Add(noteLabel, 0, 5);
        settingsTable.SetColumnSpan(noteLabel, 2);
        settingsTable.Controls.Add(_riotHintLabel, 0, 6);
        settingsTable.SetColumnSpan(_riotHintLabel, 2);
        settingsBox.Controls.Add(settingsTable);
        root.Controls.Add(settingsBox);

        var buttonBar = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
            WrapContents = true,
            Margin = new Padding(0, 10, 0, 0),
        };

        var closeButton = new Button { AutoSize = true, Text = "Close" };
        closeButton.Click += (_, _) => Hide();

        _saveButton = new Button { AutoSize = true, Text = "Save" };
        _saveButton.Click += async (_, _) => await SaveFromFormAsync();

        _startButton = new Button { AutoSize = true, Text = "Start" };
        _startButton.Click += async (_, _) => await RunCommandAsync(_startAsync);

        _stopButton = new Button { AutoSize = true, Text = "Stop" };
        _stopButton.Click += async (_, _) => await RunCommandAsync(_stopAsync);

        var safeDefaultsButton = new Button { AutoSize = true, Text = "Use Safe Defaults" };
        safeDefaultsButton.Click += (_, _) =>
        {
            SetConfig(new AgentConfig());
            UpdateGuidance();
        };

        var openLogsButton = new Button { AutoSize = true, Text = "Open Folder" };
        openLogsButton.Click += (_, _) =>
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = $"\"{_baseDirectory}\"",
                UseShellExecute = true,
            });
        };

        buttonBar.Controls.Add(closeButton);
        buttonBar.Controls.Add(_saveButton);
        buttonBar.Controls.Add(_stopButton);
        buttonBar.Controls.Add(_startButton);
        buttonBar.Controls.Add(safeDefaultsButton);
        buttonBar.Controls.Add(openLogsButton);
        root.Controls.Add(buttonBar);

        Controls.Add(root);
    }

    public void SetConfig(AgentConfig config)
    {
        _config = config.Normalize();
        _intervalMinutesBox.Value = Math.Max(_intervalMinutesBox.Minimum, Math.Min(_intervalMinutesBox.Maximum, _config.IntervalSec / 60));
        _playersPerRunBox.Value = Math.Max(_playersPerRunBox.Minimum, Math.Min(_playersPerRunBox.Maximum, _config.Limit));
        _delayMsBox.Value = Math.Max(_delayMsBox.Minimum, Math.Min(_delayMsBox.Maximum, _config.DelayMs));
        _syncMatchesBox.Checked = _config.SyncMatches;
        _matchesCountBox.Value = Math.Max(_matchesCountBox.Minimum, Math.Min(_matchesCountBox.Maximum, _config.MatchesCount));
        _matchesCountBox.Enabled = _syncMatchesBox.Checked;
        UpdateGuidance();
    }

    public void UpdateStatus(string state, string progress, string lastRun, string nextRun)
    {
        _statusValueLabel.Text = state;
        _progressValueLabel.Text = progress;
        _lastRunValueLabel.Text = lastRun;
        _nextRunValueLabel.Text = nextRun;

        var running = !string.Equals(state, "Stopped", StringComparison.OrdinalIgnoreCase);
        _startButton.Enabled = !running;
        _stopButton.Enabled = running;
    }

    public void AllowClose()
    {
        _allowClose = true;
    }

    private async Task SaveFromFormAsync()
    {
        var updated = new AgentConfig
        {
            LocalAppUrl = _config.LocalAppUrl,
            CooldownMs = _config.CooldownMs,
            Force = _config.Force,
            StartupTimeoutSec = _config.StartupTimeoutSec,
            IntervalSec = Math.Max(60, (int)_intervalMinutesBox.Value * 60),
            Limit = (int)_playersPerRunBox.Value,
            DelayMs = (int)_delayMsBox.Value,
            SyncMatches = _syncMatchesBox.Checked,
            MatchesCount = _syncMatchesBox.Checked ? (int)_matchesCountBox.Value : _config.MatchesCount,
        };

        await RunCommandAsync(() => _saveAsync(updated));
    }

    private async Task RunCommandAsync(Func<Task> command)
    {
        SetBusy(true);
        try
        {
            await command();
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void SetBusy(bool busy)
    {
        UseWaitCursor = busy;
        _saveButton.Enabled = !busy;
    }

    private void UpdateGuidance()
    {
        var preview = new AgentConfig
        {
            LocalAppUrl = _config.LocalAppUrl,
            CooldownMs = _config.CooldownMs,
            Force = _config.Force,
            StartupTimeoutSec = _config.StartupTimeoutSec,
            IntervalSec = Math.Max(60, (int)_intervalMinutesBox.Value * 60),
            Limit = (int)_playersPerRunBox.Value,
            DelayMs = (int)_delayMsBox.Value,
            SyncMatches = _syncMatchesBox.Checked,
            MatchesCount = (int)_matchesCountBox.Value,
        }.Normalize();

        var runsPerHour = 3600d / Math.Max(60, preview.IntervalSec);
        var playersPerHour = runsPerHour * preview.Limit;
        var loadText = preview.SyncMatches
            ? $"{preview.MatchesCount} latest matches"
            : "rank-only refresh";

        string risk;
        Color color;
        if (preview.IntervalSec < 180 || preview.Limit > 10 || preview.DelayMs < 500 || (preview.SyncMatches && preview.MatchesCount > 15))
        {
            risk = "Higher Riot load";
            color = Color.IndianRed;
        }
        else if (preview.IntervalSec < 300 || preview.Limit > 5 || preview.DelayMs < 900)
        {
            risk = "Medium Riot load";
            color = Color.Goldenrod;
        }
        else
        {
            risk = "Gentle Riot load";
            color = Color.SeaGreen;
        }

        _riotHintLabel.ForeColor = color;
        _riotHintLabel.Text =
            $"{risk}. About {playersPerHour:0.#} players/hour, {preview.DelayMs}ms between players, {loadText}. This is a rough pacing guide, not Riot's exact request counter.";
    }

    private static NumericUpDown CreateNumericBox(decimal min, decimal max, decimal increment)
    {
        return new NumericUpDown
        {
            Minimum = min,
            Maximum = max,
            Increment = increment,
            ThousandsSeparator = true,
            Dock = DockStyle.Left,
            Width = 120,
        };
    }

    private static void AddSettingRow(TableLayoutPanel table, string label, Control control)
    {
        var rowIndex = table.RowCount > 0 ? table.Controls.Count / 2 : 0;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(new Label
        {
            AutoSize = true,
            Text = label,
            Margin = new Padding(0, 6, 12, 6),
        }, 0, rowIndex);
        table.Controls.Add(control, 1, rowIndex);
    }

    private static Label AddStatusRow(TableLayoutPanel table, string label)
    {
        var rowIndex = table.RowCount > 0 ? table.Controls.Count / 2 : 0;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(new Label
        {
            AutoSize = true,
            Text = label,
            Margin = new Padding(0, 4, 12, 4),
        }, 0, rowIndex);
        var valueLabel = new Label
        {
            AutoSize = true,
            Margin = new Padding(0, 4, 0, 4),
        };
        table.Controls.Add(valueLabel, 1, rowIndex);
        return valueLabel;
    }
}

internal sealed class RefreshLoop
{
    private readonly string _baseDirectory;
    private readonly string _repoRoot;
    private readonly AgentLogger _logger;
    private readonly Action<string, string, ToolTipIcon> _notify;
    private readonly Action<string> _updateState;
    private readonly Action<string> _updateProgress;
    private readonly Action<string?> _updateLastRun;
    private readonly Action<DateTimeOffset?> _updateNextRun;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private bool _lastTickFailed;

    public RefreshLoop(
        string baseDirectory,
        AgentLogger logger,
        Action<string, string, ToolTipIcon> notify,
        Action<string> updateState,
        Action<string> updateProgress,
        Action<string?> updateLastRun,
        Action<DateTimeOffset?> updateNextRun)
    {
        _baseDirectory = baseDirectory;
        _repoRoot = ResolveRepoRoot(baseDirectory);
        _logger = logger;
        _notify = notify;
        _updateState = updateState;
        _updateProgress = updateProgress;
        _updateLastRun = updateLastRun;
        _updateNextRun = updateNextRun;
    }

    public bool IsRunning => _cts is not null;

    public async Task StartAsync()
    {
        await _gate.WaitAsync();
        try
        {
            if (_cts is not null)
            {
                return;
            }

            _cts = new CancellationTokenSource();
            _loopTask = RunLoopAsync(_cts.Token);
            _updateState("running");
            _updateProgress("Waiting for the first refresh...");
            _updateNextRun(null);
            _notify("RiftBoard Refresh", "Running in the system tray.", ToolTipIcon.Info);
            _logger.Info("Refresh loop started.");
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopAsync()
    {
        Task? loopTask;

        await _gate.WaitAsync();
        try
        {
            if (_cts is null)
            {
                return;
            }

            _cts.Cancel();
            loopTask = _loopTask;
            _cts = null;
            _loopTask = null;
            _updateState("stopped");
            _updateProgress("Stopped");
            _updateNextRun(null);
            _logger.Info("Refresh loop stopping.");
        }
        finally
        {
            _gate.Release();
        }

        if (loopTask is not null)
        {
            try
            {
                await loopTask;
            }
            catch (OperationCanceledException)
            {
            }
        }

        _notify("RiftBoard Refresh", "Stopped.", ToolTipIcon.Info);
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var startedAt = DateTimeOffset.Now;
            var config = await AgentConfig.LoadAsync(Path.Combine(_baseDirectory, "config.json"), cancellationToken);
            _updateState("refreshing");
            _updateProgress($"Refreshing up to {config.Limit} players...");
            _updateNextRun(null);

            try
            {
                var result = await RunTickAsync(config, cancellationToken);
                _logger.Info(result.LogLine);
                _updateLastRun($"{DateTimeOffset.Now:hh:mm tt} - ok {result.Ok}, fail {result.Fail}, skip {result.Skipped}");
                _updateProgress("Waiting for next refresh...");

                if (_lastTickFailed)
                {
                    _notify("RiftBoard Refresh", "Refresh recovered and completed successfully.", ToolTipIcon.Info);
                }

                _lastTickFailed = false;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.Error(ex.ToString());
                _updateLastRun($"{DateTimeOffset.Now:hh:mm tt} - failed");
                _updateProgress($"Last error: {TrimForNotification(ex.Message)}");
                if (!_lastTickFailed)
                {
                    _notify("RiftBoard Refresh Failed", TrimForNotification(ex.Message), ToolTipIcon.Error);
                }

                _lastTickFailed = true;
            }

            var elapsed = DateTimeOffset.Now - startedAt;
            var delay = TimeSpan.FromSeconds(Math.Max(1, config.IntervalSec)) - elapsed;
            if (delay < TimeSpan.FromSeconds(1))
            {
                delay = TimeSpan.FromSeconds(1);
            }

            _updateState("running");
            _updateNextRun(DateTimeOffset.Now.Add(delay));
            await Task.Delay(delay, cancellationToken);
        }
    }

    private async Task<TickOutcome> RunTickAsync(AgentConfig config, CancellationToken cancellationToken)
    {
        _updateProgress("Checking local app...");
        var server = await StartStandaloneServerAsync(config, cancellationToken);
        try
        {
            using var client = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(Math.Max(10, config.StartupTimeoutSec)),
            };
            _updateProgress($"Calling refresh API for {config.Limit} players...");

            var route = new UriBuilder($"{server.AppUrl}/api/cron/leaderboard");
            var query = new List<string>
            {
                $"limit={config.Limit}",
                $"delayMs={config.DelayMs}",
            };

            if (config.CooldownMs is not null)
            {
                query.Add($"cooldownMs={config.CooldownMs.Value}");
            }

            if (config.Force)
            {
                query.Add("force=1");
            }

            if (config.SyncMatches)
            {
                query.Add("syncMatches=1");
                query.Add($"matchesCount={config.MatchesCount}");
            }

            route.Query = string.Join("&", query);

            using var response = await client.GetAsync(route.Uri, cancellationToken);
            var payload = await response.Content.ReadFromJsonAsync<CronResponse>(cancellationToken: cancellationToken);

            if (!response.IsSuccessStatusCode || payload?.Ok != true || payload.Result is null)
            {
                throw new InvalidOperationException(
                    $"Refresh failed ({(int)response.StatusCode}){(string.IsNullOrWhiteSpace(payload?.Error) ? string.Empty : $": {payload!.Error}")}");
            }

            _updateProgress($"Completed: ok {payload.Result.Ok}, fail {payload.Result.Fail}, skip {payload.Result.Skipped}");
            return new TickOutcome(payload.Result.Ok, payload.Result.Fail, payload.Result.Skipped, payload.Result.Scanned);
        }
        finally
        {
            if (server.StartedProcess is not null && !server.StartedProcess.HasExited)
            {
                StopProcessTree(server.StartedProcess.Id);
            }
        }
    }

    private async Task<StandaloneServer> StartStandaloneServerAsync(AgentConfig config, CancellationToken cancellationToken)
    {
        var configuredUri = new Uri(config.LocalAppUrl);
        if (await TestAppReadyAsync(configuredUri, cancellationToken))
        {
            _updateProgress("Using existing local app...");
            return new StandaloneServer(configuredUri.AbsoluteUri.TrimEnd('/'), null);
        }

        var effectiveUri = configuredUri;
        if (TestPortListening(configuredUri.Port))
        {
            effectiveUri = GetFreeAppUri(configuredUri);
            _logger.Info($"Port {configuredUri.Port} busy; using {effectiveUri} for hidden refresh server.");
        }

        var nodeExe = ResolveNodeExe();
        var nextCliPath = Path.Combine(_repoRoot, "node_modules", "next", "dist", "bin", "next");
        var buildIdPath = Path.Combine(_repoRoot, ".next", "BUILD_ID");
        var serverOutPath = Path.Combine(_baseDirectory, "server.out.log");
        var serverErrPath = Path.Combine(_baseDirectory, "server.err.log");

        if (!File.Exists(nextCliPath))
        {
            throw new FileNotFoundException($"Could not find Next.js CLI at {nextCliPath}. Run npm install first.");
        }

        if (!File.Exists(buildIdPath))
        {
            throw new FileNotFoundException($"Could not find a Next.js production build at {buildIdPath}. Run npm run build once.");
        }

        _updateProgress($"Starting hidden local app on port {effectiveUri.Port}...");
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = nodeExe,
                WorkingDirectory = _repoRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
            EnableRaisingEvents = true,
        };

        process.StartInfo.ArgumentList.Add(nextCliPath);
        process.StartInfo.ArgumentList.Add("start");
        process.StartInfo.ArgumentList.Add("-H");
        process.StartInfo.ArgumentList.Add("127.0.0.1");
        process.StartInfo.ArgumentList.Add("-p");
        process.StartInfo.ArgumentList.Add(effectiveUri.Port.ToString());

        Directory.CreateDirectory(_baseDirectory);
        using var serverOutWriter = new StreamWriter(serverOutPath, append: false);
        using var serverErrWriter = new StreamWriter(serverErrPath, append: false);

        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data is not null)
            {
                lock (serverOutWriter)
                {
                    serverOutWriter.WriteLine(args.Data);
                    serverOutWriter.Flush();
                }
            }
        };

        process.ErrorDataReceived += (_, args) =>
        {
            if (args.Data is not null)
            {
                lock (serverErrWriter)
                {
                    serverErrWriter.WriteLine(args.Data);
                    serverErrWriter.Flush();
                }
            }
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to start hidden refresh server.");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        var deadline = DateTimeOffset.Now.AddSeconds(Math.Max(10, config.StartupTimeoutSec));
        while (DateTimeOffset.Now < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (await TestAppReadyAsync(effectiveUri, cancellationToken))
            {
                _logger.Info($"Started hidden refresh server at {effectiveUri} (PID {process.Id}).");
                return new StandaloneServer(effectiveUri.AbsoluteUri.TrimEnd('/'), process);
            }

            if (process.HasExited)
            {
                break;
            }

            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
        }

        throw new InvalidOperationException($"Could not start hidden refresh server at {effectiveUri} within {config.StartupTimeoutSec}s.");
    }

    private static async Task<bool> TestAppReadyAsync(Uri uri, CancellationToken cancellationToken)
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            using var response = await client.GetAsync(uri, cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private static bool TestPortListening(int port)
    {
        try
        {
            var properties = IPGlobalProperties.GetIPGlobalProperties();
            return properties.GetActiveTcpListeners().Any(endpoint => endpoint.Port == port);
        }
        catch
        {
            return false;
        }
    }

    private static Uri GetFreeAppUri(Uri baseUri)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var builder = new UriBuilder(baseUri)
            {
                Port = port,
            };

            return builder.Uri;
        }
        finally
        {
            listener.Stop();
        }
    }

    private static string ResolveNodeExe()
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var segment in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(segment.Trim(), "node.exe");
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        var fallback = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "nodejs",
            "node.exe");

        if (File.Exists(fallback))
        {
            return fallback;
        }

        throw new FileNotFoundException("Could not find node.exe on PATH.");
    }

    private static string ResolveRepoRoot(string baseDirectory)
    {
        var current = new DirectoryInfo(baseDirectory);
        while (current is not null)
        {
            var packageJsonPath = Path.Combine(current.FullName, "package.json");
            var srcPath = Path.Combine(current.FullName, "src");
            if (File.Exists(packageJsonPath) && Directory.Exists(srcPath))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Could not resolve the RiftBoard repo root.");
    }

    private static void StopProcessTree(int processId)
    {
        using var taskkill = Process.Start(new ProcessStartInfo
        {
            FileName = "taskkill.exe",
            Arguments = $"/PID {processId} /T /F",
            UseShellExecute = false,
            CreateNoWindow = true,
        });

        taskkill?.WaitForExit(5000);
    }

    private static string TrimForNotification(string message)
    {
        return message.Length <= 220 ? message : $"{message[..220]}...";
    }
}

internal sealed record StandaloneServer(string AppUrl, Process? StartedProcess);

internal sealed record TickOutcome(int Ok, int Fail, int Skipped, int Scanned)
{
    public string LogLine => $"Refreshed {Ok} players, failed {Fail}, skipped {Skipped}, scanned {Scanned}.";
}

internal sealed class AgentLogger
{
    private readonly string _path;
    private readonly object _sync = new();

    public AgentLogger(string path)
    {
        _path = path;
    }

    public void Info(string message) => Write("INFO", message);

    public void Error(string message) => Write("ERROR", message);

    private void Write(string level, string message)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        lock (_sync)
        {
            File.AppendAllText(_path, $"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss}] {level} {message}{Environment.NewLine}");
        }
    }
}

internal sealed class SingleInstanceGuard : IDisposable
{
    private readonly Mutex _mutex;
    public bool IsPrimary { get; }

    public SingleInstanceGuard(string name)
    {
        _mutex = new Mutex(true, name, out var createdNew);
        IsPrimary = createdNew;
    }

    public void Dispose()
    {
        if (IsPrimary)
        {
            _mutex.ReleaseMutex();
        }

        _mutex.Dispose();
    }
}

internal sealed class AgentConfig
{
    public string LocalAppUrl { get; init; } = "http://127.0.0.1:43117";
    public int Limit { get; init; } = 5;
    public int DelayMs { get; init; } = 900;
    public int IntervalSec { get; init; } = 300;
    public int? CooldownMs { get; init; }
    public bool Force { get; init; }
    public bool SyncMatches { get; init; } = true;
    public int MatchesCount { get; init; } = 10;
    public int StartupTimeoutSec { get; init; } = 45;

    public AgentConfig Normalize()
    {
        return new AgentConfig
        {
            LocalAppUrl = NormalizeLocalAppUrl(LocalAppUrl),
            Limit = Math.Max(1, Math.Min(200, Limit)),
            DelayMs = Math.Max(0, Math.Min(5000, DelayMs)),
            IntervalSec = Math.Max(60, Math.Min(24 * 60 * 60, IntervalSec)),
            CooldownMs = CooldownMs is null ? null : Math.Max(0, Math.Min(60 * 60 * 1000, CooldownMs.Value)),
            Force = Force,
            SyncMatches = SyncMatches,
            MatchesCount = Math.Max(1, Math.Min(100, MatchesCount)),
            StartupTimeoutSec = Math.Max(10, Math.Min(120, StartupTimeoutSec)),
        };
    }

    public static AgentConfig LoadOrCreate(string path)
    {
        if (!File.Exists(path))
        {
            var defaults = new AgentConfig().Normalize();
            File.WriteAllText(path, JsonSerializer.Serialize(defaults, JsonOptions));
            return defaults;
        }

        var config = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(path), JsonOptions) ?? new AgentConfig();
        return config.Normalize();
    }

    public static async Task<AgentConfig> LoadAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            var defaults = new AgentConfig().Normalize();
            var json = JsonSerializer.Serialize(defaults, JsonOptions);
            await File.WriteAllTextAsync(path, json, cancellationToken);
            return defaults;
        }

        await using var stream = File.OpenRead(path);
        var config = await JsonSerializer.DeserializeAsync<AgentConfig>(stream, JsonOptions, cancellationToken);
        return (config ?? new AgentConfig()).Normalize();
    }

    public async Task SaveAsync(string path, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(Normalize(), JsonOptions);
        await File.WriteAllTextAsync(path, json, cancellationToken);
    }

    private static string NormalizeLocalAppUrl(string? raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri))
        {
            return "http://127.0.0.1:43117";
        }

        return uri.AbsoluteUri.TrimEnd('/');
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };
}

internal sealed class CronResponse
{
    public bool Ok { get; init; }
    public string? Error { get; init; }
    public CronResult? Result { get; init; }
}

internal sealed class CronResult
{
    public int Ok { get; init; }
    public int Fail { get; init; }
    public int Skipped { get; init; }
    public int Scanned { get; init; }
}
