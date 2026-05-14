using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;
using MongoDB.Bson;
using MongoDB.Driver;

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
    private string _current = "Idle";
    private string _rankStatus = "Not run yet";
    private string _tftStatus = "Not run yet";
    private string _liveStatus = "Not run yet";
    private string _rankLast = "None yet";
    private string _tftLast = "None yet";
    private string _liveLast = "None yet";
    private string _rankNext = "Pending";
    private string _tftNext = "Pending";
    private string _liveNext = "Pending";
    private string _lastError = "None";

    public TrayContext()
    {
        if (SynchronizationContext.Current is null)
        {
            SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        }

        _uiContext = SynchronizationContext.Current!;
        _baseDirectory = AppContext.BaseDirectory;
        _configPath = Path.Combine(_baseDirectory, "config.json");
        _trayIcon = LoadTrayIcon(_baseDirectory)
            ?? Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath)
            ?? (Icon)SystemIcons.Application.Clone();

        _loop = new RefreshLoop(
            _baseDirectory,
            ShowNotification,
            UpdateState,
            UpdateCurrent,
            UpdateRankStatus,
            UpdateTftStatus,
            UpdateLiveStatus,
            UpdateRankLast,
            UpdateTftLast,
            UpdateLiveLast,
            UpdateRankNext,
            UpdateTftNext,
            UpdateLiveNext,
            UpdateLastError);

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

    private Task StartLoopAsync() => _loop.StartAsync();

    private Task StopLoopAsync() => _loop.StopAsync();

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

    private void UpdateState(string state) => PostUi(() =>
    {
        _state = state;
        SyncTrayPresentation();
        PushStatusToSettingsForm();
    });

    private void UpdateCurrent(string current) => PostUi(() =>
    {
        _current = current;
        SyncTrayPresentation();
        PushStatusToSettingsForm();
    });

    private void UpdateRankStatus(string status) => PostUi(() =>
    {
        _rankStatus = status;
        PushStatusToSettingsForm();
    });

    private void UpdateTftStatus(string status) => PostUi(() =>
    {
        _tftStatus = status;
        PushStatusToSettingsForm();
    });

    private void UpdateLiveStatus(string status) => PostUi(() =>
    {
        _liveStatus = status;
        PushStatusToSettingsForm();
    });

    private void UpdateRankLast(string value) => PostUi(() =>
    {
        _rankLast = value;
        PushStatusToSettingsForm();
    });

    private void UpdateTftLast(string value) => PostUi(() =>
    {
        _tftLast = value;
        PushStatusToSettingsForm();
    });

    private void UpdateLiveLast(string value) => PostUi(() =>
    {
        _liveLast = value;
        PushStatusToSettingsForm();
    });

    private void UpdateRankNext(DateTimeOffset? value) => PostUi(() =>
    {
        _rankNext = value?.ToString("hh:mm tt") ?? "Pending";
        SyncTrayPresentation();
        PushStatusToSettingsForm();
    });

    private void UpdateTftNext(DateTimeOffset? value) => PostUi(() =>
    {
        _tftNext = value?.ToString("hh:mm tt") ?? "Pending";
        SyncTrayPresentation();
        PushStatusToSettingsForm();
    });

    private void UpdateLiveNext(DateTimeOffset? value) => PostUi(() =>
    {
        _liveNext = value?.ToString("hh:mm tt") ?? "Pending";
        SyncTrayPresentation();
        PushStatusToSettingsForm();
    });

    private void UpdateLastError(string error) => PostUi(() =>
    {
        _lastError = error;
        PushStatusToSettingsForm();
    });

    private void PostUi(Action action) => _uiContext.Post(_ => action(), null);

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

        if (!string.Equals(_current, "Idle", StringComparison.OrdinalIgnoreCase))
        {
            return $"RiftBoard Refresh - {_current}";
        }

        return $"RiftBoard Refresh - Rank {_rankNext}, TFT {_tftNext}, Live {_liveNext}";
    }

    private static string ToTitleCase(string value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? "Unknown"
            : char.ToUpperInvariant(value[0]) + value[1..].ToLowerInvariant();
    }

    private static string TrimForMenu(string value)
    {
        return value.Length <= 180 ? value : $"{value[..177]}...";
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
        ShowNotification("RiftBoard Refresh", "Settings saved. Changes apply on the next job cycle.", ToolTipIcon.Info);
    }

    private void PushConfigToSettingsForm(AgentConfig config)
    {
        _settingsForm?.SetConfig(config);
    }

    private void PushStatusToSettingsForm()
    {
        _settingsForm?.UpdateStatus(new TrayStatus
        {
            State = ToTitleCase(_state),
            Current = TrimForMenu(_current),
            RankStatus = TrimForMenu(_rankStatus),
            TftStatus = TrimForMenu(_tftStatus),
            LiveStatus = TrimForMenu(_liveStatus),
            RankLast = TrimForMenu(_rankLast),
            TftLast = TrimForMenu(_tftLast),
            LiveLast = TrimForMenu(_liveLast),
            RankNext = _rankNext,
            TftNext = _tftNext,
            LiveNext = _liveNext,
            Error = TrimForMenu(_lastError),
        });
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
    private readonly Label _stateLabel;
    private readonly Label _currentLabel;
    private readonly Label _rankStatusLabel;
    private readonly Label _rankLastLabel;
    private readonly Label _rankNextLabel;
    private readonly Label _tftStatusLabel;
    private readonly Label _tftLastLabel;
    private readonly Label _tftNextLabel;
    private readonly Label _liveStatusLabel;
    private readonly Label _liveLastLabel;
    private readonly Label _liveNextLabel;
    private readonly Label _errorLabel;
    private readonly CheckBox _rankEnabledBox;
    private readonly CheckBox _rankMatchesBox;
    private readonly NumericUpDown _rankIntervalBox;
    private readonly NumericUpDown _rankLimitBox;
    private readonly NumericUpDown _rankDelayBox;
    private readonly NumericUpDown _rankMatchesCountBox;
    private readonly CheckBox _tftEnabledBox;
    private readonly NumericUpDown _tftIntervalBox;
    private readonly NumericUpDown _tftLimitBox;
    private readonly NumericUpDown _tftDelayBox;
    private readonly NumericUpDown _tftMatchesCountBox;
    private readonly CheckBox _liveEnabledBox;
    private readonly NumericUpDown _liveIntervalBox;
    private readonly NumericUpDown _liveLimitBox;
    private readonly NumericUpDown _liveDelayBox;
    private readonly NumericUpDown _liveMatchesCountBox;
    private readonly Label _rankHintLabel;
    private readonly Label _tftHintLabel;
    private readonly Label _liveHintLabel;
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
        ClientSize = new Size(1120, 720);

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
            Padding = new Padding(16),
            ColumnCount = 1,
            RowCount = 5,
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 12) };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.Controls.Add(new Label
        {
            AutoSize = true,
            Text = "RiftBoard Refresh",
            Font = new Font(Font.FontFamily, 14, FontStyle.Bold),
        }, 0, 0);
        _stateLabel = new Label
        {
            AutoSize = true,
            TextAlign = ContentAlignment.MiddleRight,
            Font = new Font(Font, FontStyle.Bold),
            ForeColor = Color.SteelBlue,
            Margin = new Padding(0, 4, 0, 0),
        };
        header.Controls.Add(_stateLabel, 1, 0);
        root.Controls.Add(header, 0, 0);

        var runBox = new GroupBox { Dock = DockStyle.Top, AutoSize = true, Text = "Run", Padding = new Padding(12, 14, 12, 12), Margin = new Padding(0, 0, 0, 10) };
        var runGrid = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 4 };
        runGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        runGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        runGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        runGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        _currentLabel = AddMetric(runGrid, "Current");
        _rankNextLabel = AddMetric(runGrid, "Rank next");
        _tftNextLabel = AddMetric(runGrid, "TFT next");
        _liveNextLabel = AddMetric(runGrid, "Live next");
        runBox.Controls.Add(runGrid);
        root.Controls.Add(runBox, 0, 1);

        var jobsGrid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3 };
        jobsGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));
        jobsGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
        jobsGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));

        var rankJob = CreateJobPanel("Rank / LoL", "Direct Riot API + MongoDB", new Padding(0, 0, 8, 0));
        _rankStatusLabel = rankJob.Status;
        _rankLastLabel = rankJob.Last;
        _rankEnabledBox = rankJob.Enabled;
        _rankMatchesBox = new CheckBox { AutoSize = true, Text = "Fetch LoL matches", Margin = new Padding(0, 5, 0, 5) };
        _rankIntervalBox = rankJob.Interval;
        _rankLimitBox = rankJob.Limit;
        _rankDelayBox = rankJob.Delay;
        _rankMatchesCountBox = rankJob.Matches;
        _rankHintLabel = rankJob.Hint;
        rankJob.Settings.Controls.Add(_rankMatchesBox, 0, 4);
        rankJob.Settings.SetColumnSpan(_rankMatchesBox, 2);
        jobsGrid.Controls.Add(rankJob.Panel, 0, 0);

        var tftJob = CreateJobPanel("TFT Matches", "Direct Riot API + MongoDB", new Padding(4, 0, 4, 0));
        _tftStatusLabel = tftJob.Status;
        _tftLastLabel = tftJob.Last;
        _tftEnabledBox = tftJob.Enabled;
        _tftIntervalBox = tftJob.Interval;
        _tftLimitBox = tftJob.Limit;
        _tftDelayBox = tftJob.Delay;
        _tftMatchesCountBox = tftJob.Matches;
        _tftHintLabel = tftJob.Hint;
        jobsGrid.Controls.Add(tftJob.Panel, 1, 0);

        var liveJob = CreateJobPanel("Live Games", "Spectator API + Discord channel", new Padding(8, 0, 0, 0));
        _liveStatusLabel = liveJob.Status;
        _liveLastLabel = liveJob.Last;
        _liveEnabledBox = liveJob.Enabled;
        _liveIntervalBox = liveJob.Interval;
        _liveLimitBox = liveJob.Limit;
        _liveDelayBox = liveJob.Delay;
        _liveMatchesCountBox = liveJob.Matches;
        _liveMatchesCountBox.Enabled = false;
        _liveHintLabel = liveJob.Hint;
        jobsGrid.Controls.Add(liveJob.Panel, 2, 0);
        root.Controls.Add(jobsGrid, 0, 2);

        foreach (var control in new Control[]
        {
            _rankEnabledBox, _rankMatchesBox, _rankIntervalBox, _rankLimitBox, _rankDelayBox, _rankMatchesCountBox,
            _tftEnabledBox, _tftIntervalBox, _tftLimitBox, _tftDelayBox, _tftMatchesCountBox,
            _liveEnabledBox, _liveIntervalBox, _liveLimitBox, _liveDelayBox,
        })
        {
            if (control is NumericUpDown numeric)
            {
                numeric.ValueChanged += (_, _) => UpdateGuidance();
            }
            else if (control is CheckBox checkBox)
            {
                checkBox.CheckedChanged += (_, _) => UpdateGuidance();
            }
        }

        _errorLabel = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Fill,
            Height = 28,
            TextAlign = ContentAlignment.MiddleLeft,
            ForeColor = Color.Firebrick,
            AutoEllipsis = true,
        };
        root.Controls.Add(_errorLabel, 0, 3);

        var buttonBar = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
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
        var safeDefaultsButton = new Button { AutoSize = true, Text = "Safe Defaults" };
        safeDefaultsButton.Click += (_, _) =>
        {
            SetConfig(new AgentConfig
            {
                StartupTimeoutSec = _config.StartupTimeoutSec,
                LocalAppUrl = _config.LocalAppUrl,
            });
        };
        var openLogsButton = new Button { AutoSize = true, Text = "Folder" };
        openLogsButton.Click += (_, _) => OpenFolder(_baseDirectory);
        var rankLogButton = new Button { AutoSize = true, Text = "Rank Log" };
        rankLogButton.Click += (_, _) => ShowLogDialog(Path.Combine(_baseDirectory, "rank.log"), "Rank / LoL Log");
        var tftLogButton = new Button { AutoSize = true, Text = "TFT Log" };
        tftLogButton.Click += (_, _) => ShowLogDialog(Path.Combine(_baseDirectory, "tft.log"), "TFT Log");
        var liveLogButton = new Button { AutoSize = true, Text = "Live Log" };
        liveLogButton.Click += (_, _) => ShowLogDialog(Path.Combine(_baseDirectory, "live.log"), "Live Games Log");

        buttonBar.Controls.Add(closeButton);
        buttonBar.Controls.Add(_saveButton);
        buttonBar.Controls.Add(_stopButton);
        buttonBar.Controls.Add(_startButton);
        buttonBar.Controls.Add(safeDefaultsButton);
        buttonBar.Controls.Add(openLogsButton);
        buttonBar.Controls.Add(rankLogButton);
        buttonBar.Controls.Add(tftLogButton);
        buttonBar.Controls.Add(liveLogButton);
        root.Controls.Add(buttonBar, 0, 4);

        Controls.Add(root);
    }

    public void SetConfig(AgentConfig config)
    {
        _config = config.Normalize();
        SetJobConfig(_config.RankJob, _rankEnabledBox, _rankIntervalBox, _rankLimitBox, _rankDelayBox, _rankMatchesCountBox);
        _rankMatchesBox.Checked = _config.RankJob.SyncMatches;
        SetJobConfig(_config.TftJob, _tftEnabledBox, _tftIntervalBox, _tftLimitBox, _tftDelayBox, _tftMatchesCountBox);
        SetJobConfig(_config.LiveJob, _liveEnabledBox, _liveIntervalBox, _liveLimitBox, _liveDelayBox, _liveMatchesCountBox);
        UpdateGuidance();
    }

    public void UpdateStatus(TrayStatus status)
    {
        _stateLabel.Text = status.State;
        _currentLabel.Text = status.Current;
        _rankStatusLabel.Text = status.RankStatus;
        _rankLastLabel.Text = status.RankLast;
        _rankNextLabel.Text = status.RankNext;
        _tftStatusLabel.Text = status.TftStatus;
        _tftLastLabel.Text = status.TftLast;
        _tftNextLabel.Text = status.TftNext;
        _liveStatusLabel.Text = status.LiveStatus;
        _liveLastLabel.Text = status.LiveLast;
        _liveNextLabel.Text = status.LiveNext;
        _errorLabel.Text = status.Error;

        var running = !string.Equals(status.State, "Stopped", StringComparison.OrdinalIgnoreCase);
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
            StartupTimeoutSec = _config.StartupTimeoutSec,
            RankJob = BuildJobConfig(_rankEnabledBox, _rankIntervalBox, _rankLimitBox, _rankDelayBox, _rankMatchesCountBox) with
            {
                SyncMatches = _rankMatchesBox.Checked,
                SyncTftMatches = false,
            },
            TftJob = BuildJobConfig(_tftEnabledBox, _tftIntervalBox, _tftLimitBox, _tftDelayBox, _tftMatchesCountBox) with
            {
                SyncMatches = false,
                SyncTftMatches = true,
            },
            LiveJob = BuildJobConfig(_liveEnabledBox, _liveIntervalBox, _liveLimitBox, _liveDelayBox, _liveMatchesCountBox) with
            {
                SyncMatches = false,
                SyncTftMatches = false,
                MatchesCount = 1,
            },
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
        UpdateJobGuidance(BuildJobConfig(_rankEnabledBox, _rankIntervalBox, _rankLimitBox, _rankDelayBox, _rankMatchesCountBox), _rankHintLabel, _rankMatchesBox.Checked ? "LoL matches" : "rank only");
        UpdateJobGuidance(BuildJobConfig(_tftEnabledBox, _tftIntervalBox, _tftLimitBox, _tftDelayBox, _tftMatchesCountBox), _tftHintLabel, "TFT matches");
        UpdateJobGuidance(BuildJobConfig(_liveEnabledBox, _liveIntervalBox, _liveLimitBox, _liveDelayBox, _liveMatchesCountBox), _liveHintLabel, "live checks");
    }

    private static void SetJobConfig(JobConfig config, CheckBox enabled, NumericUpDown interval, NumericUpDown limit, NumericUpDown delay, NumericUpDown matches)
    {
        enabled.Checked = config.Enabled;
        interval.Value = ClampDecimal(config.IntervalSec / 60, interval.Minimum, interval.Maximum);
        limit.Value = ClampDecimal(config.Limit, limit.Minimum, limit.Maximum);
        delay.Value = ClampDecimal(config.DelayMs, delay.Minimum, delay.Maximum);
        matches.Value = ClampDecimal(config.MatchesCount, matches.Minimum, matches.Maximum);
    }

    private static JobConfig BuildJobConfig(CheckBox enabled, NumericUpDown interval, NumericUpDown limit, NumericUpDown delay, NumericUpDown matches)
    {
        return new JobConfig
        {
            Enabled = enabled.Checked,
            IntervalSec = Math.Max(60, (int)interval.Value * 60),
            Limit = (int)limit.Value,
            DelayMs = (int)delay.Value,
            MatchesCount = (int)matches.Value,
        }.Normalize();
    }

    private static decimal ClampDecimal(decimal value, decimal min, decimal max)
    {
        return Math.Max(min, Math.Min(max, value));
    }

    private static void UpdateJobGuidance(JobConfig config, Label label, string kind)
    {
        if (!config.Enabled)
        {
            label.ForeColor = Color.DimGray;
            label.Text = "Off";
            return;
        }

        var runsPerHour = 3600d / Math.Max(60, config.IntervalSec);
        var playersPerHour = runsPerHour * config.Limit;
        var color = config.IntervalSec < 180 || config.Limit > 10 || config.DelayMs < 500 || config.MatchesCount > 20
            ? Color.IndianRed
            : config.IntervalSec < 300 || config.Limit > 5 || config.DelayMs < 900
                ? Color.Goldenrod
                : Color.SeaGreen;
        label.ForeColor = color;
        label.Text = $"{playersPerHour:0.#} players/hour | {config.DelayMs}ms delay | {config.MatchesCount} {kind}";
    }

    private static NumericUpDown CreateNumericBox(decimal min, decimal max, decimal increment)
    {
        return new NumericUpDown
        {
            Minimum = min,
            Maximum = max,
            Increment = increment,
            ThousandsSeparator = true,
            Dock = DockStyle.Fill,
            Width = 110,
        };
    }

    private JobPanel CreateJobPanel(string title, string endpoint, Padding margin)
    {
        var panel = new GroupBox
        {
            Dock = DockStyle.Fill,
            Text = title,
            Padding = new Padding(14, 16, 14, 12),
            Margin = margin,
        };
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        root.Controls.Add(new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 22,
            Text = endpoint,
            ForeColor = Color.DimGray,
            AutoEllipsis = true,
        }, 0, 0);

        var statusGrid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 4, 0, 10) };
        statusGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        statusGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        var status = AddMetric(statusGrid, "Status");
        var last = AddMetric(statusGrid, "Last");
        root.Controls.Add(statusGrid, 0, 1);

        var settings = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
        settings.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
        var enabled = new CheckBox { AutoSize = true, Text = "Enabled", Margin = new Padding(0, 4, 0, 4) };
        var interval = CreateNumericBox(1, 1440, 1);
        var limit = CreateNumericBox(1, 200, 1);
        var delay = CreateNumericBox(0, 5000, 100);
        var matches = CreateNumericBox(1, 100, 1);
        AddSettingRow(settings, "Interval minutes", interval, 0);
        AddSettingRow(settings, "Players per batch", limit, 1);
        AddSettingRow(settings, "Delay ms", delay, 2);
        AddSettingRow(settings, "Matches per player", matches, 3);
        root.Controls.Add(settings, 0, 2);

        var footer = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var hint = new Label { AutoSize = true, MaximumSize = new Size(350, 0), Margin = new Padding(12, 6, 0, 0) };
        footer.Controls.Add(enabled, 0, 0);
        footer.Controls.Add(hint, 1, 0);
        root.Controls.Add(footer, 0, 3);
        panel.Controls.Add(root);

        return new JobPanel(panel, status, last, enabled, interval, limit, delay, matches, hint, settings);
    }

    private Label AddMetric(TableLayoutPanel table, string label)
    {
        var cell = new Panel { Dock = DockStyle.Fill, Height = 48, Margin = new Padding(0, 0, 10, 0) };
        cell.Controls.Add(new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 18,
            Text = label,
            ForeColor = Color.DimGray,
        });
        var value = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Bottom,
            Height = 26,
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font(Font, FontStyle.Bold),
            AutoEllipsis = true,
        };
        cell.Controls.Add(value);
        table.Controls.Add(cell);
        return value;
    }

    private static void AddSettingRow(TableLayoutPanel table, string label, Control control, int row)
    {
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(new Label { AutoSize = true, Text = label, Margin = new Padding(0, 7, 12, 4) }, 0, row);
        table.Controls.Add(control, 1, row);
    }

    private static void OpenFolder(string path)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"\"{path}\"",
            UseShellExecute = true,
        });
    }

    private void ShowLogDialog(string logPath, string title)
    {
        var logText = "(No log found)";
        try
        {
            if (File.Exists(logPath))
            {
                var lines = File.ReadAllLines(logPath);
                logText = string.Join(Environment.NewLine, lines.Skip(Math.Max(0, lines.Length - 200)));
            }
        }
        catch (Exception ex)
        {
            logText = $"Error reading log: {ex.Message}";
        }

        using var dialog = new Form
        {
            Text = title,
            Size = new Size(800, 500),
            StartPosition = FormStartPosition.CenterParent,
        };
        dialog.Controls.Add(new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Both,
            Font = new Font(FontFamily.GenericMonospace, 9),
            Text = logText,
        });
        dialog.ShowDialog(this);
    }
}

internal sealed class RefreshLoop
{
    private readonly string _baseDirectory;
    private readonly string _repoRoot;
    private readonly AgentLogger _rankLogger;
    private readonly AgentLogger _tftLogger;
    private readonly AgentLogger _liveLogger;
    private readonly AgentLogger _agentLogger;
    private readonly Action<string, string, ToolTipIcon> _notify;
    private readonly Action<string> _updateState;
    private readonly Action<string> _updateCurrent;
    private readonly Action<string> _updateRankStatus;
    private readonly Action<string> _updateTftStatus;
    private readonly Action<string> _updateLiveStatus;
    private readonly Action<string> _updateRankLast;
    private readonly Action<string> _updateTftLast;
    private readonly Action<string> _updateLiveLast;
    private readonly Action<DateTimeOffset?> _updateRankNext;
    private readonly Action<DateTimeOffset?> _updateTftNext;
    private readonly Action<DateTimeOffset?> _updateLiveNext;
    private readonly Action<string> _updateLastError;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private CancellationTokenSource? _cts;
    private Task? _rankTask;
    private Task? _tftTask;
    private Task? _liveTask;
    private bool _lastRankFailed;
    private bool _lastTftFailed;
    private bool _lastLiveFailed;

    public RefreshLoop(
        string baseDirectory,
        Action<string, string, ToolTipIcon> notify,
        Action<string> updateState,
        Action<string> updateCurrent,
        Action<string> updateRankStatus,
        Action<string> updateTftStatus,
        Action<string> updateLiveStatus,
        Action<string> updateRankLast,
        Action<string> updateTftLast,
        Action<string> updateLiveLast,
        Action<DateTimeOffset?> updateRankNext,
        Action<DateTimeOffset?> updateTftNext,
        Action<DateTimeOffset?> updateLiveNext,
        Action<string> updateLastError)
    {
        _baseDirectory = baseDirectory;
        _repoRoot = ResolveRepoRoot(baseDirectory);
        _rankLogger = new AgentLogger(Path.Combine(_baseDirectory, "rank.log"));
        _tftLogger = new AgentLogger(Path.Combine(_baseDirectory, "tft.log"));
        _liveLogger = new AgentLogger(Path.Combine(_baseDirectory, "live.log"));
        _agentLogger = new AgentLogger(Path.Combine(_baseDirectory, "app.log"));
        _notify = notify;
        _updateState = updateState;
        _updateCurrent = updateCurrent;
        _updateRankStatus = updateRankStatus;
        _updateTftStatus = updateTftStatus;
        _updateLiveStatus = updateLiveStatus;
        _updateRankLast = updateRankLast;
        _updateTftLast = updateTftLast;
        _updateLiveLast = updateLiveLast;
        _updateRankNext = updateRankNext;
        _updateTftNext = updateTftNext;
        _updateLiveNext = updateLiveNext;
        _updateLastError = updateLastError;
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
            _rankTask = RunJobAsync(RefreshJob.Rank, _cts.Token);
            _tftTask = RunJobAsync(RefreshJob.Tft, _cts.Token);
            _liveTask = RunJobAsync(RefreshJob.Live, _cts.Token);
            _updateState("running");
            _updateCurrent("Idle");
            _agentLogger.Info("Refresh jobs started.");
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopAsync()
    {
        Task? rankTask;
        Task? tftTask;
        Task? liveTask;

        await _gate.WaitAsync();
        try
        {
            if (_cts is null)
            {
                return;
            }

            _cts.Cancel();
            rankTask = _rankTask;
            tftTask = _tftTask;
            liveTask = _liveTask;
            _cts = null;
            _rankTask = null;
            _tftTask = null;
            _liveTask = null;
            _updateState("stopped");
            _updateCurrent("Stopped");
            _updateRankNext(null);
            _updateTftNext(null);
            _updateLiveNext(null);
            _agentLogger.Info("Refresh jobs stopping.");
        }
        finally
        {
            _gate.Release();
        }

        if (rankTask is not null)
        {
            try { await rankTask; } catch (OperationCanceledException) { }
        }

        if (tftTask is not null)
        {
            try { await tftTask; } catch (OperationCanceledException) { }
        }

        if (liveTask is not null)
        {
            try { await liveTask; } catch (OperationCanceledException) { }
        }
    }

    private async Task RunJobAsync(RefreshJob job, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var config = await AgentConfig.LoadAsync(Path.Combine(_baseDirectory, "config.json"), cancellationToken);
            var jobConfig = JobConfigFor(config, job);
            var updateStatus = StatusUpdater(job);
            var updateLast = LastUpdater(job);
            var updateNext = NextUpdater(job);
            var logger = LoggerFor(job);

            if (!jobConfig.Enabled)
            {
                updateStatus("Off");
                updateNext(null);
                await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken);
                continue;
            }

            var startedAt = DateTimeOffset.Now;
            updateNext(null);
            updateStatus($"{JobLabel(job)} - queued");
            _updateLastError("None");

            try
            {
                var result = await RunTickJobAsync(job, config, jobConfig, cancellationToken);
                logger.Info(result.LogLine);
                updateStatus(FormatPhaseStatus(result));
                updateLast($"{DateTimeOffset.Now:hh:mm tt} - {result.Ok} saved, {result.Skipped} unchanged{(result.Fail > 0 ? $", {result.Fail} failed" : string.Empty)}");
                SetFailureState(job, result.Fail > 0, result.ErrorSummary ?? result.LogLine);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.Error(ex.ToString());
                updateStatus($"Failed - {ex.Message}");
                updateLast($"{DateTimeOffset.Now:hh:mm tt} - failed");
                _updateLastError(ex.Message);
                SetFailureState(job, true, ex.Message);
            }

            var elapsed = DateTimeOffset.Now - startedAt;
            var delay = TimeSpan.FromSeconds(Math.Max(60, jobConfig.IntervalSec)) - elapsed;
            if (delay < TimeSpan.FromSeconds(1))
            {
                delay = TimeSpan.FromSeconds(1);
            }

            _updateState("running");
            _updateCurrent("Idle");
            updateNext(DateTimeOffset.Now.Add(delay));
            await Task.Delay(delay, cancellationToken);
        }
    }

    private void SetFailureState(RefreshJob job, bool failed, string message)
    {
        if (job == RefreshJob.Rank)
        {
            if (failed && !_lastRankFailed)
            {
                _notify("RiftBoard Rank Failed", TrimForNotification(message), ToolTipIcon.Error);
            }
            _lastRankFailed = failed;
            return;
        }

        if (job == RefreshJob.Tft)
        {
            if (failed && !_lastTftFailed)
            {
                _notify("RiftBoard TFT Failed", TrimForNotification(message), ToolTipIcon.Error);
            }
            _lastTftFailed = failed;
            return;
        }

        if (failed && !_lastLiveFailed)
        {
            _notify("RiftBoard Live Games Failed", TrimForNotification(message), ToolTipIcon.Error);
        }
        _lastLiveFailed = failed;
    }

    private async Task<TickOutcome> RunTickJobAsync(RefreshJob job, AgentConfig config, JobConfig jobConfig, CancellationToken cancellationToken)
    {
        _updateCurrent(JobLabel(job));
        var result = await new CSharpRefreshService(_repoRoot).RefreshAsync(job, jobConfig, cancellationToken);

        return new TickOutcome(
            result.Ok,
            result.Fail,
            result.Skipped,
            result.Scanned,
            BuildCronPlayerSummary(result.Players),
            PrefixError(JobLabel(job), BuildCronErrorSummary(result.Errors)));
    }

    private static string JobLabel(RefreshJob job)
    {
        return job switch
        {
            RefreshJob.Rank => "Rank / LoL",
            RefreshJob.Tft => "TFT Matches",
            _ => "Live Games",
        };
    }

    private JobConfig JobConfigFor(AgentConfig config, RefreshJob job) =>
        job switch
        {
            RefreshJob.Rank => config.RankJob,
            RefreshJob.Tft => config.TftJob,
            _ => config.LiveJob,
        };

    private Action<string> StatusUpdater(RefreshJob job) =>
        job switch
        {
            RefreshJob.Rank => _updateRankStatus,
            RefreshJob.Tft => _updateTftStatus,
            _ => _updateLiveStatus,
        };

    private Action<string> LastUpdater(RefreshJob job) =>
        job switch
        {
            RefreshJob.Rank => _updateRankLast,
            RefreshJob.Tft => _updateTftLast,
            _ => _updateLiveLast,
        };

    private Action<DateTimeOffset?> NextUpdater(RefreshJob job) =>
        job switch
        {
            RefreshJob.Rank => _updateRankNext,
            RefreshJob.Tft => _updateTftNext,
            _ => _updateLiveNext,
        };

    private AgentLogger LoggerFor(RefreshJob job) =>
        job switch
        {
            RefreshJob.Rank => _rankLogger,
            RefreshJob.Tft => _tftLogger,
            _ => _liveLogger,
        };

    private static string FormatPhaseStatus(TickOutcome outcome)
    {
        var baseText = outcome.Fail > 0
            ? $"{outcome.Scanned} scanned | {outcome.Ok} saved | {outcome.Fail} failed | {outcome.Skipped} unchanged"
            : $"{outcome.Scanned} scanned | {outcome.Ok} saved | {outcome.Skipped} unchanged";
        var detail = string.IsNullOrWhiteSpace(outcome.ErrorSummary) ? outcome.PlayerSummary : outcome.ErrorSummary;
        return string.IsNullOrWhiteSpace(detail) ? baseText : $"{baseText} - {detail}";
    }

    private static string? BuildCronErrorSummary(IReadOnlyList<CronError>? errors)
    {
        if (errors is null || errors.Count == 0)
        {
            return null;
        }

        var parts = errors
            .Take(3)
            .Select(error =>
            {
                var name = string.IsNullOrWhiteSpace(error.Name) ? error.PlayerId : error.Name;
                return string.IsNullOrWhiteSpace(name) ? error.Error : $"{name}: {error.Error}";
            })
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .ToArray();
        var suffix = errors.Count > parts.Length ? $" (+{errors.Count - parts.Length} more)" : string.Empty;
        return string.Join(" | ", parts) + suffix;
    }

    private static string? BuildCronPlayerSummary(IReadOnlyList<CronPlayer>? players)
    {
        if (players is null || players.Count == 0)
        {
            return null;
        }

        static string JoinNames(IEnumerable<CronPlayer> source)
        {
            return string.Join(", ", source
                .Select(player => string.IsNullOrWhiteSpace(player.Name) ? player.PlayerId : player.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Take(3));
        }

        var saved = players.Where(player => string.Equals(player.Status, "ok", StringComparison.OrdinalIgnoreCase)).ToArray();
        var unchanged = players.Where(player => string.Equals(player.Status, "skipped", StringComparison.OrdinalIgnoreCase)).ToArray();
        var parts = new List<string>();
        var savedNames = JoinNames(saved);
        if (!string.IsNullOrWhiteSpace(savedNames))
        {
            parts.Add($"saved: {savedNames}{(saved.Length > 3 ? $" (+{saved.Length - 3})" : string.Empty)}");
        }

        var unchangedNames = JoinNames(unchanged);
        if (!string.IsNullOrWhiteSpace(unchangedNames))
        {
            parts.Add($"unchanged: {unchangedNames}{(unchanged.Length > 3 ? $" (+{unchanged.Length - 3})" : string.Empty)}");
        }

        return parts.Count == 0 ? null : string.Join("; ", parts);
    }

    private static string? PrefixError(string label, string? errorSummary)
    {
        return string.IsNullOrWhiteSpace(errorSummary) ? null : $"{label}: {errorSummary}";
    }

    private static int EstimateRefreshTimeoutSeconds(JobConfig jobConfig, int startupTimeoutSec)
    {
        var perPlayerSeconds = Math.Max(2, (int)Math.Ceiling(jobConfig.DelayMs / 1000d) + 8);
        if (jobConfig.SyncMatches || jobConfig.SyncTftMatches)
        {
            perPlayerSeconds += Math.Min(90, Math.Max(15, jobConfig.MatchesCount * 2));
        }

        var estimate = 60 + jobConfig.Limit * perPlayerSeconds;
        return Math.Max(startupTimeoutSec, Math.Min(1800, estimate));
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

    private static string TrimForNotification(string message)
    {
        return message.Length <= 220 ? message : $"{message[..220]}...";
    }
}

internal enum RefreshJob
{
    Rank,
    Tft,
    Live,
}

internal sealed record DiscordRole(string Id, string Name);

internal sealed record DiscordRoleContext(
    string GuildId,
    Dictionary<string, DiscordRole> RolesByName,
    Dictionary<string, List<DiscordRole>> ManagedRolesByQueue,
    DiscordRole BindRole,
    DiscordRole VerifiedRole);

internal sealed record DiscordRoleSyncResult(BsonDocument Snapshot, string? AssignedSoloRoleName);

internal sealed class CSharpRefreshService
{
    private static readonly string[] SeaPlatforms = ["sg2", "th2", "ph2", "vn2", "tw2"];
    private static readonly string[] ManagedRankTiers =
    [
        "CHALLENGER",
        "GRANDMASTER",
        "MASTER",
        "DIAMOND",
        "EMERALD",
        "PLATINUM",
        "GOLD",
        "SILVER",
        "BRONZE",
        "IRON",
    ];

    private static readonly (string Key, string Label, string? RoleLabel)[] ManagedRankQueues =
    [
        ("solo", "Solo Queue", null),
        ("tft", "TFT", "TFT"),
        ("flex", "Ranked Flex", "Flex"),
    ];

    private static readonly Dictionary<string, int> RankRoleColors = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CHALLENGER"] = 0xf0c74b,
        ["GRANDMASTER"] = 0xd14b5a,
        ["MASTER"] = 0xa970ff,
        ["DIAMOND"] = 0x4ba3ff,
        ["EMERALD"] = 0x2ecc71,
        ["PLATINUM"] = 0x25b7b7,
        ["GOLD"] = 0xd4af37,
        ["SILVER"] = 0xaeb6bf,
        ["BRONZE"] = 0xa97142,
        ["IRON"] = 0x5d6d7e,
    };

    private readonly Dictionary<string, string> _env;
    private readonly HttpClient _http = new();
    private readonly IMongoCollection<BsonDocument> _players;
    private readonly IMongoCollection<BsonDocument> _rankEntries;
    private readonly IMongoCollection<BsonDocument> _tftPlayerMatches;
    private readonly IMongoCollection<BsonDocument> _discordLinks;
    private readonly IMongoCollection<BsonDocument> _liveGamePosts;

    public CSharpRefreshService(string repoRoot)
    {
        _env = LoadEnv(repoRoot);
        var mongoUri = MustEnv("MONGODB_URI");
        var mongoUrl = new MongoUrl(mongoUri);
        var databaseName = !string.IsNullOrWhiteSpace(mongoUrl.DatabaseName)
            ? mongoUrl.DatabaseName
            : Env("MONGODB_DB") ?? "test";
        var db = new MongoClient(mongoUrl).GetDatabase(databaseName);
        _players = db.GetCollection<BsonDocument>("players");
        _rankEntries = db.GetCollection<BsonDocument>("rankentries");
        _tftPlayerMatches = db.GetCollection<BsonDocument>("tftplayermatches");
        _discordLinks = db.GetCollection<BsonDocument>("discordlinks");
        _liveGamePosts = db.GetCollection<BsonDocument>("livegameposts");
    }

    public async Task<CronResult> RefreshAsync(RefreshJob job, JobConfig config, CancellationToken cancellationToken)
    {
        if (job == RefreshJob.Live)
        {
            return await PublishLiveGamesAsync(config, cancellationToken);
        }

        var result = new CronResult();
        var filter = Builders<BsonDocument>.Filter.Eq("leaderboard.group", "burmese") &
                     Builders<BsonDocument>.Filter.Eq("leaderboard.status", "approved");
        var sort = job == RefreshJob.Tft
            ? Builders<BsonDocument>.Sort.Ascending("tftMatchSync.lastSyncAt").Ascending("lastRefreshAt").Ascending("updatedAt")
            : Builders<BsonDocument>.Sort.Ascending("lastRefreshAt").Ascending("updatedAt");

        var players = await _players.Find(filter).Sort(sort).Limit(config.Limit).ToListAsync(cancellationToken);
        result.Scanned = players.Count;

        foreach (var player in players)
        {
            var id = player.GetValue("_id").AsObjectId;
            var name = $"{ReadString(player, "gameName")}#{ReadString(player, "tagLine")}";
            try
            {
                if (job == RefreshJob.Rank)
                {
                    await RefreshRankAsync(player, config, cancellationToken);
                }
                else
                {
                    await RefreshTftMatchesAsync(player, config, cancellationToken);
                }

                result.Ok++;
                result.Players.Add(new CronPlayer { PlayerId = id.ToString(), Name = name, Status = "ok" });
                if (config.DelayMs > 0)
                {
                    await Task.Delay(config.DelayMs, cancellationToken);
                }
            }
            catch (Exception ex)
            {
                result.Fail++;
                result.Errors.Add(new CronError { PlayerId = id.ToString(), Name = name, Error = ex.Message });
                result.Players.Add(new CronPlayer { PlayerId = id.ToString(), Name = name, Status = "failed" });
                if (IsRateLimit(ex))
                {
                    await Task.Delay(RetryAfterMs(ex) ?? 3000, cancellationToken);
                }
            }
        }

        return result;
    }

    private async Task<CronResult> PublishLiveGamesAsync(JobConfig config, CancellationToken cancellationToken)
    {
        var result = new CronResult();
        if (!LiveGameDiscordConfigured())
        {
            throw new InvalidOperationException("Missing DISCORD_BOT_TOKEN or DISCORD_LIVE_GAMES_CHANNEL_ID.");
        }

        var now = DateTime.UtcNow;
        var filter = Builders<BsonDocument>.Filter.Eq("leaderboard.group", "burmese") &
                     Builders<BsonDocument>.Filter.Eq("leaderboard.status", "approved") &
                     Builders<BsonDocument>.Filter.Ne("track.lol", false) &
                     Builders<BsonDocument>.Filter.Type("puuid", BsonType.String);
        var players = await _players.Find(filter)
            .Sort(Builders<BsonDocument>.Sort.Descending("lastRefreshAt").Descending("updatedAt"))
            .Limit(config.Limit)
            .ToListAsync(cancellationToken);

        result.Scanned = players.Count;
        var liveGames = new Dictionary<string, (string Platform, JsonElement Game, List<BsonDocument> Players)>(StringComparer.Ordinal);

        foreach (var player in players)
        {
            var id = player.GetValue("_id").AsObjectId;
            var name = $"{ReadString(player, "gameName")}#{ReadString(player, "tagLine")}";
            var puuid = ReadString(player, "puuid");
            if (string.IsNullOrWhiteSpace(puuid))
            {
                result.Skipped++;
                result.Players.Add(new CronPlayer { PlayerId = id.ToString(), Name = name, Status = "skipped" });
                continue;
            }

            try
            {
                var found = await FindActiveGameAsync(puuid, ReadString(player, "platform"), cancellationToken);
                if (found is null)
                {
                    result.Skipped++;
                    result.Players.Add(new CronPlayer { PlayerId = id.ToString(), Name = name, Status = "skipped" });
                }
                else
                {
                    var key = $"{found.Value.Platform}:{GetLong(found.Value.Game, "gameId")}";
                    if (!liveGames.TryGetValue(key, out var group))
                    {
                        group = (found.Value.Platform, found.Value.Game, []);
                        liveGames[key] = group;
                    }

                    if (group.Players.All(p => p.GetValue("_id").AsObjectId != id))
                    {
                        group.Players.Add(player);
                    }
                }
            }
            catch (Exception ex)
            {
                result.Fail++;
                result.Errors.Add(new CronError { PlayerId = id.ToString(), Name = name, Error = ex.Message });
                result.Players.Add(new CronPlayer { PlayerId = id.ToString(), Name = name, Status = "failed" });
            }

            if (config.DelayMs > 0)
            {
                await Task.Delay(config.DelayMs, cancellationToken);
            }
        }

        foreach (var group in liveGames.Values)
        {
            var gameId = GetLong(group.Game, "gameId") ?? 0;
            if (gameId <= 0) continue;

            var existing = await _liveGamePosts.Find(
                Builders<BsonDocument>.Filter.Eq("channelId", LiveGamesChannelId()) &
                Builders<BsonDocument>.Filter.Eq("platform", group.Platform) &
                Builders<BsonDocument>.Filter.Eq("gameId", gameId))
                .FirstOrDefaultAsync(cancellationToken);
            var riotIds = group.Players.Select(PlayerRiotId).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
            if (existing is not null)
            {
                result.Skipped++;
                await _liveGamePosts.UpdateOneAsync(
                    Builders<BsonDocument>.Filter.Eq("_id", existing.GetValue("_id").AsObjectId),
                    Builders<BsonDocument>.Update
                        .Set("lastSeenAt", now)
                        .Set("riotIds", new BsonArray(riotIds)),
                    cancellationToken: cancellationToken);
                continue;
            }

            try
            {
                var message = await SendDiscordChannelMessageAsync(LiveGamesChannelId(), BuildLiveGameMessage(group.Platform, group.Game, group.Players), cancellationToken);
                var messageId = GetString(message, "id");
                await _liveGamePosts.InsertOneAsync(new BsonDocument
                {
                    ["channelId"] = LiveGamesChannelId(),
                    ["platform"] = group.Platform,
                    ["gameId"] = gameId,
                    ["playerIds"] = new BsonArray(group.Players.Select(p => p.GetValue("_id").AsObjectId)),
                    ["riotIds"] = new BsonArray(riotIds),
                    ["messageId"] = messageId is null ? BsonNull.Value : messageId,
                    ["postedAt"] = now,
                    ["lastSeenAt"] = now,
                    ["createdAt"] = now,
                    ["updatedAt"] = now,
                }, cancellationToken: cancellationToken);
                result.Ok++;
                result.Players.Add(new CronPlayer { Name = string.Join(", ", riotIds.Take(3)), Status = "ok" });
            }
            catch (Exception ex)
            {
                result.Fail++;
                result.Errors.Add(new CronError { Name = $"{group.Platform}:{gameId}", Error = ex.Message });
            }
        }

        return result;
    }

    private async Task RefreshRankAsync(BsonDocument player, JobConfig config, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var playerId = player.GetValue("_id").AsObjectId;
        var gameName = ReadString(player, "gameName") ?? throw new InvalidOperationException("Player missing gameName");
        var tagLine = ReadString(player, "tagLine") ?? throw new InvalidOperationException("Player missing tagLine");
        var puuid = ReadString(player, "puuid");
        try
        {
            var account = await GetAccountByRiotIdAsync(gameName, tagLine, "lol", cancellationToken);
            var currentPuuid = account.GetProperty("puuid").GetString();
            if (!string.IsNullOrWhiteSpace(currentPuuid))
            {
                puuid = currentPuuid;
            }
        }
        catch
        {
            if (string.IsNullOrWhiteSpace(puuid))
            {
                throw;
            }
        }

        if (string.IsNullOrWhiteSpace(puuid))
        {
            throw new InvalidOperationException("Riot account did not return a puuid.");
        }

        var platform = ReadString(player, "platform");
        JsonElement summoner;
        if (string.IsNullOrWhiteSpace(platform) || platform == "auto")
        {
            (platform, summoner) = await FindSeaSummonerByPuuidAsync(puuid, cancellationToken);
        }
        else
        {
            try
            {
                summoner = await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken);
            }
            catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
            {
                (platform, summoner) = await FindSeaSummonerByPuuidAsync(puuid, cancellationToken);
            }
        }

        var entries = await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken);
        var tftLeague = await FindTftLeagueAsync(puuid, platform, cancellationToken);
        var matchRegion = PlatformToMatchRegion(platform);

        var updates = new List<UpdateDefinition<BsonDocument>>
        {
            Builders<BsonDocument>.Update.Set("puuid", puuid),
            Builders<BsonDocument>.Update.Set("tftPuuid", puuid),
            Builders<BsonDocument>.Update.Set("platform", platform),
            Builders<BsonDocument>.Update.Set("matchRegion", matchRegion),
            Builders<BsonDocument>.Update.Set("lastRefreshAt", now),
            Builders<BsonDocument>.Update.Set("updatedAt", now),
        };
        SetJsonString(updates, "summonerId", summoner, "id");
        SetJsonInt(updates, "profileIconId", summoner, "profileIconId");
        SetJsonString(updates, "summonerName", summoner, "name");
        SetJsonInt(updates, "summonerLevel", summoner, "summonerLevel");
        SetJsonLong(updates, "revisionDate", summoner, "revisionDate");
        ApplyLeagueSnapshot(updates, entries, "RANKED_SOLO_5x5", "solo", now);
        ApplyLeagueSnapshot(updates, entries, "RANKED_FLEX_SR", "flex", now);
        ApplyLeagueSnapshot(updates, tftLeague, "RANKED_TFT", "tft", now);

        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            Builders<BsonDocument>.Update.Combine(updates),
            cancellationToken: cancellationToken);
        await InsertRankEntriesAsync(playerId, entries, now, cancellationToken);
        await InsertRankEntriesAsync(playerId, tftLeague, now, cancellationToken);
        await SyncDiscordGuildRolesForPlayerAsync(playerId, cancellationToken);
    }

    private async Task RefreshTftMatchesAsync(BsonDocument player, JobConfig config, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var playerId = player.GetValue("_id").AsObjectId;
        var gameName = ReadString(player, "gameName") ?? throw new InvalidOperationException("Player missing gameName");
        var tagLine = ReadString(player, "tagLine") ?? throw new InvalidOperationException("Player missing tagLine");
        var puuid = ReadString(player, "tftPuuid") ?? ReadString(player, "puuid");
        try
        {
            var account = await GetAccountByRiotIdAsync(
                gameName,
                tagLine,
                "tft",
                cancellationToken);
            var currentPuuid = account.GetProperty("puuid").GetString();
            if (!string.IsNullOrWhiteSpace(currentPuuid))
            {
                puuid = currentPuuid;
            }
        }
        catch
        {
            if (string.IsNullOrWhiteSpace(puuid))
            {
                throw;
            }
        }

        if (string.IsNullOrWhiteSpace(puuid))
        {
            throw new InvalidOperationException("Missing TFT puuid.");
        }

        var platform = ReadString(player, "platform") ?? "sg2";
        var matchRegion = ReadString(player, "matchRegion") ?? PlatformToMatchRegion(platform);
        var tftLeague = await FindTftLeagueAsync(puuid, platform, cancellationToken);
        var updates = new List<UpdateDefinition<BsonDocument>>
        {
            Builders<BsonDocument>.Update.Set("tftPuuid", puuid),
            Builders<BsonDocument>.Update.Set("matchRegion", matchRegion),
            Builders<BsonDocument>.Update.Set("lastRefreshAt", now),
            Builders<BsonDocument>.Update.Set("updatedAt", now),
        };
        ApplyLeagueSnapshot(updates, tftLeague, "RANKED_TFT", "tft", now);
        await InsertRankEntriesAsync(playerId, tftLeague, now, cancellationToken);
        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            Builders<BsonDocument>.Update.Combine(updates),
            cancellationToken: cancellationToken);
        await SyncDiscordGuildRolesForPlayerAsync(playerId, cancellationToken);

        var ids = await GetStringArrayAsync($"https://{matchRegion}.api.riotgames.com/tft/match/v1/matches/by-puuid/{Uri.EscapeDataString(puuid)}/ids?start=0&count={config.MatchesCount}", "tft", cancellationToken);
        var saved = 0;
        foreach (var matchId in ids)
        {
            var match = await RiotGetJsonAsync($"https://{matchRegion}.api.riotgames.com/tft/match/v1/matches/{Uri.EscapeDataString(matchId)}", "tft", cancellationToken);
            var info = match.GetProperty("info");
            var participant = info.GetProperty("participants")
                .EnumerateArray()
                .FirstOrDefault(p => string.Equals(GetString(p, "puuid"), puuid, StringComparison.OrdinalIgnoreCase));
            if (participant.ValueKind == JsonValueKind.Undefined)
            {
                continue;
            }

            var doc = ExtractTftPlayerMatch(playerId, matchId, matchRegion, info, participant, now);
            await _tftPlayerMatches.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("playerId", playerId) & Builders<BsonDocument>.Filter.Eq("matchId", matchId),
                new BsonDocument("$set", doc),
                new UpdateOptions { IsUpsert = true },
                cancellationToken);
            saved++;
        }

        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            Builders<BsonDocument>.Update
                .Set("tftPuuid", puuid)
                .Set("matchRegion", matchRegion)
                .Set("tftMatchSync.lastSyncAt", now)
                .Set("lastRefreshAt", now)
                .Set("updatedAt", now),
            cancellationToken: cancellationToken);
        if (ids.Count > 0 && saved == 0)
        {
            throw new InvalidOperationException("TFT matches found, but none matched this player's puuid.");
        }
    }

    private BsonDocument ExtractTftPlayerMatch(ObjectId playerId, string matchId, string region, JsonElement info, JsonElement me, DateTime now)
    {
        return new BsonDocument
        {
            ["playerId"] = playerId,
            ["matchId"] = matchId,
            ["region"] = region,
            ["queueId"] = BsonIntOrNull(info, "queue_id"),
            ["gameDatetime"] = BsonLongOrNull(info, "game_datetime"),
            ["gameLength"] = BsonDoubleOrNull(info, "game_length"),
            ["setNumber"] = BsonIntOrNull(info, "tft_set_number"),
            ["placement"] = BsonIntOrNull(me, "placement"),
            ["level"] = BsonIntOrNull(me, "level"),
            ["lastRound"] = BsonIntOrNull(me, "last_round"),
            ["playersEliminated"] = BsonIntOrNull(me, "players_eliminated"),
            ["totalDamageToPlayers"] = BsonIntOrNull(me, "total_damage_to_players"),
            ["goldLeft"] = BsonIntOrNull(me, "gold_left"),
            ["timeEliminated"] = BsonDoubleOrNull(me, "time_eliminated"),
            ["companionContentId"] = BsonStringOrNull(me, "companion", "content_ID"),
            ["augments"] = new BsonArray(GetStringArray(me, "augments")),
            ["traits"] = new BsonArray(GetArray(me, "traits").Select(t => new BsonDocument
            {
                ["name"] = BsonStringOrNull(t, "name"),
                ["numUnits"] = BsonIntOrNull(t, "num_units"),
                ["style"] = BsonIntOrNull(t, "style"),
                ["tierCurrent"] = BsonIntOrNull(t, "tier_current"),
                ["tierTotal"] = BsonIntOrNull(t, "tier_total"),
            })),
            ["units"] = new BsonArray(GetArray(me, "units").Select(u => new BsonDocument
            {
                ["characterId"] = BsonStringOrNull(u, "character_id"),
                ["name"] = BsonStringOrNull(u, "name"),
                ["rarity"] = BsonIntOrNull(u, "rarity"),
                ["tier"] = BsonIntOrNull(u, "tier"),
                ["itemNames"] = new BsonArray(GetStringArray(u, "itemNames")),
            })),
            ["fetchedAt"] = now,
        };
    }

    private string BuildLiveGameMessage(string platform, JsonElement game, IReadOnlyList<BsonDocument> trackedPlayers)
    {
        var gameId = GetLong(game, "gameId") ?? 0;
        var queueId = GetInt(game, "gameQueueConfigId");
        var length = GetInt(game, "gameLength") ?? 0;
        var startTime = GetLong(game, "gameStartTime");
        var started = startTime is { } unixMs ? $"<t:{unixMs / 1000}:R>" : "now";
        var participants = GetArray(game, "participants");

        string ChampionLine(JsonElement participant)
        {
            var riotId = GetString(participant, "riotId") ?? GetString(participant, "summonerName") ?? "Unknown";
            var championId = GetInt(participant, "championId");
            return championId is null ? riotId : $"{riotId} - champion {championId}";
        }

        var trackedLines = trackedPlayers
            .Select(player =>
            {
                var puuid = ReadString(player, "puuid");
                var participant = participants.FirstOrDefault(p => string.Equals(GetString(p, "puuid"), puuid, StringComparison.OrdinalIgnoreCase));
                var championId = participant.ValueKind == JsonValueKind.Undefined ? null : GetInt(participant, "championId");
                var profileUrl = $"{AppBaseUrl()}{PlayerPath(player)}";
                return championId is null
                    ? $"• [{PlayerRiotId(player)}]({profileUrl})"
                    : $"• [{PlayerRiotId(player)}]({profileUrl}) - champion {championId}";
            })
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .Take(8)
            .ToList();

        var blue = participants.Where(p => GetInt(p, "teamId") == 100).Take(5).Select(ChampionLine).ToList();
        var red = participants.Where(p => GetInt(p, "teamId") == 200).Take(5).Select(ChampionLine).ToList();

        return string.Join("\n", new[]
        {
            $"**Live now: {QueueName(queueId)} on {platform.ToUpperInvariant()}**",
            $"Game {gameId} - {FormatGameLength(length)} - started {started}",
            "",
            string.Join("\n", trackedLines),
            "",
            blue.Count > 0 ? $"Blue: {string.Join(", ", blue)}" : "",
            red.Count > 0 ? $"Red: {string.Join(", ", red)}" : "",
        }.Where(line => line.Length > 0));
    }

    private static string QueueName(int? queueId) => queueId switch
    {
        420 => "Ranked Solo/Duo",
        440 => "Ranked Flex",
        400 => "Draft Pick",
        430 => "Blind Pick",
        450 => "ARAM",
        1700 => "Arena",
        0 or null => "Custom",
        _ => $"Queue {queueId}",
    };

    private static string FormatGameLength(int seconds)
    {
        var safe = Math.Max(0, seconds);
        return $"{safe / 60}:{safe % 60:00}";
    }

    private static string PlayerRiotId(BsonDocument player)
    {
        return $"{ReadString(player, "gameName")}#{ReadString(player, "tagLine")}";
    }

    private static string PlayerPath(BsonDocument player)
    {
        return $"/p/{Uri.EscapeDataString(ReadString(player, "gameName") ?? "")}/{Uri.EscapeDataString(ReadString(player, "tagLine") ?? "")}";
    }

    private string AppBaseUrl()
    {
        return (Env("NEXT_PUBLIC_APP_URL") ?? Env("APP_BASE_URL") ?? "https://rift-board-myanmar.vercel.app").TrimEnd('/');
    }

    private async Task SyncDiscordGuildRolesForPlayerAsync(ObjectId playerId, CancellationToken cancellationToken)
    {
        if (!DiscordRoleSyncConfigured())
        {
            return;
        }

        var links = await _discordLinks.Find(
            Builders<BsonDocument>.Filter.Eq("playerId", playerId) &
            Builders<BsonDocument>.Filter.Eq("verifiedBinding", true) &
            Builders<BsonDocument>.Filter.In("verificationSource", new[] { "discord_connections", "legacy_manual" }))
            .ToListAsync(cancellationToken);
        if (links.Count == 0)
        {
            return;
        }

        var player = await _players.Find(Builders<BsonDocument>.Filter.Eq("_id", playerId)).FirstOrDefaultAsync(cancellationToken);
        if (player is null)
        {
            return;
        }

        var context = await EnsureDiscordRoleContextAsync(cancellationToken);
        foreach (var link in links)
        {
            var discordUserId = ReadString(link, "discordUserId");
            if (string.IsNullOrWhiteSpace(discordUserId))
            {
                continue;
            }

            var result = await SyncDiscordGuildRolesForIdentityAsync(discordUserId, player, context, cancellationToken);
            var soloTier = result.Snapshot.GetValue("solo", BsonNull.Value);
            BsonValue soloRoleName = result.AssignedSoloRoleName is null ? BsonNull.Value : result.AssignedSoloRoleName;
            await _discordLinks.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", link.GetValue("_id").AsObjectId),
                Builders<BsonDocument>.Update
                    .Set("gameName", ReadString(player, "gameName") ?? "")
                    .Set("tagLine", ReadString(player, "tagLine") ?? "")
                    .Set("guildRankRoleTier", soloTier)
                    .Set("guildRankRoleName", soloRoleName)
                    .Set("guildRankRolesSnapshot", result.Snapshot)
                    .Set("guildRankRolesSyncedAt", DateTime.UtcNow),
                cancellationToken: cancellationToken);
        }
    }

    private async Task<DiscordRoleSyncResult> SyncDiscordGuildRolesForIdentityAsync(
        string discordUserId,
        BsonDocument player,
        DiscordRoleContext context,
        CancellationToken cancellationToken)
    {
        var member = await DiscordApiAsync(HttpMethod.Get, $"/guilds/{Uri.EscapeDataString(context.GuildId)}/members/{Uri.EscapeDataString(discordUserId)}", null, cancellationToken);
        var existingRoleIds = new HashSet<string>(
            member.TryGetProperty("roles", out var roles) && roles.ValueKind == JsonValueKind.Array
                ? roles.EnumerateArray().Select(role => role.GetString()).Where(role => !string.IsNullOrWhiteSpace(role)).Select(role => role!)
                : [],
            StringComparer.Ordinal);

        var snapshot = BuildGuildRankRoleSnapshot(player);
        var assignedSoloRoleName = default(string);

        foreach (var queue in ManagedRankQueues)
        {
            var wantedTier = snapshot.TryGetValue(queue.Key, out var tierValue) && tierValue.IsString ? tierValue.AsString : null;
            var wantedRoleName = string.IsNullOrWhiteSpace(wantedTier) ? null : ManagedRoleName(queue.RoleLabel, wantedTier);
            var wantedRole = wantedRoleName is not null && context.RolesByName.TryGetValue(wantedRoleName, out var matchedRole) ? matchedRole : null;
            if (queue.Key == "solo")
            {
                assignedSoloRoleName = wantedRole?.Name;
            }

            foreach (var role in context.ManagedRolesByQueue[queue.Key])
            {
                var shouldHave = wantedRole is not null && role.Id == wantedRole.Id;
                var hasRole = existingRoleIds.Contains(role.Id);
                if (shouldHave && !hasRole)
                {
                    await AddDiscordRoleAsync(context.GuildId, discordUserId, role.Id, $"Sync RiftBoard {queue.Label} rank role", cancellationToken);
                    existingRoleIds.Add(role.Id);
                }
                else if (!shouldHave && hasRole)
                {
                    await RemoveDiscordRoleAsync(context.GuildId, discordUserId, role.Id, $"Remove stale RiftBoard {queue.Label} rank role", cancellationToken);
                    existingRoleIds.Remove(role.Id);
                }
            }
        }

        if (existingRoleIds.Contains(context.BindRole.Id))
        {
            await RemoveDiscordRoleAsync(context.GuildId, discordUserId, context.BindRole.Id, "Remove RiftBoard bind role for verified member", cancellationToken);
            existingRoleIds.Remove(context.BindRole.Id);
        }

        if (!existingRoleIds.Contains(context.VerifiedRole.Id))
        {
            await AddDiscordRoleAsync(context.GuildId, discordUserId, context.VerifiedRole.Id, "Assign RiftBoard verified role", cancellationToken);
        }

        return new DiscordRoleSyncResult(snapshot, assignedSoloRoleName);
    }

    private async Task<DiscordRoleContext> EnsureDiscordRoleContextAsync(CancellationToken cancellationToken)
    {
        var guildId = DiscordGuildId();
        var roles = await ListDiscordRolesAsync(guildId, cancellationToken);
        var rolesByName = roles.ToDictionary(role => role.Name, StringComparer.Ordinal);

        async Task<DiscordRole> EnsureRoleAsync(string name, int color, string reason)
        {
            if (rolesByName.TryGetValue(name, out var existing))
            {
                return existing;
            }

            var created = await CreateDiscordRoleAsync(guildId, name, color, reason, cancellationToken);
            rolesByName[created.Name] = created;
            return created;
        }

        var bindRole = await EnsureRoleAsync(BindRoleName(), BindRoleColor(), "Create RiftBoard bind role");
        var verifiedRole = await EnsureRoleAsync(VerifiedRoleName(), VerifiedRoleColor(), "Create RiftBoard verified member role");

        foreach (var queue in ManagedRankQueues)
        {
            foreach (var tier in ManagedRankTiers)
            {
                await EnsureRoleAsync(ManagedRoleName(queue.RoleLabel, tier), RankRoleColors[tier], $"Create RiftBoard {queue.Label} rank role");
            }
        }

        return new DiscordRoleContext(
            guildId,
            rolesByName,
            ManagedRankQueues.ToDictionary(
                queue => queue.Key,
                queue => ManagedRankTiers
                    .Select(tier => rolesByName[ManagedRoleName(queue.RoleLabel, tier)])
                    .ToList(),
                StringComparer.Ordinal),
            bindRole,
            verifiedRole);
    }

    private async Task<List<DiscordRole>> ListDiscordRolesAsync(string guildId, CancellationToken cancellationToken)
    {
        var json = await DiscordApiAsync(HttpMethod.Get, $"/guilds/{Uri.EscapeDataString(guildId)}/roles", null, cancellationToken);
        return json.ValueKind == JsonValueKind.Array
            ? json.EnumerateArray()
                .Select(role => new DiscordRole(GetString(role, "id") ?? "", GetString(role, "name") ?? ""))
                .Where(role => !string.IsNullOrWhiteSpace(role.Id) && !string.IsNullOrWhiteSpace(role.Name))
                .ToList()
            : [];
    }

    private async Task<DiscordRole> CreateDiscordRoleAsync(string guildId, string name, int color, string reason, CancellationToken cancellationToken)
    {
        using var body = new StringContent(JsonSerializer.Serialize(new
        {
            name,
            color,
            mentionable = false,
            hoist = false,
        }), System.Text.Encoding.UTF8, "application/json");
        var json = await DiscordApiAsync(HttpMethod.Post, $"/guilds/{Uri.EscapeDataString(guildId)}/roles", body, cancellationToken, reason);
        return new DiscordRole(GetString(json, "id") ?? throw new InvalidOperationException("Discord role response missing id."), GetString(json, "name") ?? name);
    }

    private async Task AddDiscordRoleAsync(string guildId, string userId, string roleId, string reason, CancellationToken cancellationToken)
    {
        await DiscordApiAsync(
            HttpMethod.Put,
            $"/guilds/{Uri.EscapeDataString(guildId)}/members/{Uri.EscapeDataString(userId)}/roles/{Uri.EscapeDataString(roleId)}",
            null,
            cancellationToken,
            reason);
    }

    private async Task RemoveDiscordRoleAsync(string guildId, string userId, string roleId, string reason, CancellationToken cancellationToken)
    {
        await DiscordApiAsync(
            HttpMethod.Delete,
            $"/guilds/{Uri.EscapeDataString(guildId)}/members/{Uri.EscapeDataString(userId)}/roles/{Uri.EscapeDataString(roleId)}",
            null,
            cancellationToken,
            reason);
    }

    private async Task<JsonElement> DiscordApiAsync(HttpMethod method, string path, HttpContent? body, CancellationToken cancellationToken, string? reason = null)
    {
        using var request = new HttpRequestMessage(method, $"https://discord.com/api/v10{path}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bot", DiscordBotToken());
        if (!string.IsNullOrWhiteSpace(reason))
        {
            request.Headers.Add("X-Audit-Log-Reason", Uri.EscapeDataString(reason));
        }
        request.Content = body;

        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return JsonDocument.Parse("{}").RootElement.Clone();
            }

            return JsonDocument.Parse(text).RootElement.Clone();
        }

        throw new InvalidOperationException($"Discord API {(int)response.StatusCode}: {ParseDiscordError(text, response.ReasonPhrase ?? "Request failed")}");
    }

    private async Task<JsonElement> SendDiscordChannelMessageAsync(string channelId, string content, CancellationToken cancellationToken)
    {
        using var body = new StringContent(JsonSerializer.Serialize(new
        {
            content,
            allowed_mentions = new { parse = Array.Empty<string>() },
        }), System.Text.Encoding.UTF8, "application/json");
        return await DiscordApiAsync(
            HttpMethod.Post,
            $"/channels/{Uri.EscapeDataString(channelId)}/messages",
            body,
            cancellationToken);
    }

    private BsonDocument BuildGuildRankRoleSnapshot(BsonDocument player)
    {
        var snapshot = new BsonDocument();
        foreach (var queue in ManagedRankQueues)
        {
            var tier = NormalizeManagedTier(ReadNestedString(player, queue.Key, "tier"));
            snapshot[queue.Key] = tier is null ? BsonNull.Value : tier;
        }

        return snapshot;
    }

    private bool DiscordRoleSyncConfigured()
    {
        return !string.IsNullOrWhiteSpace(Env("DISCORD_BOT_TOKEN")) &&
               !string.IsNullOrWhiteSpace(Env("DISCORD_GUILD_ID"));
    }

    private bool LiveGameDiscordConfigured()
    {
        return !string.IsNullOrWhiteSpace(Env("DISCORD_BOT_TOKEN")) &&
               !string.IsNullOrWhiteSpace(LiveGamesChannelId());
    }

    private string DiscordBotToken() => MustEnv("DISCORD_BOT_TOKEN");

    private string DiscordGuildId() => MustEnv("DISCORD_GUILD_ID");

    private string LiveGamesChannelId() => Env("DISCORD_LIVE_GAMES_CHANNEL_ID")?.Trim() is { Length: > 0 } value
        ? value
        : "1504353915091681360";

    private string RankRolePrefix() => Env("DISCORD_RANK_ROLE_PREFIX")?.Trim() ?? "Rank";

    private string BindRoleName() => Env("DISCORD_BIND_ROLE_NAME")?.Trim() is { Length: > 0 } value ? value : "Riftboard: Bind Riot";

    private int BindRoleColor() => HexColor(Env("DISCORD_BIND_ROLE_COLOR"), 0x5865f2);

    private string VerifiedRoleName() => Env("DISCORD_VERIFIED_ROLE_NAME")?.Trim() is { Length: > 0 } value ? value : "Riftboarded";

    private int VerifiedRoleColor() => HexColor(Env("DISCORD_VERIFIED_ROLE_COLOR"), 0x2ecc71);

    private string ManagedRoleName(string? queueRoleLabel, string tier)
    {
        var prettyTier = ToTitleCase(tier);
        var prefix = RankRolePrefix();
        var queueTier = string.IsNullOrWhiteSpace(queueRoleLabel) ? prettyTier : $"{queueRoleLabel} {prettyTier}";
        return string.IsNullOrWhiteSpace(prefix) ? queueTier : $"{prefix}: {queueTier}";
    }

    private static string? NormalizeManagedTier(string? tier)
    {
        var normalized = String(tier).ToUpperInvariant();
        return ManagedRankTiers.Contains(normalized) ? normalized : null;
    }

    private static string ToTitleCase(string value)
    {
        var parts = value.ToLowerInvariant().Split([' ', '_', '-'], StringSplitOptions.RemoveEmptyEntries);
        return string.Join(" ", parts.Select(part => char.ToUpperInvariant(part[0]) + part[1..]));
    }

    private static int HexColor(string? raw, int fallback)
    {
        var value = (raw ?? "").Trim().TrimStart('#');
        return int.TryParse(value, System.Globalization.NumberStyles.HexNumber, null, out var color) ? color : fallback;
    }

    private static string? ReadNestedString(BsonDocument doc, string objectKey, string key)
    {
        if (!doc.TryGetValue(objectKey, out var nested) || !nested.IsBsonDocument)
        {
            return null;
        }

        return ReadString(nested.AsBsonDocument, key);
    }

    private static string String(string? value) => (value ?? "").Trim();

    private static string ParseDiscordError(string text, string fallback)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.TryGetProperty("message", out var message)
                ? message.GetString() ?? fallback
                : fallback;
        }
        catch
        {
            return string.IsNullOrWhiteSpace(text) ? fallback : text;
        }
    }

    private async Task<JsonElement> GetAccountByRiotIdAsync(string gameName, string tagLine, string game, CancellationToken cancellationToken)
    {
        var region = AccountRegion();
        var url = $"https://{region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{Uri.EscapeDataString(gameName)}/{Uri.EscapeDataString(tagLine)}";
        return await RiotGetJsonAsync(url, game, cancellationToken);
    }

    private async Task<(string Platform, JsonElement Summoner)> FindSeaSummonerByPuuidAsync(string puuid, CancellationToken cancellationToken)
    {
        foreach (var platform in SeaPlatforms)
        {
            try
            {
                return (platform, await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken));
            }
            catch (RiotApiException ex) when (ex.Status == 404 || IsDecryptingBadRequest(ex))
            {
            }
            catch (HttpRequestException)
            {
            }
        }

        throw new InvalidOperationException("LoL account not found on SEA platforms.");
    }

    private async Task<JsonElement> FindTftLeagueAsync(string puuid, string? preferredPlatform, CancellationToken cancellationToken)
    {
        var platforms = new List<string>();
        if (!string.IsNullOrWhiteSpace(preferredPlatform) && preferredPlatform != "auto")
        {
            platforms.Add(preferredPlatform);
        }
        platforms.AddRange(SeaPlatforms.Where(p => !platforms.Contains(p)));

        foreach (var platform in platforms)
        {
            try
            {
                return await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/tft/league/v1/by-puuid/{Uri.EscapeDataString(puuid)}", "tft", cancellationToken);
            }
            catch (RiotApiException ex) when (ex.Status == 404 || IsDecryptingBadRequest(ex))
            {
            }
            catch (HttpRequestException)
            {
            }
        }

        return JsonDocument.Parse("[]").RootElement.Clone();
    }

    private async Task<(string Platform, JsonElement Game)?> FindActiveGameAsync(string puuid, string? preferredPlatform, CancellationToken cancellationToken)
    {
        var platforms = new List<string>();
        if (!string.IsNullOrWhiteSpace(preferredPlatform) && preferredPlatform != "auto")
        {
            platforms.Add(preferredPlatform);
        }
        platforms.AddRange(SeaPlatforms.Where(p => !platforms.Contains(p)));

        foreach (var platform in platforms)
        {
            try
            {
                var game = await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken);
                return (platform, game);
            }
            catch (RiotApiException ex) when (ex.Status == 404 || IsDecryptingBadRequest(ex))
            {
            }
            catch (HttpRequestException)
            {
            }
        }

        return null;
    }

    private async Task<JsonElement> RiotGetJsonAsync(string url, string game, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Riot-Token", RiotKey(game));
        request.Headers.Add("Accept-Language", "en-US,en;q=0.9");
        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            return JsonDocument.Parse(text).RootElement.Clone();
        }

        int? retry = response.Headers.RetryAfter?.Delta is { } delta ? (int)delta.TotalMilliseconds : null;
        throw new RiotApiException((int)response.StatusCode, ParseRiotError(text, response.ReasonPhrase ?? "Riot API error"), retry);
    }

    private async Task<List<string>> GetStringArrayAsync(string url, string game, CancellationToken cancellationToken)
    {
        var json = await RiotGetJsonAsync(url, game, cancellationToken);
        return json.ValueKind == JsonValueKind.Array ? json.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToList() : [];
    }

    private async Task InsertRankEntriesAsync(ObjectId playerId, JsonElement entries, DateTime now, CancellationToken cancellationToken)
    {
        if (entries.ValueKind != JsonValueKind.Array) return;
        var docs = entries.EnumerateArray().Select(entry => new BsonDocument
        {
            ["playerId"] = playerId,
            ["queue"] = GetString(entry, "queueType") ?? "",
            ["tier"] = GetString(entry, "tier") ?? "",
            ["division"] = GetString(entry, "rank") ?? "",
            ["lp"] = GetInt(entry, "leaguePoints") ?? 0,
            ["wins"] = GetInt(entry, "wins") ?? 0,
            ["losses"] = GetInt(entry, "losses") ?? 0,
            ["fetchedAt"] = now,
        }).Where(doc => !string.IsNullOrWhiteSpace(doc["queue"].AsString)).ToList();
        if (docs.Count > 0) await _rankEntries.InsertManyAsync(docs, cancellationToken: cancellationToken);
    }

    private static void ApplyLeagueSnapshot(List<UpdateDefinition<BsonDocument>> updates, JsonElement entries, string queue, string path, DateTime now)
    {
        if (entries.ValueKind != JsonValueKind.Array) return;
        var entry = entries.EnumerateArray().FirstOrDefault(e => string.Equals(GetString(e, "queueType"), queue, StringComparison.OrdinalIgnoreCase));
        if (entry.ValueKind == JsonValueKind.Undefined) return;
        updates.Add(Builders<BsonDocument>.Update.Set(path, new BsonDocument
        {
            ["tier"] = GetString(entry, "tier") ?? "",
            ["division"] = GetString(entry, "rank") ?? "",
            ["lp"] = GetInt(entry, "leaguePoints") ?? 0,
            ["wins"] = GetInt(entry, "wins") ?? 0,
            ["losses"] = GetInt(entry, "losses") ?? 0,
            ["fetchedAt"] = now,
        }));
    }

    private static void SetJsonString(List<UpdateDefinition<BsonDocument>> updates, string path, JsonElement json, string key)
    {
        var value = GetString(json, key);
        if (value is not null) updates.Add(Builders<BsonDocument>.Update.Set(path, value));
    }

    private static void SetJsonInt(List<UpdateDefinition<BsonDocument>> updates, string path, JsonElement json, string key)
    {
        var value = GetInt(json, key);
        if (value is not null) updates.Add(Builders<BsonDocument>.Update.Set(path, value.Value));
    }

    private static void SetJsonLong(List<UpdateDefinition<BsonDocument>> updates, string path, JsonElement json, string key)
    {
        var value = GetLong(json, key);
        if (value is not null) updates.Add(Builders<BsonDocument>.Update.Set(path, value.Value));
    }

    private static List<JsonElement> GetArray(JsonElement json, string key)
    {
        return json.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().ToList() : [];
    }

    private static List<string> GetStringArray(JsonElement json, string key)
    {
        return GetArray(json, key).Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToList();
    }

    private static string? GetString(JsonElement json, string key)
    {
        return json.ValueKind == JsonValueKind.Object && json.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static int? GetInt(JsonElement json, string key)
    {
        return json.ValueKind == JsonValueKind.Object && json.TryGetProperty(key, out var value) && value.TryGetInt32(out var n) ? n : null;
    }

    private static long? GetLong(JsonElement json, string key)
    {
        return json.ValueKind == JsonValueKind.Object && json.TryGetProperty(key, out var value) && value.TryGetInt64(out var n) ? n : null;
    }

    private static BsonValue BsonStringOrNull(JsonElement json, string key)
    {
        return GetString(json, key) is { } value ? value : BsonNull.Value;
    }

    private static BsonValue BsonStringOrNull(JsonElement json, string objectKey, string key)
    {
        return json.ValueKind == JsonValueKind.Object && json.TryGetProperty(objectKey, out var nested) ? BsonStringOrNull(nested, key) : BsonNull.Value;
    }

    private static BsonValue BsonIntOrNull(JsonElement json, string key)
    {
        return GetInt(json, key) is { } value ? value : BsonNull.Value;
    }

    private static BsonValue BsonLongOrNull(JsonElement json, string key)
    {
        return GetLong(json, key) is { } value ? value : BsonNull.Value;
    }

    private static BsonValue BsonDoubleOrNull(JsonElement json, string key)
    {
        return json.ValueKind == JsonValueKind.Object && json.TryGetProperty(key, out var value) && value.TryGetDouble(out var n) ? n : BsonNull.Value;
    }

    private static string? ReadString(BsonDocument doc, string key)
    {
        return doc.TryGetValue(key, out var value) && value.IsString ? value.AsString : null;
    }

    private static string AccountRegion()
    {
        var raw = EnvStatic("RIOT_ACCOUNT_REGION")?.ToLowerInvariant() ?? "asia";
        return raw == "sea" ? "asia" : raw;
    }

    private string RiotKey(string game)
    {
        if (game == "tft")
        {
            return Env("RIOT_TFT_API_KEY") ?? Env("TFT_API_KEY") ?? MustEnv("RIOT_API_KEY");
        }

        return MustEnv("RIOT_API_KEY");
    }

    private static string PlatformToMatchRegion(string? platform)
    {
        var p = (platform ?? "").ToLowerInvariant();
        if (SeaPlatforms.Contains(p)) return "sea";
        if (new[] { "na1", "br1", "la1", "la2", "oc1" }.Contains(p)) return "americas";
        if (new[] { "euw1", "eun1", "tr1", "ru" }.Contains(p)) return "europe";
        if (new[] { "kr", "jp1" }.Contains(p)) return "asia";
        return EnvStatic("RIOT_MATCH_REGION")?.ToLowerInvariant() ?? "sea";
    }

    private string MustEnv(string key)
    {
        return Env(key) ?? throw new InvalidOperationException($"Missing env: {key}");
    }

    private string? Env(string key)
    {
        return _env.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : Environment.GetEnvironmentVariable(key);
    }

    private static string? EnvStatic(string key)
    {
        return Environment.GetEnvironmentVariable(key);
    }

    private static Dictionary<string, string> LoadEnv(string repoRoot)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in new[] { ".env", ".env.local" })
        {
            var path = Path.Combine(repoRoot, file);
            if (!File.Exists(path)) continue;
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal)) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var key = line[..eq].Trim();
                var value = line[(eq + 1)..].Trim().Trim('"', '\'');
                values[key] = value;
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        return values;
    }

    private static string ParseRiotError(string text, string fallback)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.TryGetProperty("status", out var status) && status.TryGetProperty("message", out var message)
                ? message.GetString() ?? fallback
                : fallback;
        }
        catch
        {
            return string.IsNullOrWhiteSpace(text) ? fallback : text;
        }
    }

    private static bool IsRateLimit(Exception ex)
    {
        return ex is RiotApiException { Status: 429 };
    }

    private static bool IsDecryptingBadRequest(RiotApiException ex)
    {
        return ex.Status == 400 && ex.Message.Contains("decrypt", StringComparison.OrdinalIgnoreCase);
    }

    private static int? RetryAfterMs(Exception ex)
    {
        return ex is RiotApiException riot ? riot.RetryAfterMs : null;
    }
}

internal sealed class RiotApiException(int status, string message, int? retryAfterMs = null) : Exception(message)
{
    public int Status { get; } = status;
    public int? RetryAfterMs { get; } = retryAfterMs;
}

internal sealed record JobPanel(
    GroupBox Panel,
    Label Status,
    Label Last,
    CheckBox Enabled,
    NumericUpDown Interval,
    NumericUpDown Limit,
    NumericUpDown Delay,
    NumericUpDown Matches,
    Label Hint,
    TableLayoutPanel Settings);

internal sealed record TrayStatus
{
    public string State { get; init; } = "Stopped";
    public string Current { get; init; } = "Idle";
    public string RankStatus { get; init; } = "Not run yet";
    public string TftStatus { get; init; } = "Not run yet";
    public string LiveStatus { get; init; } = "Not run yet";
    public string RankLast { get; init; } = "None yet";
    public string TftLast { get; init; } = "None yet";
    public string LiveLast { get; init; } = "None yet";
    public string RankNext { get; init; } = "Pending";
    public string TftNext { get; init; } = "Pending";
    public string LiveNext { get; init; } = "Pending";
    public string Error { get; init; } = "None";
}

internal sealed record TickOutcome(int Ok, int Fail, int Skipped, int Scanned, string? PlayerSummary, string? ErrorSummary)
{
    public string LogLine => $"Refreshed {Ok} players, failed {Fail}, skipped {Skipped}, scanned {Scanned}.{(string.IsNullOrWhiteSpace(ErrorSummary) ? string.Empty : $" Errors: {ErrorSummary}")}";
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
    public JobConfig RankJob { get; init; } = new() { SyncMatches = true, SyncTftMatches = false };
    public JobConfig TftJob { get; init; } = new() { SyncMatches = false, SyncTftMatches = true };
    public JobConfig LiveJob { get; init; } = new() { IntervalSec = 600, Limit = 80, DelayMs = 350, SyncMatches = false, SyncTftMatches = false, MatchesCount = 1 };
    public int StartupTimeoutSec { get; init; } = 120;

    public AgentConfig Normalize()
    {
        return new AgentConfig
        {
            LocalAppUrl = NormalizeLocalAppUrl(LocalAppUrl),
            RankJob = RankJob.Normalize() with { SyncTftMatches = false },
            TftJob = TftJob.Normalize() with { SyncMatches = false, SyncTftMatches = true },
            LiveJob = LiveJob.Normalize() with { SyncMatches = false, SyncTftMatches = false, MatchesCount = 1 },
            StartupTimeoutSec = Math.Max(10, Math.Min(1800, StartupTimeoutSec)),
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

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };
}

internal sealed record JobConfig
{
    public bool Enabled { get; init; } = true;
    public int Limit { get; init; } = 5;
    public int DelayMs { get; init; } = 900;
    public int IntervalSec { get; init; } = 300;
    public int? CooldownMs { get; init; }
    public bool Force { get; init; }
    public bool SyncMatches { get; init; } = true;
    public bool SyncTftMatches { get; init; } = true;
    public int MatchesCount { get; init; } = 20;

    public JobConfig Normalize()
    {
        return this with
        {
            Limit = Math.Max(1, Math.Min(200, Limit)),
            DelayMs = Math.Max(0, Math.Min(5000, DelayMs)),
            IntervalSec = Math.Max(60, Math.Min(24 * 60 * 60, IntervalSec)),
            CooldownMs = CooldownMs is null ? null : Math.Max(0, Math.Min(60 * 60 * 1000, CooldownMs.Value)),
            MatchesCount = Math.Max(1, Math.Min(100, MatchesCount)),
        };
    }
}

internal sealed class CronResponse
{
    public bool Ok { get; init; }
    public string? Error { get; init; }
    public CronResult? Result { get; init; }
}

internal sealed class CronResult
{
    public int Ok { get; set; }
    public int Fail { get; set; }
    public int Skipped { get; set; }
    public int Scanned { get; set; }
    public List<CronError> Errors { get; set; } = [];
    public List<CronPlayer> Players { get; set; } = [];
}

internal sealed class CronError
{
    public string? PlayerId { get; init; }
    public string? Name { get; init; }
    public string Error { get; init; } = "Refresh failed";
}

internal sealed class CronPlayer
{
    public string? PlayerId { get; init; }
    public string? Name { get; init; }
    public string Status { get; init; } = "ok";
}
