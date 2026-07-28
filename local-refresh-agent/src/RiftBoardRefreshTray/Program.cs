using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
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
                StopLoopAsync,
                SendTestLivePostAsync);
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

    private async Task SendTestLivePostAsync()
    {
        await new CSharpRefreshService(ResolveRepoRoot(_baseDirectory)).SendTestLivePostAsync(CancellationToken.None);
        ShowNotification("RiftBoard Refresh", "Test live post sent.", ToolTipIcon.Info);
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
    private readonly Func<Task> _testLivePostAsync;
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
        Func<Task> stopAsync,
        Func<Task> testLivePostAsync)
    {
        _saveAsync = saveAsync;
        _startAsync = startAsync;
        _stopAsync = stopAsync;
        _testLivePostAsync = testLivePostAsync;
        _baseDirectory = baseDirectory;

        Text = "RiftBoard Refresh";
        Icon = (Icon)trayIcon.Clone();
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        ClientSize = new Size(1280, 780);

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

        var rankJob = CreateJobPanel("Rank / LoL", "Direct Riot API + MongoDB", new Padding(0, 0, 8, 0), 10);
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

        var tftJob = CreateJobPanel("TFT Matches", "Direct Riot API + MongoDB", new Padding(4, 0, 4, 0), 10);
        _tftStatusLabel = tftJob.Status;
        _tftLastLabel = tftJob.Last;
        _tftEnabledBox = tftJob.Enabled;
        _tftIntervalBox = tftJob.Interval;
        _tftLimitBox = tftJob.Limit;
        _tftDelayBox = tftJob.Delay;
        _tftMatchesCountBox = tftJob.Matches;
        _tftHintLabel = tftJob.Hint;
        jobsGrid.Controls.Add(tftJob.Panel, 1, 0);

        var liveJob = CreateJobPanel("Live Games", "Spectator API + Discord channel", new Padding(8, 0, 0, 0), 15);
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
                CronOnly = _config.CronOnly,
                RemoteAppUrl = _config.RemoteAppUrl,
                CronToken = _config.CronToken,
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
        var testLiveButton = new Button { AutoSize = true, Text = "Test Live Post" };
        testLiveButton.Click += async (_, _) => await RunCommandAsync(_testLivePostAsync);

        buttonBar.Controls.Add(closeButton);
        buttonBar.Controls.Add(_saveButton);
        buttonBar.Controls.Add(_stopButton);
        buttonBar.Controls.Add(_startButton);
        buttonBar.Controls.Add(safeDefaultsButton);
        buttonBar.Controls.Add(openLogsButton);
        buttonBar.Controls.Add(rankLogButton);
        buttonBar.Controls.Add(tftLogButton);
        buttonBar.Controls.Add(liveLogButton);
        buttonBar.Controls.Add(testLiveButton);
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
            CronOnly = _config.CronOnly,
            RemoteAppUrl = _config.RemoteAppUrl,
            CronToken = _config.CronToken,
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
        catch (Exception ex)
        {
            var failure = RefreshErrorClassifier.Classify(ex);
            MessageBox.Show(
                this,
                failure.Message,
                $"RiftBoard Refresh - {failure.Title}",
                MessageBoxButtons.OK,
                failure.Retryable
                    ? MessageBoxIcon.Warning
                    : MessageBoxIcon.Error);
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

    private JobPanel CreateJobPanel(string title, string endpoint, Padding margin, int minimumIntervalMinutes)
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
        var interval = CreateNumericBox(minimumIntervalMinutes, 1440, 1);
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
        var hint = new Label { AutoSize = true, MaximumSize = new Size(300, 0), Margin = new Padding(12, 6, 0, 0) };
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
    private readonly HttpClient _http = new()
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SemaphoreSlim _tickGate = new(1, 1);
    private readonly Dictionary<RefreshJob, (string Code, int Strikes)> _failureStrikes = new();
    private readonly Dictionary<RefreshJob, (string Message, DateTimeOffset At)> _jobErrors = new();
    private readonly object _failureSync = new();
    private CSharpRefreshService? _directService;
    private CancellationTokenSource? _cts;
    private Task? _rankTask;
    private Task? _queuedRankTask;
    private Task? _tftTask;
    private Task? _liveTask;
    private string? _lastRankFailureCode;
    private string? _lastTftFailureCode;
    private string? _lastLiveFailureCode;

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
            _queuedRankTask = RunQueuedRankRequestsAsync(_cts.Token);
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
        Task? queuedRankTask;
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
            queuedRankTask = _queuedRankTask;
            tftTask = _tftTask;
            liveTask = _liveTask;
            _cts = null;
            _rankTask = null;
            _queuedRankTask = null;
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

        if (queuedRankTask is not null)
        {
            try { await queuedRankTask; } catch (OperationCanceledException) { }
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
            var updateStatus = StatusUpdater(job);
            var updateLast = LastUpdater(job);
            var updateNext = NextUpdater(job);
            var logger = LoggerFor(job);

            AgentConfig config;
            try
            {
                config = await AgentConfig.LoadAsync(
                    Path.Combine(_baseDirectory, "config.json"),
                    cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                var failure = RefreshErrorClassifier.Classify(ex);
                logger.Error(RefreshErrorClassifier.SafeDiagnostic("Config load", ex));
                updateStatus($"{failure.Title} - {failure.Message}");
                updateLast($"{DateTimeOffset.Now:hh:mm tt} - failed");
                SetJobError(job, failure.Message);
                SetFailureState(job, failure, failure.Message);
                _updateState("running");
                _updateCurrent("Idle");
                updateNext(DateTimeOffset.Now.AddMinutes(1));
                await Task.Delay(TimeSpan.FromMinutes(1), cancellationToken);
                continue;
            }

            var jobConfig = JobConfigFor(config, job);
            if (!jobConfig.Enabled)
            {
                updateStatus("Off");
                updateNext(null);
                SetJobError(job, null);
                SetFailureState(job, null);
                await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken);
                continue;
            }

            var startedAt = DateTimeOffset.Now;
            RefreshFailureInfo? failureInfo = null;
            int? retryAfterMs = null;
            updateNext(null);
            updateStatus($"{JobLabel(job)} - queued");

            try
            {
                await _tickGate.WaitAsync(cancellationToken);
                TickOutcome result;
                try
                {
                    result = await RunTickJobAsync(job, config, jobConfig, cancellationToken);
                }
                finally
                {
                    _tickGate.Release();
                }

                var failureText = result.Fail > 0
                    ? result.ErrorSummary ?? result.LogLine
                    : null;
                failureInfo = result.Failure ??
                    (string.IsNullOrWhiteSpace(failureText)
                        ? null
                        : RefreshErrorClassifier.Classify(failureText));
                retryAfterMs = result.RetryAfterMs;
                logger.Info(result.LogLine);
                updateStatus(
                    failureInfo?.Code == RefreshErrorCodes.RateLimited
                        ? $"Rate limited - {FormatPhaseStatus(result)}"
                        : FormatPhaseStatus(result));
                updateLast($"{DateTimeOffset.Now:hh:mm tt} - {result.Ok} saved, {result.Skipped} unchanged{(result.Fail > 0 ? $", {result.Fail} failed" : string.Empty)}");
                SetJobError(job, failureText);
                SetFailureState(
                    job,
                    result.Fail > 0 ? failureInfo : null,
                    failureText);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                failureInfo = RefreshErrorClassifier.Classify(ex);
                retryAfterMs = ex switch
                {
                    CronApiException cron => cron.RetryAfterMs,
                    RiotApiException riot => riot.RetryAfterMs,
                    DiscordApiException discord => discord.RetryAfterMs,
                    _ => retryAfterMs,
                };
                logger.Error(RefreshErrorClassifier.SafeDiagnostic(JobLabel(job), ex));
                updateStatus($"{failureInfo.Title} - {failureInfo.Message}");
                updateLast($"{DateTimeOffset.Now:hh:mm tt} - failed");
                SetJobError(job, failureInfo.Message);
                SetFailureState(job, failureInfo, failureInfo.Message);
            }

            var elapsed = DateTimeOffset.Now - startedAt;
            var delay = ComputeNextDelay(
                job,
                jobConfig,
                elapsed,
                failureInfo,
                retryAfterMs);
            if (failureInfo?.BaseBackoffMinutes > 0)
            {
                logger.Info(
                    $"{failureInfo.Title}; cooling down {Math.Ceiling(delay.TotalMinutes)} minutes " +
                    $"before the next {JobLabel(job)} run.");
            }

            _updateState("running");
            _updateCurrent("Idle");
            updateNext(DateTimeOffset.Now.Add(delay));
            await Task.Delay(delay, cancellationToken);
        }
    }

    private async Task RunQueuedRankRequestsAsync(CancellationToken cancellationToken)
    {
        var pollInterval = TimeSpan.FromSeconds(20);

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var config = await AgentConfig.LoadAsync(
                    Path.Combine(_baseDirectory, "config.json"),
                    cancellationToken);
                if (!config.CronOnly && config.RankJob.Enabled)
                {
                    await _tickGate.WaitAsync(cancellationToken);
                    CronResult result;
                    try
                    {
                        result = await DirectService().RefreshOneQueuedRankAsync(
                            config.RankJob,
                            cancellationToken);
                    }
                    finally
                    {
                        _tickGate.Release();
                    }

                    if (result.Scanned > 0)
                    {
                        var outcome = new TickOutcome(
                            result.Ok,
                            result.Fail,
                            result.Skipped,
                            result.Scanned,
                            BuildCronPlayerSummary(result.Players),
                            PrefixError("Queued rank", BuildCronErrorSummary(result.Errors)),
                            result.RetryAfterMs,
                            BuildDominantFailure(result.Errors));
                        _rankLogger.Info($"Queued rank: {outcome.LogLine}");
                        _updateRankStatus(FormatPhaseStatus(outcome));
                        _updateRankLast(
                            $"{DateTimeOffset.Now:hh:mm tt} - {result.Ok} queued rank saved" +
                            (result.Fail > 0 ? $", {result.Fail} failed" : string.Empty));
                        SetJobError(
                            RefreshJob.Rank,
                            result.Fail > 0 ? outcome.ErrorSummary ?? outcome.LogLine : null);
                        SetFailureState(
                            RefreshJob.Rank,
                            result.Fail > 0 ? outcome.Failure : null,
                            outcome.ErrorSummary ?? outcome.LogLine);
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                var failure = RefreshErrorClassifier.Classify(ex);
                _rankLogger.Error(RefreshErrorClassifier.SafeDiagnostic("Queued rank watcher", ex));
                SetJobError(RefreshJob.Rank, failure.Message);
                SetFailureState(RefreshJob.Rank, failure, failure.Message);
            }

            await Task.Delay(pollInterval, cancellationToken);
        }
    }

    private TimeSpan ComputeNextDelay(
        RefreshJob job,
        JobConfig jobConfig,
        TimeSpan elapsed,
        RefreshFailureInfo? failure,
        int? retryAfterMs)
    {
        // Schedule from completion, not from the previous start. A slow run must
        // never turn into a one-second catch-up loop that immediately spends the
        // Riot quota again.
        _ = elapsed;
        var minimumIntervalSeconds = job == RefreshJob.Live ? 15 * 60 : 10 * 60;
        var normalDelay = TimeSpan.FromSeconds(Math.Max(minimumIntervalSeconds, jobConfig.IntervalSec));

        if (failure is null || failure.BaseBackoffMinutes <= 0)
        {
            lock (_failureSync)
            {
                _failureStrikes.Remove(job);
            }
            if (retryAfterMs is { } idleRetryAfterMs)
            {
                var retryAfter = TimeSpan.FromMilliseconds(
                    Math.Max(1000, idleRetryAfterMs));
                return retryAfter > normalDelay ? retryAfter : normalDelay;
            }

            return normalDelay;
        }

        int strikes;
        lock (_failureSync)
        {
            strikes = _failureStrikes.TryGetValue(job, out var previous) &&
                      previous.Code == failure.Code
                ? previous.Strikes + 1
                : 1;
            strikes = Math.Min(strikes, 6);
            _failureStrikes[job] = (failure.Code, strikes);
        }

        var maxMinutes = job == RefreshJob.Live ? 90 : 60;
        var cooldown = TimeSpan.FromMinutes(
            Math.Min(maxMinutes, failure.BaseBackoffMinutes * strikes));
        if (retryAfterMs is { } exactRetryAfterMs)
        {
            var retryAfter = TimeSpan.FromMilliseconds(Math.Max(1000, exactRetryAfterMs));
            if (retryAfter > cooldown)
            {
                cooldown = retryAfter;
            }
        }
        return cooldown > normalDelay ? cooldown : normalDelay;
    }

    private void SetFailureState(
        RefreshJob job,
        RefreshFailureInfo? failure,
        string? displayMessage = null)
    {
        var message = string.IsNullOrWhiteSpace(displayMessage)
            ? failure?.Message ?? string.Empty
            : RefreshErrorClassifier.SafeText(displayMessage, 360);

        if (job == RefreshJob.Rank)
        {
            if (failure is not null && _lastRankFailureCode != failure.Code)
            {
                _notify(
                    $"RiftBoard Rank - {failure.Title}",
                    TrimForNotification(message),
                    failure.Retryable ? ToolTipIcon.Warning : ToolTipIcon.Error);
            }
            _lastRankFailureCode = failure?.Code;
            return;
        }

        if (job == RefreshJob.Tft)
        {
            if (failure is not null && _lastTftFailureCode != failure.Code)
            {
                _notify(
                    $"RiftBoard TFT - {failure.Title}",
                    TrimForNotification(message),
                    failure.Retryable ? ToolTipIcon.Warning : ToolTipIcon.Error);
            }
            _lastTftFailureCode = failure?.Code;
            return;
        }

        if (failure is not null && _lastLiveFailureCode != failure.Code)
        {
            _notify(
                $"RiftBoard Live Games - {failure.Title}",
                TrimForNotification(message),
                failure.Retryable ? ToolTipIcon.Warning : ToolTipIcon.Error);
        }
        _lastLiveFailureCode = failure?.Code;
    }

    private void SetJobError(RefreshJob job, string? message)
    {
        message = RefreshErrorClassifier.SafeText(message, 360);
        string latest;
        lock (_failureSync)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                _jobErrors.Remove(job);
            }
            else
            {
                _jobErrors[job] = (message, DateTimeOffset.Now);
            }

            latest = _jobErrors.Count == 0
                ? "None"
                : _jobErrors.Values
                    .OrderByDescending(error => error.At)
                    .First()
                    .Message;
        }

        _updateLastError(latest);
    }

    private async Task<TickOutcome> RunTickJobAsync(RefreshJob job, AgentConfig config, JobConfig jobConfig, CancellationToken cancellationToken)
    {
        _updateCurrent(JobLabel(job));
        var result = config.CronOnly
            ? await RunRemoteCronJobAsync(job, config, jobConfig, cancellationToken)
            : await DirectService().RefreshAsync(job, jobConfig, cancellationToken);

        return new TickOutcome(
            result.Ok,
            result.Fail,
            result.Skipped,
            result.Scanned,
            BuildCronPlayerSummary(result.Players),
            PrefixError(JobLabel(job), BuildCronErrorSummary(result.Errors)),
            result.RetryAfterMs,
            BuildDominantFailure(result.Errors));
    }

    private CSharpRefreshService DirectService() =>
        _directService ??= new CSharpRefreshService(_repoRoot);

    private async Task<CronResult> RunRemoteCronJobAsync(
        RefreshJob job,
        AgentConfig config,
        JobConfig jobConfig,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(config.CronToken))
        {
            throw new InvalidOperationException("Missing cron token in config.json.");
        }

        var path = job switch
        {
            RefreshJob.Rank => "/api/cron/leaderboard",
            RefreshJob.Tft => "/api/cron/tft-matches",
            _ => "/api/cron/live-games",
        };
        var baseUrl = config.RemoteAppUrl.TrimEnd('/');
        var url = new UriBuilder($"{baseUrl}{path}");
        var query = new List<string>
        {
            $"limit={jobConfig.Limit}",
            $"delayMs={jobConfig.DelayMs}",
        };

        if (job != RefreshJob.Live)
        {
            query.Add($"matchesCount={jobConfig.MatchesCount}");
            if (jobConfig.CooldownMs is { } cooldownMs) query.Add($"cooldownMs={cooldownMs}");
            if (jobConfig.Force) query.Add("force=1");
        }

        if (job == RefreshJob.Rank)
        {
            query.Add($"syncMatches={(jobConfig.SyncMatches ? "1" : "0")}");
            query.Add("syncTftMatches=0");
            query.Add($"matchBackfillCount={jobConfig.MatchBackfillCount}");
        }

        url.Query = string.Join("&", query);

        using var request = new HttpRequestMessage(HttpMethod.Get, url.Uri);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", config.CronToken);
        using var timeoutSource =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(TimeSpan.FromSeconds(
            EstimateRefreshTimeoutSeconds(jobConfig, config.StartupTimeoutSec)));
        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, timeoutSource.Token);
        }
        catch (OperationCanceledException ex) when (
            !cancellationToken.IsCancellationRequested &&
            timeoutSource.IsCancellationRequested)
        {
            throw new CronApiException(
                408,
                "The website refresh request timed out.",
                null,
                ex);
        }
        catch (HttpRequestException ex)
        {
            throw new CronApiException(
                0,
                "The tray could not reach the RiftBoard website.",
                null,
                ex);
        }

        using (response)
        {
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        CronResponse? payload = null;
        try
        {
            payload = JsonSerializer.Deserialize<CronResponse>(text, AgentConfig.JsonOptions);
        }
        catch
        {
        }

        var retryAfterMs = GetResponseRetryAfterMilliseconds(response);
        if (response.IsSuccessStatusCode && payload is null)
        {
            throw new JsonException(
                "The website refresh response was not valid JSON.");
        }

        if (
            (int)response.StatusCode == 202 &&
            payload?.Ok == true &&
            payload.Skipped)
        {
            var busy = payload.Result ?? new CronResult();
            busy.Skipped = Math.Max(1, busy.Skipped);
            busy.RetryAfterMs = retryAfterMs;
            busy.Players.Add(new CronPlayer
            {
                Name = string.IsNullOrWhiteSpace(payload.Reason)
                    ? "Another refresh is already running"
                    : RefreshErrorClassifier.SafeText(payload.Reason, 180),
                Status = "skipped",
            });
            return busy;
        }

        if ((int)response.StatusCode == 429)
        {
            var partial = payload?.Result ?? new CronResult();
            var failure = RefreshErrorClassifier.Classify(
                new CronApiException(
                    429,
                    payload?.Error ?? "Refresh rate limit reached.",
                    retryAfterMs));
            partial.Fail = Math.Max(1, partial.Fail);
            partial.RetryAfterMs = retryAfterMs ??
                partial.RetryAfterMs ??
                (int)TimeSpan.FromMinutes(failure.BaseBackoffMinutes).TotalMilliseconds;
            if (!partial.Errors.Any(error =>
                    RefreshErrorClassifier.Classify(error).Code ==
                    RefreshErrorCodes.RateLimited))
            {
                partial.Errors.Add(new CronError
                {
                    Name = "Remote refresh",
                    Error = failure.Message,
                    Code = failure.Code,
                    Retryable = failure.Retryable,
                    UpstreamStatus = failure.Status,
                });
            }
            return partial;
        }

        if (!response.IsSuccessStatusCode || payload?.Ok != true)
        {
            var error = string.IsNullOrWhiteSpace(payload?.Error)
                ? response.ReasonPhrase ?? "Refresh request failed"
                : payload.Error;
            throw new CronApiException(
                (int)response.StatusCode,
                RefreshErrorClassifier.SafeText(error, 300),
                retryAfterMs);
        }

        if (payload.Result is null)
        {
            throw new JsonException(
                "The website refresh response did not contain a result.");
        }

        payload.Result.RetryAfterMs ??= retryAfterMs;
        return payload.Result;
        }
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

        var classified = errors
            .Select(error => new
            {
                Error = error,
                Failure = RefreshErrorClassifier.Classify(error),
            })
            .ToArray();

        var groups = classified
            .GroupBy(item => item.Failure.Code)
            .Take(3)
            .Select(group =>
            {
                var failure = group.First().Failure;
                var names = group
                    .Select(item => string.IsNullOrWhiteSpace(item.Error.Name)
                        ? item.Error.PlayerId
                        : item.Error.Name)
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(3)
                    .ToArray();
                var affectedSuffix = group.Count() > names.Length
                    ? $" (+{group.Count() - names.Length} more)"
                    : string.Empty;
                var affected = names.Length == 0
                    ? string.Empty
                    : $" Affected: {string.Join(", ", names)}{affectedSuffix}.";
                return $"{failure.Message}{affected}";
            })
            .ToArray();

        var categoryCount = classified
            .Select(item => item.Failure.Code)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        var categorySuffix = categoryCount > groups.Length
            ? $" (+{categoryCount - groups.Length} other error type)"
            : string.Empty;
        return string.Join(" | ", groups) + categorySuffix;
    }

    private static RefreshFailureInfo? BuildDominantFailure(
        IReadOnlyList<CronError>? errors)
    {
        return errors is null
            ? null
            : RefreshErrorClassifier.Dominant(
                errors.Select(RefreshErrorClassifier.Classify));
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

    private static int? GetResponseRetryAfterMilliseconds(
        HttpResponseMessage response)
    {
        if (response.Headers.RetryAfter?.Delta is { } delta)
        {
            return Math.Max(1000, (int)Math.Ceiling(delta.TotalMilliseconds));
        }

        if (response.Headers.RetryAfter?.Date is { } retryAt)
        {
            var remaining = retryAt - DateTimeOffset.UtcNow;
            return Math.Max(1000, (int)Math.Ceiling(remaining.TotalMilliseconds));
        }

        return null;
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

        return baseDirectory;
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
    private const int LivePostFormatVersion = 4;
    private const int RiotRequestSpacingMs = 1300;
    private const int RiotMaxAttempts = 3;
    private const int RiotFallbackRetryAfterMs = 2 * 60 * 1000;
    private const string RiotRefreshLeaseId = "riot-api-refresh";
    private static readonly TimeSpan RiotRefreshLeaseDuration = TimeSpan.FromMinutes(60);
    private static readonly string[] SeaPlatforms = ["sg2", "th2", "ph2", "vn2", "tw2"];
    private static readonly SemaphoreSlim RiotRequestGate = new(1, 1);
    private static DateTimeOffset _riotNextRequestAt = DateTimeOffset.MinValue;
    private static DateTimeOffset _riotBlockedUntil = DateTimeOffset.MinValue;
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
    private readonly IMongoCollection<BsonDocument> _matches;
    private readonly IMongoCollection<BsonDocument> _playerMatches;
    private readonly IMongoCollection<BsonDocument> _tftMatches;
    private readonly IMongoCollection<BsonDocument> _tftPlayerMatches;
    private readonly IMongoCollection<BsonDocument> _discordLinks;
    private readonly IMongoCollection<BsonDocument> _liveGamePosts;
    private readonly IMongoCollection<BsonDocument> _participantProfiles;
    private readonly IMongoCollection<BsonDocument> _schedulerLeases;
    private Dictionary<int, string>? _championNames;
    private Dictionary<int, string>? _championIcons;
    private DateTime _championNamesLoadedAt;

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
        _matches = db.GetCollection<BsonDocument>("matches");
        _playerMatches = db.GetCollection<BsonDocument>("playermatches");
        _tftMatches = db.GetCollection<BsonDocument>("tftmatches");
        _tftPlayerMatches = db.GetCollection<BsonDocument>("tftplayermatches");
        _discordLinks = db.GetCollection<BsonDocument>("discordlinks");
        _liveGamePosts = db.GetCollection<BsonDocument>("livegameposts");
        _participantProfiles = db.GetCollection<BsonDocument>("participantprofiles");
        _schedulerLeases = db.GetCollection<BsonDocument>("schedulerleases");
    }

    public async Task<CronResult> RefreshAsync(RefreshJob job, JobConfig config, CancellationToken cancellationToken)
    {
        var leaseOwner = $"{Environment.MachineName}:{Environment.ProcessId}:{Guid.NewGuid():N}";
        if (!await TryAcquireRiotRefreshLeaseAsync(leaseOwner, cancellationToken))
        {
            return new CronResult
            {
                Skipped = 1,
                Players =
                [
                    new CronPlayer
                    {
                        PlayerId = RiotRefreshLeaseId,
                        Name = "Riot refresh busy (another runner owns the lease)",
                        Status = "skipped",
                    },
                ],
            };
        }

        var releaseLease = true;
        try
        {
            var result = await RefreshWithLeaseAsync(job, config, cancellationToken);
            if (result.RetryAfterMs is { } cooldownMs)
            {
                releaseLease = false;
                await HoldRiotRefreshLeaseForCooldownAsync(leaseOwner, cooldownMs);
            }

            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            var failure = RefreshErrorClassifier.Classify(ex);
            if (failure.StopBatch)
            {
                releaseLease = false;
                var cooldownMs = FailureCooldownMilliseconds(failure, ex);
                BlockRiotRequestsFor(cooldownMs);
                await HoldRiotRefreshLeaseForCooldownAsync(leaseOwner, cooldownMs);
            }
            throw;
        }
        finally
        {
            if (releaseLease)
            {
                try
                {
                    await ReleaseRiotRefreshLeaseAsync(leaseOwner);
                }
                catch
                {
                    // A failed release must not hide the refresh result. The lease
                    // has a fixed expiry and becomes recoverable without operator
                    // action.
                }
            }
        }
    }

    public async Task<CronResult> RefreshOneQueuedRankAsync(
        JobConfig config,
        CancellationToken cancellationToken)
    {
        // Avoid even touching the shared Riot lease when there is no durable
        // owner request waiting.
        var hasQueuedRequest = await _players
            .Find(QueuedRankRefreshFilter())
            .Project(Builders<BsonDocument>.Projection.Include("_id"))
            .Limit(1)
            .FirstOrDefaultAsync(cancellationToken);
        if (hasQueuedRequest is null)
        {
            return new CronResult();
        }

        var leaseOwner = $"{Environment.MachineName}:{Environment.ProcessId}:queued-rank:{Guid.NewGuid():N}";
        if (!await TryAcquireRiotRefreshLeaseAsync(leaseOwner, cancellationToken))
        {
            return new CronResult { Skipped = 1 };
        }

        var releaseLease = true;
        try
        {
            var result = await RefreshOneQueuedRankWithLeaseAsync(config, cancellationToken);
            if (result.RetryAfterMs is { } cooldownMs)
            {
                releaseLease = false;
                await HoldRiotRefreshLeaseForCooldownAsync(leaseOwner, cooldownMs);
            }

            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            var failure = RefreshErrorClassifier.Classify(ex);
            if (failure.StopBatch)
            {
                releaseLease = false;
                var cooldownMs = FailureCooldownMilliseconds(failure, ex);
                BlockRiotRequestsFor(cooldownMs);
                await HoldRiotRefreshLeaseForCooldownAsync(leaseOwner, cooldownMs);
            }
            throw;
        }
        finally
        {
            if (releaseLease)
            {
                try
                {
                    await ReleaseRiotRefreshLeaseAsync(leaseOwner);
                }
                catch
                {
                    // The fixed lease expiry makes a failed release recoverable.
                }
            }
        }
    }

    private async Task<CronResult> RefreshOneQueuedRankWithLeaseAsync(
        JobConfig config,
        CancellationToken cancellationToken)
    {
        var result = new CronResult();
        var player = await _players
            .Find(QueuedRankRefreshFilter())
            .Sort(Builders<BsonDocument>.Sort.Ascending("rankRefresh.requestedAt").Ascending("updatedAt"))
            .Limit(1)
            .FirstOrDefaultAsync(cancellationToken);
        if (player is null)
        {
            return result;
        }

        result.Scanned = 1;
        var id = player.GetValue("_id").AsObjectId;
        var name = $"{ReadString(player, "gameName")}#{ReadString(player, "tagLine")}";
        var rankOnlyConfig = config with
        {
            Limit = 1,
            SyncMatches = false,
            SyncTftMatches = false,
            MatchBackfillCount = 0,
        };

        try
        {
            await RefreshRankAsync(
                player,
                rankOnlyConfig,
                cancellationToken,
                syncTftRank: false);
            result.Ok = 1;
            result.Players.Add(new CronPlayer
            {
                PlayerId = id.ToString(),
                Name = name,
                Status = "ok",
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            var failure = RefreshErrorClassifier.Classify(ex);
            result.Fail = 1;
            result.Errors.Add(new CronError
            {
                PlayerId = id.ToString(),
                Name = name,
                Error = failure.Message,
                Code = failure.Code,
                Retryable = failure.Retryable,
                UpstreamStatus = failure.Status,
            });
            result.Players.Add(new CronPlayer
            {
                PlayerId = id.ToString(),
                Name = name,
                Status = "failed",
            });
            ApplySystemicCooldown(result, failure, ex);
        }

        return result;
    }

    private static FilterDefinition<BsonDocument> QueuedRankRefreshFilter()
    {
        return Builders<BsonDocument>.Filter.Type(
            "rankRefresh.requestedAt",
            BsonType.DateTime);
    }

    private async Task<CronResult> RefreshWithLeaseAsync(RefreshJob job, JobConfig config, CancellationToken cancellationToken)
    {
        if (job == RefreshJob.Live)
        {
            return await PublishLiveGamesAsync(config, cancellationToken);
        }

        var result = new CronResult();
        var approvedLeaderboard =
            Builders<BsonDocument>.Filter.Eq("leaderboard.group", "burmese") &
            Builders<BsonDocument>.Filter.Eq("leaderboard.status", "approved");

        List<BsonDocument> players;
        if (job == RefreshJob.Rank)
        {
            var lolTrackingEnabled = Builders<BsonDocument>.Filter.Ne("track.lol", false);
            var queuedRankRefresh = QueuedRankRefreshFilter();

            // User-requested rank updates are durable and may belong to a linked
            // account that is not on the public leaderboard. Drain those first,
            // oldest request first, then use the remaining batch capacity for
            // the stalest approved rank snapshots.
            var queuedPlayers = await _players
                .Find(queuedRankRefresh)
                .Sort(Builders<BsonDocument>.Sort.Ascending("rankRefresh.requestedAt").Ascending("updatedAt"))
                .Limit(config.Limit)
                .ToListAsync(cancellationToken);

            players = queuedPlayers;
            var remaining = config.Limit - queuedPlayers.Count;
            if (remaining > 0)
            {
                var retryReady =
                    Builders<BsonDocument>.Filter.Exists("rankRefresh.retryAfterAt", false) |
                    Builders<BsonDocument>.Filter.Lte("rankRefresh.retryAfterAt", DateTime.UtcNow);
                var regularFilter =
                    approvedLeaderboard &
                    lolTrackingEnabled &
                    retryReady;
                if (queuedPlayers.Count > 0)
                {
                    regularFilter &= Builders<BsonDocument>.Filter.Nin(
                        "_id",
                        queuedPlayers.Select(player => player.GetValue("_id"))
                    );
                }

                var rankSortParts = new List<SortDefinition<BsonDocument>>
                {
                    Builders<BsonDocument>.Sort.Ascending("solo.fetchedAt"),
                    Builders<BsonDocument>.Sort.Ascending("flex.fetchedAt"),
                };
                if (config.SyncMatches && config.MatchBackfillCount > 0)
                {
                    rankSortParts.Add(Builders<BsonDocument>.Sort.Ascending("matchSync.backfillLastSyncAt"));
                }
                if (config.SyncMatches)
                {
                    rankSortParts.Add(Builders<BsonDocument>.Sort.Ascending("matchSync.lastSyncAt"));
                }
                rankSortParts.Add(Builders<BsonDocument>.Sort.Ascending("lastRefreshAt"));
                rankSortParts.Add(Builders<BsonDocument>.Sort.Ascending("updatedAt"));

                var regularPlayers = await _players
                    .Find(regularFilter)
                    .Sort(Builders<BsonDocument>.Sort.Combine(rankSortParts))
                    .Limit(remaining)
                    .ToListAsync(cancellationToken);
                players.AddRange(regularPlayers);
            }
        }
        else
        {
            var retryReady =
                Builders<BsonDocument>.Filter.Exists("tftMatchSync.retryAfterAt", false) |
                Builders<BsonDocument>.Filter.Lte("tftMatchSync.retryAfterAt", DateTime.UtcNow);
            var tftFilter =
                approvedLeaderboard &
                Builders<BsonDocument>.Filter.Ne("track.tft", false) &
                Builders<BsonDocument>.Filter.Ne("tftMatchSync.enabled", false) &
                retryReady;
            var tftSort = Builders<BsonDocument>.Sort
                .Ascending("tftMatchSync.lastSyncAt")
                .Ascending("tft.fetchedAt")
                .Ascending("updatedAt");
            players = await _players
                .Find(tftFilter)
                .Sort(tftSort)
                .Limit(config.Limit)
                .ToListAsync(cancellationToken);
        }

        foreach (var player in players)
        {
            result.Scanned++;
            var id = player.GetValue("_id").AsObjectId;
            var name = $"{ReadString(player, "gameName")}#{ReadString(player, "tagLine")}";
            try
            {
                if (job == RefreshJob.Rank)
                {
                    await RefreshRankAsync(
                        player,
                        config,
                        cancellationToken,
                        syncTftRank: false);
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
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                var failure = RefreshErrorClassifier.Classify(ex);
                if (job == RefreshJob.Tft && !failure.StopBatch)
                {
                    try
                    {
                        await MarkTftRefreshFailedAsync(id, failure);
                    }
                    catch
                    {
                        // Preserve the original player failure if optional
                        // retry bookkeeping cannot be stored.
                    }
                }
                result.Fail++;
                result.Errors.Add(new CronError
                {
                    PlayerId = id.ToString(),
                    Name = name,
                    Error = failure.Message,
                    Code = failure.Code,
                    Retryable = failure.Retryable,
                    UpstreamStatus = failure.Status,
                });
                result.Players.Add(new CronPlayer { PlayerId = id.ToString(), Name = name, Status = "failed" });
                ApplySystemicCooldown(result, failure, ex);
                if (failure.StopBatch)
                {
                    break;
                }
            }
        }

        return result;
    }

    public async Task SendTestLivePostAsync(CancellationToken cancellationToken)
    {
        if (!LiveGameDiscordConfigured())
        {
            throw new InvalidOperationException("Missing DISCORD_BOT_TOKEN or DISCORD_LIVE_GAMES_CHANNEL_ID.");
        }

        var dummyRiotIds = new[]
        {
            ("Zet", "kat22"),
            ("N A n G", "520"),
            ("ISuccPykeHarpoon", "Augh"),
            ("Aung36", "412"),
            ("Skull Shogun", "2652"),
        };
        var allowedUserIds = await LoadDiscordUserIdsForRiotIdsAsync(dummyRiotIds, cancellationToken);
        var content = allowedUserIds.Length > 0
            ? string.Join(" ", allowedUserIds.Select(id => $"<@{id}>"))
            : "Zet#kat22, N A n G#520, ISuccPykeHarpoon#Augh, Aung36#412, Skull Shogun#2652";

        var message = new LiveDiscordMessage(content, [
            new Dictionary<string, object?>
            {
                ["title"] = "Ranked Solo/Duo live on SG2",
                ["description"] = $"Dummy layout test - {DateTimeOffset.Now:hh:mm tt}",
                ["color"] = 0x4ba3ff,
                ["thumbnail"] = new Dictionary<string, object?>
                {
                    ["url"] = NeutralLiveThumbnailUrl(),
                },
                ["fields"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Blue",
                        ["value"] = $"Seraphine - Zet#kat22 - {RankLabel("DIAMOND", "IV", 16)}\nKha'Zix - N A n G#520 - {RankLabel("EMERALD", "III", 71)}\nMordekaiser - ISuccPykeHarpoon#Augh - {RankLabel("PLATINUM", "IV", 37)}\nHwei - Aung36#412 - {RankLabel("DIAMOND", "II", 67)}\nCho'Gath - Skull Shogun#2652 - {RankLabel("MASTER", "I", 29)}",
                        ["inline"] = false,
                    },
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Red",
                        ["value"] = $"Aphelios - REDNick#1493 - {RankLabel("MASTER", "I", 112)}\nNunu & Willump - tiny url enjoyer#00000 - {RankLabel("EMERALD", "II", 9)}\nK'Sante - กินข้าวยัง#TH2 - {RankLabel("PLATINUM", "I", 63)}\nVel'Koz - iiilllIIIIllIlIIl#enemy - {RankLabel("GOLD", "IV", 7)}\nDr. Mundo - mundo mundo mundo mundo#MUNDO",
                        ["inline"] = false,
                    },
                },
                ["footer"] = new Dictionary<string, object?> { ["text"] = "RiftBoard live games test" },
                ["timestamp"] = DateTimeOffset.UtcNow.ToString("O"),
            }
        ], allowedUserIds);

        await SendDiscordChannelMessageAsync(LiveGamesChannelId(), message, cancellationToken);
    }

    private async Task<CronResult> PublishLiveGamesAsync(JobConfig config, CancellationToken cancellationToken)
    {
        var result = new CronResult();
        if (!LiveGameDiscordConfigured())
        {
            throw new InvalidOperationException("Missing DISCORD_BOT_TOKEN or DISCORD_LIVE_GAMES_CHANNEL_ID.");
        }

        var now = DateTime.UtcNow;
        var verifiedLinks = await _discordLinks.Find(
            Builders<BsonDocument>.Filter.Eq("verifiedBinding", true) &
            Builders<BsonDocument>.Filter.In("verificationSource", new[] { "discord_connections", "riot_rso", "legacy_manual" }))
            .ToListAsync(cancellationToken);
        var linksByPlayerId = verifiedLinks
            .Where(link => link.TryGetValue("playerId", out var playerId) && playerId.IsObjectId)
            .GroupBy(link => link.GetValue("playerId").AsObjectId)
            .ToDictionary(group => group.Key, group => group.ToList());
        var linkedPlayerIds = linksByPlayerId.Keys.ToList();

        var retryReady =
            Builders<BsonDocument>.Filter.Exists("liveGame.retryAfterAt", false) |
            Builders<BsonDocument>.Filter.Lte("liveGame.retryAfterAt", DateTime.UtcNow);
        var approvedFilter = retryReady &
                             Builders<BsonDocument>.Filter.Eq("leaderboard.group", "burmese") &
                             Builders<BsonDocument>.Filter.Eq("leaderboard.status", "approved") &
                             Builders<BsonDocument>.Filter.Ne("track.lol", false) &
                             Builders<BsonDocument>.Filter.Type("puuid", BsonType.String);
        var linkedFilter = linkedPlayerIds.Count == 0
            ? Builders<BsonDocument>.Filter.Where(_ => false)
            : retryReady &
              Builders<BsonDocument>.Filter.In("_id", linkedPlayerIds) &
              Builders<BsonDocument>.Filter.Ne("track.lol", false) &
              Builders<BsonDocument>.Filter.Type("puuid", BsonType.String);
        var players = await _players.Find(linkedFilter | approvedFilter)
            .Sort(Builders<BsonDocument>.Sort.Ascending("liveGame.checkedAt").Descending("lastRefreshAt").Descending("updatedAt"))
            .Limit(config.Limit)
            .ToListAsync(cancellationToken);
        foreach (var player in players)
        {
            var playerId = player.GetValue("_id").AsObjectId;
            if (!linksByPlayerId.TryGetValue(playerId, out var links)) continue;
            player["liveDiscordUsers"] = new BsonArray(links
                .Select(link => new BsonDocument
                {
                    ["discordUserId"] = ReadString(link, "discordUserId") ?? "",
                    ["discordUsername"] = ReadString(link, "discordUsername") ?? "",
                })
                .Where(doc => !string.IsNullOrWhiteSpace(doc["discordUserId"].AsString))
                .GroupBy(doc => doc["discordUserId"].AsString)
                .Select(group => group.First()));
        }

        var liveGames = new Dictionary<string, (string Platform, JsonElement Game, List<BsonDocument> Players)>(StringComparer.Ordinal);

        foreach (var player in players)
        {
            result.Scanned++;
            var id = player.GetValue("_id").AsObjectId;
            var name = $"{ReadString(player, "gameName")}#{ReadString(player, "tagLine")}";
            var puuid = ReadString(player, "puuid");
            if (string.IsNullOrWhiteSpace(puuid))
            {
                var failure = RefreshErrorClassifier.Classify(
                    "The player record is missing a Riot puuid.");
                result.Fail++;
                result.Errors.Add(new CronError
                {
                    PlayerId = id.ToString(),
                    Name = name,
                    Error = failure.Message,
                    Code = failure.Code,
                    Retryable = failure.Retryable,
                });
                result.Players.Add(new CronPlayer
                {
                    PlayerId = id.ToString(),
                    Name = name,
                    Status = "failed",
                });
                try
                {
                    await MarkLiveGameAttemptFailedAsync(id, failure);
                }
                catch
                {
                }
                continue;
            }

            try
            {
                var found = await FindActiveGameAsync(puuid, ReadString(player, "platform"), cancellationToken);
                await MarkLiveGameCheckedAsync(id, DateTime.UtcNow, cancellationToken);
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
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                var failure = RefreshErrorClassifier.Classify(ex);
                result.Fail++;
                result.Errors.Add(new CronError
                {
                    PlayerId = id.ToString(),
                    Name = name,
                    Error = failure.Message,
                    Code = failure.Code,
                    Retryable = failure.Retryable,
                    UpstreamStatus = failure.Status,
                });
                result.Players.Add(new CronPlayer { PlayerId = id.ToString(), Name = name, Status = "failed" });
                ApplySystemicCooldown(result, failure, ex);
                try
                {
                    await MarkLiveGameAttemptFailedAsync(id, failure);
                }
                catch
                {
                    // Preserve the original provider/player failure if optional
                    // attempt bookkeeping cannot be stored.
                }
                if (failure.StopBatch)
                {
                    break;
                }
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
                var existingFormatVersion = existing.TryGetValue("formatVersion", out var rawVersion) && rawVersion.IsNumeric
                    ? rawVersion.ToInt32()
                    : 0;
                var messageId = ReadString(existing, "messageId");
                if (!string.IsNullOrWhiteSpace(messageId))
                {
                    try
                    {
                        if (existingFormatVersion < LivePostFormatVersion)
                        {
                            var knownPlayers = await LoadKnownPlayersForLiveGameAsync(group.Platform, group.Game, group.Players, cancellationToken);
                            await EditDiscordChannelMessageAsync(
                                LiveGamesChannelId(),
                                messageId,
                                await BuildLiveGameMessageAsync(group.Platform, group.Game, group.Players, knownPlayers, cancellationToken),
                                cancellationToken);
                            await _liveGamePosts.UpdateOneAsync(
                                Builders<BsonDocument>.Filter.Eq("_id", existing.GetValue("_id").AsObjectId),
                                Builders<BsonDocument>.Update
                                    .Set("lastSeenAt", now)
                                    .Set("updatedAt", now)
                                    .Set("riotIds", new BsonArray(riotIds))
                                    .Set("formatVersion", LivePostFormatVersion)
                                    .Unset("error"),
                                cancellationToken: cancellationToken);
                        }
                        else
                        {
                            await _liveGamePosts.UpdateOneAsync(
                                Builders<BsonDocument>.Filter.Eq("_id", existing.GetValue("_id").AsObjectId),
                                Builders<BsonDocument>.Update
                                    .Set("lastSeenAt", now)
                                    .Set("riotIds", new BsonArray(riotIds))
                                    .Unset("error"),
                                cancellationToken: cancellationToken);
                        }
                        result.Skipped++;
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        var failure = await RecordLivePostFailureAsync(
                            result,
                            group.Platform,
                            gameId,
                            group.Players,
                            riotIds,
                            now,
                            ex);
                        if (failure.StopBatch)
                        {
                            break;
                        }
                    }
                    continue;
                }
            }

            try
            {
                var knownPlayers = await LoadKnownPlayersForLiveGameAsync(group.Platform, group.Game, group.Players, cancellationToken);
                var message = await SendDiscordChannelMessageAsync(LiveGamesChannelId(), await BuildLiveGameMessageAsync(group.Platform, group.Game, group.Players, knownPlayers, cancellationToken), cancellationToken);
                var messageId = GetString(message, "id");
                await _liveGamePosts.UpdateOneAsync(
                    Builders<BsonDocument>.Filter.Eq("channelId", LiveGamesChannelId()) &
                    Builders<BsonDocument>.Filter.Eq("platform", group.Platform) &
                    Builders<BsonDocument>.Filter.Eq("gameId", gameId),
                    Builders<BsonDocument>.Update
                        .Set("playerIds", new BsonArray(group.Players.Select(p => p.GetValue("_id").AsObjectId)))
                        .Set("riotIds", new BsonArray(riotIds))
                        .Set("messageId", messageId is null ? (BsonValue)BsonNull.Value : new BsonString(messageId))
                        .Set("postedAt", now)
                        .Set("lastSeenAt", now)
                        .Set("formatVersion", LivePostFormatVersion)
                        .Set("updatedAt", now)
                        .Unset("error")
                        .SetOnInsert("channelId", LiveGamesChannelId())
                        .SetOnInsert("platform", group.Platform)
                        .SetOnInsert("gameId", gameId)
                        .SetOnInsert("createdAt", now),
                    new UpdateOptions { IsUpsert = true },
                    cancellationToken);
                result.Ok++;
                result.Players.Add(new CronPlayer { Name = string.Join(", ", riotIds.Take(3)), Status = "ok" });
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                var failure = await RecordLivePostFailureAsync(
                    result,
                    group.Platform,
                    gameId,
                    group.Players,
                    riotIds,
                    now,
                    ex);
                if (failure.StopBatch)
                {
                    break;
                }
            }
        }

        return result;
    }

    private async Task<RefreshFailureInfo> RecordLivePostFailureAsync(
        CronResult result,
        string platform,
        long gameId,
        IReadOnlyCollection<BsonDocument> players,
        IReadOnlyCollection<string> riotIds,
        DateTime now,
        Exception exception)
    {
        var failure = RefreshErrorClassifier.Classify(exception);
        ApplySystemicCooldown(result, failure, exception);
        result.Fail++;
        result.Errors.Add(new CronError
        {
            Name = $"{platform}:{gameId}",
            Error = failure.Message,
            Code = failure.Code,
            Retryable = failure.Retryable,
            UpstreamStatus = failure.Status,
        });

        try
        {
            await _liveGamePosts.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("channelId", LiveGamesChannelId()) &
                Builders<BsonDocument>.Filter.Eq("platform", platform) &
                Builders<BsonDocument>.Filter.Eq("gameId", gameId),
                Builders<BsonDocument>.Update
                    .Set(
                        "playerIds",
                        new BsonArray(players.Select(
                            player => player.GetValue("_id").AsObjectId)))
                    .Set("riotIds", new BsonArray(riotIds))
                    .Set("lastSeenAt", now)
                    .Set("updatedAt", now)
                    .Set("error", failure.Message)
                    .SetOnInsert("channelId", LiveGamesChannelId())
                    .SetOnInsert("platform", platform)
                    .SetOnInsert("gameId", gameId)
                    .SetOnInsert("createdAt", now),
                new UpdateOptions { IsUpsert = true },
                CancellationToken.None);
        }
        catch
        {
            // Keep the original Discord/provider error in the job result even if
            // optional diagnostic persistence is unavailable.
        }

        return failure;
    }

    private async Task<bool> TryAcquireRiotRefreshLeaseAsync(string owner, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var filter =
            Builders<BsonDocument>.Filter.Eq("_id", RiotRefreshLeaseId) &
            (Builders<BsonDocument>.Filter.Lte("leaseUntil", now) |
             Builders<BsonDocument>.Filter.Exists("leaseUntil", false));
        var update = Builders<BsonDocument>.Update.Combine(
            Builders<BsonDocument>.Update.Set("owner", owner),
            Builders<BsonDocument>.Update.Set("leaseUntil", now.Add(RiotRefreshLeaseDuration)),
            Builders<BsonDocument>.Update.Set("startedAt", now),
            Builders<BsonDocument>.Update.Set("updatedAt", now));

        try
        {
            var lease = await _schedulerLeases.FindOneAndUpdateAsync(
                filter,
                update,
                new FindOneAndUpdateOptions<BsonDocument>
                {
                    IsUpsert = true,
                    ReturnDocument = ReturnDocument.After,
                },
                cancellationToken);
            return lease is not null &&
                   string.Equals(ReadString(lease, "owner"), owner, StringComparison.Ordinal);
        }
        catch (MongoCommandException ex) when (ex.Code == 11000)
        {
            return false;
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Code == 11000)
        {
            return false;
        }
    }

    private async Task ReleaseRiotRefreshLeaseAsync(string owner)
    {
        var now = DateTime.UtcNow;
        await _schedulerLeases.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", RiotRefreshLeaseId) &
            Builders<BsonDocument>.Filter.Eq("owner", owner),
            Builders<BsonDocument>.Update.Combine(
                Builders<BsonDocument>.Update.Set("leaseUntil", now),
                Builders<BsonDocument>.Update.Set("updatedAt", now)),
            cancellationToken: CancellationToken.None);
    }

    private async Task HoldRiotRefreshLeaseForCooldownAsync(string owner, int cooldownMs)
    {
        var now = DateTime.UtcNow;
        try
        {
            await _schedulerLeases.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", RiotRefreshLeaseId) &
                Builders<BsonDocument>.Filter.Eq("owner", owner),
                Builders<BsonDocument>.Update.Combine(
                    Builders<BsonDocument>.Update.Set(
                        "leaseUntil",
                        now.AddMilliseconds(Math.Max(RiotFallbackRetryAfterMs, cooldownMs))),
                    Builders<BsonDocument>.Update.Set("updatedAt", now)),
                cancellationToken: CancellationToken.None);
        }
        catch
        {
            // Do not release after a rate limit even if the cooldown update fails.
            // The original 60-minute lease remains the safe fallback.
        }
    }

    private async Task MarkLiveGameCheckedAsync(ObjectId playerId, DateTime checkedAt, CancellationToken cancellationToken)
    {
        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            Builders<BsonDocument>.Update
                .Set("liveGame.checkedAt", checkedAt)
                .Set("liveGame.lastAttemptAt", checkedAt)
                .Unset("liveGame.lastError")
                .Unset("liveGame.lastErrorCode")
                .Unset("liveGame.retryAfterAt"),
            cancellationToken: cancellationToken);
    }

    private async Task MarkLiveGameAttemptFailedAsync(
        ObjectId playerId,
        RefreshFailureInfo failure)
    {
        var update = Builders<BsonDocument>.Update
            .Set("liveGame.lastAttemptAt", DateTime.UtcNow)
            .Set("liveGame.lastError", failure.Message)
            .Set("liveGame.lastErrorCode", failure.Code);
        if (!failure.StopBatch)
        {
            update = update.Set(
                "liveGame.retryAfterAt",
                DateTime.UtcNow.Add(PlayerFailureBackoff(failure)));
        }

        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            update,
            cancellationToken: CancellationToken.None);
    }

    private async Task<string[]> LoadDiscordUserIdsForRiotIdsAsync(
        IReadOnlyList<(string GameName, string TagLine)> riotIds,
        CancellationToken cancellationToken)
    {
        var playerFilters = riotIds
            .Select(riotId =>
                Builders<BsonDocument>.Filter.Eq("gameName", riotId.GameName) &
                Builders<BsonDocument>.Filter.Eq("tagLine", riotId.TagLine))
            .ToList();
        if (playerFilters.Count == 0) return [];

        var players = await _players.Find(Builders<BsonDocument>.Filter.Or(playerFilters))
            .Project(Builders<BsonDocument>.Projection.Include("_id").Include("gameName").Include("tagLine"))
            .ToListAsync(cancellationToken);
        var playersByRiotId = players
            .Where(player => player.TryGetValue("_id", out var id) && id.IsObjectId)
            .ToDictionary(PlayerRiotId, player => player.GetValue("_id").AsObjectId, StringComparer.OrdinalIgnoreCase);
        var orderedPlayerIds = riotIds
            .Select(riotId => $"{riotId.GameName}#{riotId.TagLine}")
            .Where(key => playersByRiotId.ContainsKey(key))
            .Select(key => playersByRiotId[key])
            .Distinct()
            .ToList();
        if (orderedPlayerIds.Count == 0) return [];

        var links = await _discordLinks.Find(
                Builders<BsonDocument>.Filter.In("playerId", orderedPlayerIds) &
                Builders<BsonDocument>.Filter.Eq("verifiedBinding", true) &
                Builders<BsonDocument>.Filter.Type("discordUserId", BsonType.String))
            .Project(Builders<BsonDocument>.Projection.Include("discordUserId").Include("playerId"))
            .ToListAsync(cancellationToken);
        var linksByPlayerId = links
            .Where(link => link.TryGetValue("playerId", out var playerId) && playerId.IsObjectId)
            .GroupBy(link => link.GetValue("playerId").AsObjectId)
            .ToDictionary(group => group.Key, group => group.ToList());

        return orderedPlayerIds
            .SelectMany(playerId => linksByPlayerId.TryGetValue(playerId, out var playerLinks) ? playerLinks : [])
            .Select(link => ReadString(link, "discordUserId"))
            .Where(id => !string.IsNullOrWhiteSpace(id) && id.All(char.IsDigit))
            .Select(id => id!)
            .Distinct(StringComparer.Ordinal)
            .Take(5)
            .ToArray();
    }

    private async Task<List<BsonDocument>> LoadKnownPlayersForLiveGameAsync(
        string platform,
        JsonElement game,
        IReadOnlyList<BsonDocument> trackedPlayers,
        CancellationToken cancellationToken)
    {
        var participants = GetArray(game, "participants");
        var puuids = participants
            .Select(participant => GetString(participant, "puuid"))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var riotIds = participants
            .Select(participant => GetString(participant, "riotId"))
            .Where(value => !string.IsNullOrWhiteSpace(value) && value!.Contains('#'))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var filters = new List<FilterDefinition<BsonDocument>>();
        if (puuids.Count > 0)
        {
            filters.Add(Builders<BsonDocument>.Filter.In("puuid", puuids));
        }

        foreach (var riotId in riotIds)
        {
            var hash = riotId.LastIndexOf('#');
            if (hash <= 0 || hash >= riotId.Length - 1) continue;
            var gameName = riotId[..hash];
            var tagLine = riotId[(hash + 1)..];
            filters.Add(
                Builders<BsonDocument>.Filter.Eq("gameName", gameName) &
                Builders<BsonDocument>.Filter.Eq("tagLine", tagLine));
        }

        var players = filters.Count == 0
            ? new List<BsonDocument>()
            : await _players.Find(Builders<BsonDocument>.Filter.Or(filters))
                .Project(Builders<BsonDocument>.Projection.Include("gameName").Include("tagLine").Include("puuid").Include("solo"))
                .ToListAsync(cancellationToken);
        await AttachLiveDiscordUsersAsync(players, cancellationToken);
        var playerPuuids = new HashSet<string>(
            players.Concat(trackedPlayers)
                .Select(player => ReadString(player, "puuid"))
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value!),
            StringComparer.OrdinalIgnoreCase);
        var participantProfiles = puuids.Count == 0
            ? new List<BsonDocument>()
            : await _participantProfiles.Find(Builders<BsonDocument>.Filter.In("puuid", puuids))
                .Project(Builders<BsonDocument>.Projection.Include("gameName").Include("tagLine").Include("puuid").Include("solo").Include("lastRankFetchAt"))
                .ToListAsync(cancellationToken);
        var profilesByPuuid = participantProfiles
            .Select(profile => new { Puuid = ReadString(profile, "puuid"), Profile = profile })
            .Where(item => !string.IsNullOrWhiteSpace(item.Puuid))
            .ToDictionary(item => item.Puuid!, item => item.Profile, StringComparer.OrdinalIgnoreCase);

        var now = DateTime.UtcNow;
        foreach (var participant in participants)
        {
            var puuid = GetString(participant, "puuid");
            if (string.IsNullOrWhiteSpace(puuid) || playerPuuids.Contains(puuid))
            {
                continue;
            }

            var riotId = GetString(participant, "riotId");
            var (gameName, tagLine) = SplitRiotId(riotId);
            profilesByPuuid.TryGetValue(puuid, out var existingProfile);
            var needsRankFetch = existingProfile is null || ParticipantRankCacheStale(existingProfile, now);
            var profile = existingProfile is not null ? new BsonDocument(existingProfile) : new BsonDocument
            {
                ["puuid"] = puuid,
            };
            if (!string.IsNullOrWhiteSpace(gameName)) profile["gameName"] = gameName;
            if (!string.IsNullOrWhiteSpace(tagLine)) profile["tagLine"] = tagLine;
            profile["platform"] = platform;
            profile["lastSeenAt"] = now;
            profile["source"] = "live-game";
            profile["origin"] = "foreigner";
            profile["riftboardPlayer"] = false;
            profile.Remove("_id");

            if (needsRankFetch)
            {
                try
                {
                    var entries = await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken);
                    profile["solo"] = BuildLeagueSnapshot(entries, "RANKED_SOLO_5x5", now);
                    profile["flex"] = BuildLeagueSnapshot(entries, "RANKED_FLEX_SR", now);
                    profile["lastRankFetchAt"] = now;
                }
                catch (RiotApiException ex) when (ex.Status == 404 || IsDecryptingBadRequest(ex))
                {
                    profile["lastRankFetchAt"] = now;
                }
            }

            await _participantProfiles.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("puuid", puuid),
                new BsonDocument
                {
                    ["$set"] = profile,
                    ["$setOnInsert"] = new BsonDocument
                    {
                        ["createdAt"] = now,
                    },
                },
                new UpdateOptions { IsUpsert = true },
                cancellationToken);
            profilesByPuuid[puuid] = profile;
        }

        var byId = new Dictionary<string, BsonDocument>(StringComparer.Ordinal);
        foreach (var player in trackedPlayers.Concat(players).Concat(profilesByPuuid.Values))
        {
            if (player.TryGetValue("_id", out var id))
            {
                var key = id.ToString();
                if (!string.IsNullOrWhiteSpace(key)) byId[key] = player;
            }
            else
            {
                byId[PlayerRiotId(player)] = player;
            }
        }

        return byId.Values.ToList();
    }

    private async Task AttachLiveDiscordUsersAsync(List<BsonDocument> players, CancellationToken cancellationToken)
    {
        var playerIds = players
            .Where(player => player.TryGetValue("_id", out var id) && id.IsObjectId)
            .Select(player => player.GetValue("_id").AsObjectId)
            .Distinct()
            .ToList();
        if (playerIds.Count == 0) return;

        var links = await _discordLinks.Find(
                Builders<BsonDocument>.Filter.In("playerId", playerIds) &
                Builders<BsonDocument>.Filter.Eq("verifiedBinding", true) &
                Builders<BsonDocument>.Filter.Type("discordUserId", BsonType.String))
            .Project(Builders<BsonDocument>.Projection.Include("discordUserId").Include("discordUsername").Include("playerId"))
            .ToListAsync(cancellationToken);
        var linksByPlayerId = links
            .Where(link => link.TryGetValue("playerId", out var playerId) && playerId.IsObjectId)
            .GroupBy(link => link.GetValue("playerId").AsObjectId)
            .ToDictionary(group => group.Key, group => group.ToList());

        foreach (var player in players)
        {
            if (!player.TryGetValue("_id", out var rawId) || !rawId.IsObjectId) continue;
            if (!linksByPlayerId.TryGetValue(rawId.AsObjectId, out var playerLinks)) continue;
            player["liveDiscordUsers"] = new BsonArray(playerLinks
                .Select(link => new BsonDocument
                {
                    ["discordUserId"] = ReadString(link, "discordUserId") ?? "",
                    ["discordUsername"] = ReadString(link, "discordUsername") ?? "",
                })
                .Where(doc => !string.IsNullOrWhiteSpace(doc["discordUserId"].AsString))
                .GroupBy(doc => doc["discordUserId"].AsString)
                .Select(group => group.First()));
        }
    }

    private async Task RefreshRankAsync(
        BsonDocument player,
        JobConfig config,
        CancellationToken cancellationToken,
        bool syncTftRank = true)
    {
        var now = DateTime.UtcNow;
        var playerId = player.GetValue("_id").AsObjectId;
        var claimedRequestedAt = NestedDateTimeValue(
            player,
            "rankRefresh",
            "requestedAt");
        if (claimedRequestedAt is not null)
        {
            await MarkRankRefreshStartedAsync(
                playerId,
                claimedRequestedAt.Value,
                now,
                cancellationToken);
        }

        var puuid = ReadString(player, "puuid") ?? "";
        var matchRegion = "";
        var rankPersisted = false;
        try
        {
            var gameName = ReadString(player, "gameName") ?? throw new InvalidOperationException("Player missing gameName");
            var tagLine = ReadString(player, "tagLine") ?? throw new InvalidOperationException("Player missing tagLine");
            try
            {
                var account = await GetAccountByRiotIdAsync(gameName, tagLine, "lol", cancellationToken);
                var currentPuuid = account.GetProperty("puuid").GetString();
                if (!string.IsNullOrWhiteSpace(currentPuuid))
                {
                    puuid = currentPuuid;
                }
            }
            catch (RiotApiException ex) when (ex.Status == 404)
            {
                if (string.IsNullOrWhiteSpace(puuid))
                {
                    throw new PlayerNotFoundException(
                        "The linked Riot account was not found.",
                        ex);
                }
            }
            catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
            {
                if (string.IsNullOrWhiteSpace(puuid))
                {
                    throw new StaleRiotIdentityException(
                        "Riot could not resolve the linked account identity.",
                        ex);
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
                catch (RiotApiException ex) when (
                    ex.Status == 404 ||
                    IsDecryptingBadRequest(ex))
                {
                    (platform, summoner) = await FindSeaSummonerByPuuidAsync(puuid, cancellationToken);
                }
            }

            var entries = await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken);
            var tftLeague = syncTftRank
                ? await FindTftLeagueAsync(puuid, platform, cancellationToken)
                : (JsonElement?)null;
            matchRegion = PlatformToMatchRegion(platform);
            var completedAt = DateTime.UtcNow;

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
            if (tftLeague is { } tftEntries)
            {
                ApplyLeagueSnapshot(updates, tftEntries, "RANKED_TFT", "tft", now);
            }

            await _players.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", playerId),
                Builders<BsonDocument>.Update.Combine(updates),
                cancellationToken: cancellationToken);
            rankPersisted = true;
            if (claimedRequestedAt is not null)
            {
                await MarkRankRefreshCompletedAsync(
                    playerId,
                    claimedRequestedAt.Value,
                    completedAt,
                    cancellationToken);
            }
            else
            {
                await ClearRankRefreshRetryBackoffAsync(
                    playerId,
                    cancellationToken);
            }
            await InsertRankEntriesAsync(playerId, entries, now, cancellationToken);
            if (tftLeague is { } tftRankEntries)
            {
                await InsertRankEntriesAsync(
                    playerId,
                    tftRankEntries,
                    now,
                    cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Keep a queued request pending when the agent is shutting down.
            throw;
        }
        catch (Exception ex)
        {
            var failure = RefreshErrorClassifier.Classify(ex);
            if (!rankPersisted && !failure.StopBatch)
            {
                if (claimedRequestedAt is not null)
                {
                    await MarkRankRefreshFailedAsync(
                        playerId,
                        claimedRequestedAt.Value,
                        ex);
                }
                else
                {
                    await MarkRegularRankRefreshFailedAsync(playerId, ex);
                }
            }
            throw;
        }

        if (config.SyncMatches && NestedBooleanValue(player, "matchSync", "enabled") is not false)
        {
            await RefreshLolMatchesAsync(playerId, puuid, matchRegion, config, cancellationToken);
        }

        await TrySyncDiscordGuildRolesForPlayerAsync(playerId, cancellationToken);
    }

    private async Task RefreshLolMatchesAsync(ObjectId playerId, string puuid, string matchRegion, JobConfig config, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var recentIds = await GetStringArrayAsync(
            $"https://{matchRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/{Uri.EscapeDataString(puuid)}/ids?start=0&count={config.MatchesCount}",
            "lol",
            cancellationToken);
        var recentWritten = await SaveLolMatchesAsync(playerId, puuid, matchRegion, recentIds, now, cancellationToken);

        var backfillStart = 0;
        var backfillRequested = 0;
        var backfillWritten = 0;
        if (config.MatchBackfillCount > 0)
        {
            var storedCount = (int)Math.Min(
                int.MaxValue,
                await _playerMatches.CountDocumentsAsync(
                    Builders<BsonDocument>.Filter.Eq("playerId", playerId),
                    cancellationToken: cancellationToken));
            backfillStart = Math.Max(config.MatchesCount, storedCount);
            var olderIds = await GetStringArrayAsync(
                $"https://{matchRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/{Uri.EscapeDataString(puuid)}/ids?start={backfillStart}&count={config.MatchBackfillCount}",
                "lol",
                cancellationToken);
            backfillRequested = olderIds.Count;
            backfillWritten = await SaveLolMatchesAsync(playerId, puuid, matchRegion, olderIds, now, cancellationToken);
        }

        var updates = new List<UpdateDefinition<BsonDocument>>
        {
            Builders<BsonDocument>.Update.Set("matchSync.lastSyncAt", now),
            Builders<BsonDocument>.Update.Set("matchSync.recentRequested", recentIds.Count),
            Builders<BsonDocument>.Update.Set("matchSync.recentWritten", recentWritten),
            Builders<BsonDocument>.Update.Set("matchSync.backfillStart", backfillStart),
            Builders<BsonDocument>.Update.Set("matchSync.backfillRequested", backfillRequested),
            Builders<BsonDocument>.Update.Set("matchSync.backfillWritten", backfillWritten),
        };
        if (config.MatchBackfillCount > 0)
        {
            updates.Add(Builders<BsonDocument>.Update.Set("matchSync.backfillLastSyncAt", now));
            updates.Add(Builders<BsonDocument>.Update.Set("matchSync.backfillExhausted", backfillRequested == 0));
        }

        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            Builders<BsonDocument>.Update.Combine(updates),
            cancellationToken: cancellationToken);
    }

    private async Task<int> SaveLolMatchesAsync(ObjectId playerId, string puuid, string matchRegion, IReadOnlyCollection<string> matchIds, DateTime now, CancellationToken cancellationToken)
    {
        var saved = 0;
        foreach (var matchId in matchIds.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal))
        {
            var cached = await _matches.Find(Builders<BsonDocument>.Filter.Eq("matchId", matchId))
                .Project(Builders<BsonDocument>.Projection.Include("raw"))
                .FirstOrDefaultAsync(cancellationToken);

            JsonElement match;
            if (cached is not null && cached.TryGetValue("raw", out var raw) && raw.IsBsonDocument)
            {
                match = JsonDocument.Parse(raw.AsBsonDocument.ToJson()).RootElement.Clone();
                await StoreLolMatchDetailAsync(matchId, matchRegion, match, now, cancellationToken);
            }
            else
            {
                try
                {
                    match = await RiotGetJsonAsync($"https://{matchRegion}.api.riotgames.com/lol/match/v5/matches/{Uri.EscapeDataString(matchId)}", "lol", cancellationToken);
                }
                catch (RiotApiException ex) when (ex.Status == 404)
                {
                    // Match history can contain an ID whose detail has already
                    // expired. Skip that resource without blaming the player.
                    continue;
                }
                await StoreLolMatchDetailAsync(matchId, matchRegion, match, now, cancellationToken);
            }

            var doc = ExtractLolPlayerMatch(playerId, matchId, matchRegion, puuid, match, now);
            if (doc is null) continue;

            await _playerMatches.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("playerId", playerId) & Builders<BsonDocument>.Filter.Eq("matchId", matchId),
                new BsonDocument { ["$set"] = doc },
                new UpdateOptions { IsUpsert = true },
                cancellationToken);
            saved++;
        }

        await PrunePlayerMatchesAsync(_playerMatches, playerId, "gameCreation", cancellationToken);
        await PruneUnreferencedMatchDetailsAsync(_matches, _playerMatches, cancellationToken);

        return saved;
    }

    private async Task StoreLolMatchDetailAsync(string matchId, string matchRegion, JsonElement match, DateTime now, CancellationToken cancellationToken)
    {
        if (!match.TryGetProperty("info", out var info)) return;

        await _matches.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("matchId", matchId),
            Builders<BsonDocument>.Update.Combine(
                Builders<BsonDocument>.Update.Set("matchId", matchId),
                Builders<BsonDocument>.Update.Set("region", matchRegion),
                Builders<BsonDocument>.Update.Set("queueId", BsonIntOrNull(info, "queueId")),
                Builders<BsonDocument>.Update.Set("gameCreation", BsonLongOrNull(info, "gameCreation")),
                Builders<BsonDocument>.Update.Set("gameDuration", BsonLongOrNull(info, "gameDuration")),
                Builders<BsonDocument>.Update.Set("raw", BsonDocument.Parse(match.GetRawText())),
                Builders<BsonDocument>.Update.Set("detailStoredAt", now),
                Builders<BsonDocument>.Update.Set("fetchedAt", now)),
            new UpdateOptions { IsUpsert = true },
            cancellationToken);
    }

    private static BsonDocument? ExtractLolPlayerMatch(ObjectId playerId, string matchId, string region, string puuid, JsonElement match, DateTime now)
    {
        if (!match.TryGetProperty("info", out var info)) return null;
        var participant = GetArray(info, "participants")
            .FirstOrDefault(p => string.Equals(GetString(p, "puuid"), puuid, StringComparison.OrdinalIgnoreCase));
        if (participant.ValueKind == JsonValueKind.Undefined) return null;

        var perks = participant.TryGetProperty("perks", out var rawPerks) ? rawPerks : default;
        var styles = perks.ValueKind == JsonValueKind.Object ? GetArray(perks, "styles") : [];
        var primaryStyle = styles.Count > 0 ? GetInt(styles[0], "style") : null;
        var primaryRune = styles.Count > 0 ? GetArray(styles[0], "selections").FirstOrDefault() : default;
        var subStyle = styles.Count > 1 ? GetInt(styles[1], "style") : null;
        var cs = (GetInt(participant, "totalMinionsKilled") ?? 0) + (GetInt(participant, "neutralMinionsKilled") ?? 0);

        return new BsonDocument
        {
            ["playerId"] = playerId,
            ["matchId"] = matchId,
            ["region"] = region,
            ["queueId"] = BsonIntOrNull(info, "queueId"),
            ["gameCreation"] = BsonLongOrNull(info, "gameCreation"),
            ["gameDuration"] = BsonLongOrNull(info, "gameDuration"),
            ["championId"] = BsonIntOrNull(participant, "championId"),
            ["teamId"] = BsonIntOrNull(participant, "teamId"),
            ["teamPosition"] = BsonStringOrNull(participant, "teamPosition"),
            ["win"] = BsonBoolOrNull(participant, "win"),
            ["kills"] = BsonIntOrNull(participant, "kills"),
            ["deaths"] = BsonIntOrNull(participant, "deaths"),
            ["assists"] = BsonIntOrNull(participant, "assists"),
            ["largestMultiKill"] = BsonIntOrNull(participant, "largestMultiKill"),
            ["doubleKills"] = BsonIntOrNull(participant, "doubleKills"),
            ["tripleKills"] = BsonIntOrNull(participant, "tripleKills"),
            ["quadraKills"] = BsonIntOrNull(participant, "quadraKills"),
            ["pentaKills"] = BsonIntOrNull(participant, "pentaKills"),
            ["largestKillingSpree"] = BsonIntOrNull(participant, "largestKillingSpree"),
            ["cs"] = cs,
            ["gold"] = BsonIntOrNull(participant, "goldEarned"),
            ["items"] = new BsonArray(Enumerable.Range(0, 7).Select(i => GetInt(participant, $"item{i}") ?? 0)),
            ["summonerSpells"] = new BsonArray(new[] { GetInt(participant, "summoner1Id") ?? 0, GetInt(participant, "summoner2Id") ?? 0 }),
            ["primaryStyle"] = primaryStyle is { } ps ? ps : BsonNull.Value,
            ["primaryRune"] = primaryRune.ValueKind == JsonValueKind.Object && GetInt(primaryRune, "perk") is { } pr ? pr : BsonNull.Value,
            ["subStyle"] = subStyle is { } ss ? ss : BsonNull.Value,
            ["fetchedAt"] = now,
        };
    }

    private static BsonDocument BuildLeagueSnapshot(JsonElement entries, string queue, DateTime now)
    {
        if (entries.ValueKind == JsonValueKind.Array)
        {
            var entry = entries.EnumerateArray().FirstOrDefault(e => string.Equals(GetString(e, "queueType"), queue, StringComparison.OrdinalIgnoreCase));
            if (entry.ValueKind != JsonValueKind.Undefined)
            {
                return new BsonDocument
                {
                    ["tier"] = GetString(entry, "tier") ?? "",
                    ["division"] = GetString(entry, "rank") ?? "",
                    ["lp"] = GetInt(entry, "leaguePoints") ?? 0,
                    ["wins"] = GetInt(entry, "wins") ?? 0,
                    ["losses"] = GetInt(entry, "losses") ?? 0,
                    ["fetchedAt"] = now,
                };
            }
        }

        return new BsonDocument
        {
            ["fetchedAt"] = now,
        };
    }

    private static bool ParticipantRankCacheStale(BsonDocument profile, DateTime now)
    {
        var fetchedAt = profile.TryGetValue("lastRankFetchAt", out var rankFetch) && rankFetch.IsValidDateTime
            ? rankFetch.ToUniversalTime()
            : profile.TryGetValue("solo", out var solo) && solo.IsBsonDocument &&
              solo.AsBsonDocument.TryGetValue("fetchedAt", out var soloFetch) && soloFetch.IsValidDateTime
                ? soloFetch.ToUniversalTime()
                : (DateTime?)null;
        return fetchedAt is null || now - fetchedAt.Value > TimeSpan.FromHours(24);
    }

    private static (string? GameName, string? TagLine) SplitRiotId(string? riotId)
    {
        var value = (riotId ?? "").Trim();
        var hash = value.LastIndexOf('#');
        if (hash <= 0 || hash >= value.Length - 1) return (null, null);
        return (value[..hash], value[(hash + 1)..]);
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
        catch (RiotApiException ex) when (ex.Status == 404)
        {
            if (string.IsNullOrWhiteSpace(puuid))
            {
                throw new PlayerNotFoundException(
                    "The linked TFT account was not found.",
                    ex);
            }
        }
        catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
        {
            if (string.IsNullOrWhiteSpace(puuid))
            {
                throw new StaleRiotIdentityException(
                    "Riot could not resolve the linked TFT account identity.",
                    ex);
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

        List<string> ids;
        try
        {
            ids = await GetStringArrayAsync(
                $"https://{matchRegion}.api.riotgames.com/tft/match/v1/matches/by-puuid/{Uri.EscapeDataString(puuid)}/ids?start=0&count={config.MatchesCount}",
                "tft",
                cancellationToken);
        }
        catch (RiotApiException ex) when (ex.Status == 404)
        {
            throw new PlayerNotFoundException(
                "TFT account not found.",
                ex);
        }
        catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
        {
            throw new StaleRiotIdentityException(
                "Riot could not resolve the saved TFT account identity.",
                ex);
        }
        var saved = 0;
        var missingMatchDetails = 0;
        foreach (var matchId in ids)
        {
            var cached = await _tftMatches.Find(Builders<BsonDocument>.Filter.Eq("matchId", matchId))
                .Project(Builders<BsonDocument>.Projection.Include("raw"))
                .FirstOrDefaultAsync(cancellationToken);

            JsonElement match;
            if (cached is not null && cached.TryGetValue("raw", out var raw) && raw.IsBsonDocument)
            {
                match = JsonDocument.Parse(raw.AsBsonDocument.ToJson()).RootElement.Clone();
            }
            else
            {
                try
                {
                    match = await RiotGetJsonAsync($"https://{matchRegion}.api.riotgames.com/tft/match/v1/matches/{Uri.EscapeDataString(matchId)}", "tft", cancellationToken);
                }
                catch (RiotApiException ex) when (ex.Status == 404)
                {
                    // A missing match detail is a stale match resource, not a
                    // missing TFT player.
                    missingMatchDetails++;
                    continue;
                }
                await StoreTftMatchDetailAsync(matchId, matchRegion, match, now, cancellationToken);
            }

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

        await PrunePlayerMatchesAsync(_tftPlayerMatches, playerId, "gameDatetime", cancellationToken);
        await PruneUnreferencedMatchDetailsAsync(_tftMatches, _tftPlayerMatches, cancellationToken);

        if (
            ids.Count > 0 &&
            saved == 0 &&
            missingMatchDetails < ids.Count)
        {
            throw new StaleRiotIdentityException(
                "TFT matches were returned, but none matched the saved account identity.");
        }

        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            Builders<BsonDocument>.Update
                .Set("tftPuuid", puuid)
                .Set("matchRegion", matchRegion)
                .Set("tftMatchSync.lastSyncAt", now)
                .Set("tftMatchSync.lastAttemptAt", now)
                .Set("tftMatchSync.consecutiveFailures", 0)
                .Set("lastRefreshAt", now)
                .Set("updatedAt", now)
                .Unset("tftMatchSync.retryAfterAt")
                .Unset("tftMatchSync.lastError")
                .Unset("tftMatchSync.lastErrorCode"),
            cancellationToken: cancellationToken);

        await TrySyncDiscordGuildRolesForPlayerAsync(playerId, cancellationToken);
    }

    private async Task StoreTftMatchDetailAsync(
        string matchId,
        string matchRegion,
        JsonElement match,
        DateTime now,
        CancellationToken cancellationToken)
    {
        if (!match.TryGetProperty("info", out var info)) return;

        await _tftMatches.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("matchId", matchId),
            Builders<BsonDocument>.Update.Combine(
                Builders<BsonDocument>.Update.Set("matchId", matchId),
                Builders<BsonDocument>.Update.Set("region", matchRegion),
                Builders<BsonDocument>.Update.Set("queueId", BsonIntOrNull(info, "queue_id")),
                Builders<BsonDocument>.Update.Set("gameDatetime", BsonLongOrNull(info, "game_datetime")),
                Builders<BsonDocument>.Update.Set("gameLength", BsonDoubleOrNull(info, "game_length")),
                Builders<BsonDocument>.Update.Set("setNumber", BsonIntOrNull(info, "tft_set_number")),
                Builders<BsonDocument>.Update.Set("raw", BsonDocument.Parse(match.GetRawText())),
                Builders<BsonDocument>.Update.Set("fetchedAt", now)),
            new UpdateOptions { IsUpsert = true },
            cancellationToken);
    }

    private static async Task PrunePlayerMatchesAsync(IMongoCollection<BsonDocument> collection, ObjectId playerId, string sortField, CancellationToken cancellationToken)
    {
        var keepIds = await collection.Find(Builders<BsonDocument>.Filter.Eq("playerId", playerId))
            .Sort(Builders<BsonDocument>.Sort.Descending(sortField).Descending("_id"))
            .Project(Builders<BsonDocument>.Projection.Include("_id"))
            .Limit(50)
            .ToListAsync(cancellationToken);
        var keep = keepIds.Select(doc => doc.GetValue("_id").AsObjectId).ToList();
        await collection.DeleteManyAsync(
            Builders<BsonDocument>.Filter.Eq("playerId", playerId) &
            Builders<BsonDocument>.Filter.Nin("_id", keep),
            cancellationToken);
    }

    private static async Task PruneUnreferencedMatchDetailsAsync(IMongoCollection<BsonDocument> matchCollection, IMongoCollection<BsonDocument> playerMatchCollection, CancellationToken cancellationToken)
    {
        var referenced = await playerMatchCollection.Distinct<string>("matchId", Builders<BsonDocument>.Filter.Empty).ToListAsync(cancellationToken);
        if (referenced.Count == 0) return;
        await matchCollection.DeleteManyAsync(Builders<BsonDocument>.Filter.Nin("matchId", referenced), cancellationToken);
    }

    private async Task TrySyncDiscordGuildRolesForPlayerAsync(ObjectId playerId, CancellationToken cancellationToken)
    {
        try
        {
            await SyncDiscordGuildRolesForPlayerAsync(playerId, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            // Discord role sync should never block Riot rank or match storage.
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

    private async Task<LiveDiscordMessage> BuildLiveGameMessageAsync(
        string platform,
        JsonElement game,
        IReadOnlyList<BsonDocument> trackedPlayers,
        IReadOnlyList<BsonDocument> knownPlayers,
        CancellationToken cancellationToken)
    {
        var championNames = await GetChampionNamesAsync(cancellationToken);
        var gameId = GetLong(game, "gameId") ?? 0;
        var queueId = GetInt(game, "gameQueueConfigId");
        var length = GetInt(game, "gameLength") ?? 0;
        var participants = GetArray(game, "participants");

        string ChampionLine(JsonElement participant)
        {
            var riotId = GetString(participant, "riotId") ?? GetString(participant, "summonerName") ?? "Unknown";
            var championId = GetInt(participant, "championId");
            var soloRank = SoloRankForParticipant(participant, knownPlayers);
            var rankText = string.IsNullOrWhiteSpace(soloRank) ? "" : $" - {soloRank}";
            return championId is null
                ? $"{riotId}{rankText}"
                : $"{ChampionName(championNames, championId)} - {riotId}{rankText}";
        }

        string ChampionSummary(JsonElement participant)
        {
            return ChampionName(championNames, GetInt(participant, "championId"));
        }

        var trackedTeamIds = new HashSet<int>();
        var trackedPuuids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var mentionIds = new HashSet<string>(StringComparer.Ordinal);
        var participantPuuids = participants
            .Select(participant => GetString(participant, "puuid"))
            .Where(puuid => !string.IsNullOrWhiteSpace(puuid))
            .Select(puuid => puuid!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var linkedPlayersInGame = knownPlayers
            .Concat(trackedPlayers)
            .Where(player =>
            {
                var puuid = ReadString(player, "puuid");
                return !string.IsNullOrWhiteSpace(puuid) &&
                       participantPuuids.Contains(puuid) &&
                       PlayerDiscordIds(player).Any();
            })
            .GroupBy(PlayerRiotId, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
        var trackedLines = linkedPlayersInGame
            .Select(player =>
            {
                var puuid = ReadString(player, "puuid");
                if (!string.IsNullOrWhiteSpace(puuid)) trackedPuuids.Add(puuid);
                foreach (var id in PlayerDiscordIds(player))
                {
                    mentionIds.Add(id);
                }

                var participant = participants.FirstOrDefault(p => string.Equals(GetString(p, "puuid"), puuid, StringComparison.OrdinalIgnoreCase));
                var championId = participant.ValueKind == JsonValueKind.Undefined ? null : GetInt(participant, "championId");
                var trackedTeamId = participant.ValueKind == JsonValueKind.Undefined ? null : GetInt(participant, "teamId");
                if (trackedTeamId is not null) trackedTeamIds.Add(trackedTeamId.Value);
                var riotId = PlayerRiotId(player);
                var champion = ChampionName(championNames, championId);
                var soloRank = SoloRank(player);
                var rankText = string.IsNullOrWhiteSpace(soloRank) ? "" : $" - {soloRank}";
                return championId is null
                    ? $"{riotId}{rankText}"
                    : $"{riotId} - **{champion}**{rankText}";
            })
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .Take(8)
            .ToList();

        var fields = new List<Dictionary<string, object?>>();

        foreach (var team in BuildLiveTeamFields(participants, queueId, trackedTeamIds, trackedPuuids, ChampionLine, ChampionSummary))
        {
            fields.Add(team);
        }

        var embed = new Dictionary<string, object?>
        {
            ["title"] = $"{QueueName(queueId)} live on {platform.ToUpperInvariant()}",
            ["description"] = $"Game `{gameId}` - {FormatGameLength(length)}",
            ["color"] = QueueColor(queueId),
            ["thumbnail"] = new Dictionary<string, object?> { ["url"] = NeutralLiveThumbnailUrl() },
            ["fields"] = fields,
            ["footer"] = new Dictionary<string, object?> { ["text"] = "RiftBoard live games" },
            ["timestamp"] = DateTimeOffset.UtcNow.ToString("O"),
        };

        var mentions = mentionIds.Select(id => $"<@{id}>").ToList();
        var fallbackRiotIds = linkedPlayersInGame.Count > 0
            ? linkedPlayersInGame.Select(PlayerRiotId).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().Take(8).ToList()
            : trackedPlayers.Select(PlayerRiotId).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().Take(8).ToList();
        var content = mentions.Count > 0 ? string.Join(" ", mentions.Take(8)) : string.Join(", ", fallbackRiotIds);
        return new LiveDiscordMessage(content, [embed], mentionIds.Take(8).ToArray());
    }

    private IEnumerable<Dictionary<string, object?>> BuildLiveTeamFields(
        IReadOnlyList<JsonElement> participants,
        int? queueId,
        IReadOnlySet<int> trackedTeamIds,
        IReadOnlySet<string> trackedPuuids,
        Func<JsonElement, string> formatParticipant,
        Func<JsonElement, string> formatCompactParticipant)
    {
        var isArena = queueId is 1700 or 1710 or 1750;
        var teams = participants
            .Select(participant => new { TeamId = GetInt(participant, "teamId"), Participant = participant })
            .Where(item => item.TeamId is not null)
            .GroupBy(item => item.TeamId!.Value)
            .OrderBy(group => group.Key)
            .ToList();
        var isTwoTeamGame = teams.Count <= 2 && teams.Any(team => team.Key == 100) && teams.Any(team => team.Key == 200);

        if (isArena && teams.Count <= 2 && teams.Any(team => team.Count() > 4))
        {
            var arenaTeamSize = ArenaTeamSize(queueId, participants.Count);
            var chunks = participants
                .Select((participant, index) => new { Participant = participant, Index = index })
                .GroupBy(item => item.Index / arenaTeamSize)
                .Select(group => new
                {
                    TeamNumber = group.Key + 1,
                    Participants = group.Select(item => item.Participant).ToList(),
                    HasTrackedPlayer = group.Any(item =>
                    {
                        var puuid = GetString(item.Participant, "puuid");
                        return !string.IsNullOrWhiteSpace(puuid) && trackedPuuids.Contains(puuid);
                    }),
                })
                .OrderByDescending(group => group.HasTrackedPlayer)
                .ThenBy(group => group.TeamNumber)
                .ToList();
            foreach (var chunk in chunks)
            {
                var lines = chunk.Participants.Select(formatParticipant).Where(line => !string.IsNullOrWhiteSpace(line)).ToList();
                if (lines.Count == 0) continue;

                yield return new Dictionary<string, object?>
                {
                    ["name"] = $"Team {chunk.TeamNumber}",
                    ["value"] = TruncateDiscordField(string.Join("\n", lines)),
                    ["inline"] = false,
                };
            }

            yield break;
        }

        if (isTwoTeamGame)
        {
            foreach (var team in teams
                         .OrderByDescending(group => trackedTeamIds.Contains(group.Key))
                         .ThenBy(group => group.Key)
                         .Take(2))
            {
                var teamParticipants = team.Select(item => item.Participant).ToList();
                var lines = teamParticipants
                    .Select((participant, index) => PrefixLaneEmoji(formatParticipant(participant), queueId, teamParticipants.Count, index))
                    .Where(line => !string.IsNullOrWhiteSpace(line))
                    .ToList();
                if (lines.Count == 0) continue;

                yield return new Dictionary<string, object?>
                {
                    ["name"] = TeamName(team.Key, isTwoTeamGame, isArena),
                    ["value"] = TruncateDiscordField(string.Join("\n", lines)),
                    ["inline"] = false,
                };
            }

            yield break;
        }

        foreach (var team in teams
                     .OrderByDescending(group => trackedTeamIds.Contains(group.Key))
                     .ThenBy(group => group.Key)
                     .Take(24))
        {
            var teamName = TeamName(team.Key, isTwoTeamGame, isArena);
            var lines = team.Select(item => formatParticipant(item.Participant)).Where(line => !string.IsNullOrWhiteSpace(line)).ToList();
            if (lines.Count == 0) continue;

            yield return new Dictionary<string, object?>
            {
                ["name"] = teamName,
                ["value"] = TruncateDiscordField(string.Join("\n", lines)),
                ["inline"] = false,
            };
        }
    }

    private static string TeamName(int teamId, bool isTwoTeamGame, bool isArena)
    {
        if (isTwoTeamGame) return teamId == 100 ? "Blue" : "Red";
        return isArena ? $"Team {ArenaTeamNumber(teamId)}" : $"Team {teamId}";
    }

    private string PrefixLaneEmoji(string line, int? queueId, int teamSize, int index)
    {
        if (string.IsNullOrWhiteSpace(line) || teamSize != 5 || !IsSummonersRiftQueue(queueId))
        {
            return line;
        }

        var lane = index switch
        {
            0 => "top",
            1 => "jungle",
            2 => "mid",
            3 => "bot",
            4 => "support",
            _ => "",
        };
        var emoji = LaneEmoji(lane);
        return string.IsNullOrWhiteSpace(emoji) ? line : $"{emoji} {line}";
    }

    private static bool IsSummonersRiftQueue(int? queueId)
    {
        return queueId is 400 or 420 or 430 or 440 or 480 or 490;
    }

    private string LaneEmoji(string lane)
    {
        return lane switch
        {
            "top" => DiscordEmoji("top"),
            "jungle" => DiscordEmoji("jungle"),
            "mid" => DiscordEmoji("mid"),
            "bot" => DiscordEmoji("bot"),
            "support" => DiscordEmoji("support"),
            _ => "",
        };
    }

    private static int ArenaTeamNumber(int teamId)
    {
        return teamId >= 100 ? ((teamId - 100) / 100) + 1 : teamId;
    }

    private static int ArenaTeamSize(int? queueId, int participantCount)
    {
        if (queueId == 1750) return 3;
        if (queueId == 1710) return 2;
        if (queueId == 1700) return 2;
        if (participantCount % 2 == 0) return 2;
        if (participantCount % 3 == 0) return 3;
        return 2;
    }

    private static string QueueName(int? queueId) => queueId switch
    {
        1700 => "Arena",
        1710 => "Arena",
        1750 => "Arena",
        420 => "Ranked Solo/Duo",
        440 => "Ranked Flex",
        400 => "Draft Pick",
        430 => "Blind Pick",
        450 => "ARAM",
        480 => "Swiftplay",
        490 => "Quickplay",
        0 or null => "Custom",
        2300 => "Brawl",
        2400 => "ARAM: Mayhem",
        _ => $"Queue {queueId}",
    };

    private static int QueueColor(int? queueId) => queueId switch
    {
        420 => 0x4ba3ff,
        440 => 0x2ecc71,
        1700 or 1710 or 1750 => 0xf0c74b,
        450 or 2400 => 0xa970ff,
        _ => 0x5865f2,
    };

    private static string TruncateDiscordField(string value)
    {
        const int max = 1024;
        var normalized = string.IsNullOrWhiteSpace(value) ? "-" : value.Trim();
        return normalized.Length <= max ? normalized : $"{normalized[..(max - 3)]}...";
    }

    private async Task<Dictionary<int, string>> GetChampionNamesAsync(CancellationToken cancellationToken)
    {
        if (_championNames is not null && DateTime.UtcNow - _championNamesLoadedAt < TimeSpan.FromHours(24))
        {
            return _championNames;
        }

        try
        {
            var versionJson = await HttpGetJsonAsync("https://ddragon.leagueoflegends.com/api/versions.json", cancellationToken);
            var version = versionJson.ValueKind == JsonValueKind.Array
                ? versionJson.EnumerateArray().FirstOrDefault().GetString()
                : null;
            version = string.IsNullOrWhiteSpace(version) ? "latest" : version;
            var championJson = await HttpGetJsonAsync($"https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json", cancellationToken);
            var map = new Dictionary<int, string>();
            var icons = new Dictionary<int, string>();
            if (championJson.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
            {
                foreach (var champion in data.EnumerateObject())
                {
                    var key = GetString(champion.Value, "key");
                    var name = GetString(champion.Value, "name");
                    if (int.TryParse(key, out var id) && !string.IsNullOrWhiteSpace(name))
                    {
                        map[id] = name;
                        if (champion.Value.TryGetProperty("image", out var image))
                        {
                            var file = GetString(image, "full");
                            if (!string.IsNullOrWhiteSpace(file))
                            {
                                icons[id] = $"https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{file}";
                            }
                        }
                    }
                }
            }

            _championNames = map;
            _championIcons = icons;
            _championNamesLoadedAt = DateTime.UtcNow;
            return map;
        }
        catch
        {
            _championNames ??= new Dictionary<int, string>();
            return _championNames;
        }
    }

    private static string ChampionName(IReadOnlyDictionary<int, string> championNames, int? championId)
    {
        if (championId is null) return "Unknown";
        return championNames.TryGetValue(championId.Value, out var name) ? name : $"Champion {championId}";
    }

    private async Task<Dictionary<int, string>> GetChampionIconsAsync(CancellationToken cancellationToken)
    {
        await GetChampionNamesAsync(cancellationToken);
        return _championIcons ?? new Dictionary<int, string>();
    }

    private string NeutralLiveThumbnailUrl()
    {
        return $"{AppBaseUrl()}/logo.png";
    }

    private static string FormatGameLength(int seconds)
    {
        var safe = Math.Max(0, seconds);
        return $"{safe / 60}:{safe % 60:00}";
    }

    private static string PlayerRiotId(BsonDocument player)
    {
        return $"{ReadString(player, "gameName")}#{ReadString(player, "tagLine")}";
    }

    private static string? PlayerDiscordLabel(BsonDocument player)
    {
        if (!player.TryGetValue("liveDiscordUsers", out var raw) || !raw.IsBsonArray)
        {
            return null;
        }

        var users = raw.AsBsonArray
            .Where(value => value.IsBsonDocument)
            .Select(value => value.AsBsonDocument)
            .Select(doc =>
            {
                var username = ReadString(doc, "discordUsername");
                return username;
            })
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct()
            .Take(3)
            .ToList();

        return users.Count == 0 ? null : string.Join(", ", users);
    }

    private static IEnumerable<string> PlayerDiscordIds(BsonDocument player)
    {
        if (!player.TryGetValue("liveDiscordUsers", out var raw) || !raw.IsBsonArray)
        {
            yield break;
        }

        foreach (var value in raw.AsBsonArray)
        {
            if (!value.IsBsonDocument) continue;
            var id = ReadString(value.AsBsonDocument, "discordUserId");
            if (!string.IsNullOrWhiteSpace(id) && id.All(char.IsDigit))
            {
                yield return id;
            }
        }
    }

    private string? SoloRankForParticipant(JsonElement participant, IReadOnlyList<BsonDocument> knownPlayers)
    {
        var puuid = GetString(participant, "puuid");
        if (!string.IsNullOrWhiteSpace(puuid))
        {
            var byPuuid = knownPlayers.FirstOrDefault(player =>
                string.Equals(ReadString(player, "puuid"), puuid, StringComparison.OrdinalIgnoreCase));
            if (byPuuid is not null) return SoloRank(byPuuid);
        }

        var riotId = GetString(participant, "riotId");
        if (!string.IsNullOrWhiteSpace(riotId))
        {
            var byRiotId = knownPlayers.FirstOrDefault(player =>
                string.Equals(PlayerRiotId(player), riotId, StringComparison.OrdinalIgnoreCase));
            if (byRiotId is not null) return SoloRank(byRiotId);
        }

        return null;
    }

    private string? SoloRank(BsonDocument player)
    {
        if (!player.TryGetValue("solo", out var raw) || !raw.IsBsonDocument)
        {
            return null;
        }

        var solo = raw.AsBsonDocument;
        var tier = ReadString(solo, "tier");
        if (string.IsNullOrWhiteSpace(tier)) return null;
        var division = ReadString(solo, "division");
        var lp = solo.TryGetValue("lp", out var lpValue) && lpValue.IsNumeric ? lpValue.ToInt32() : (int?)null;
        return RankLabel(tier, division, lp);
    }

    private string RankLabel(string tier, string? division, int? lp)
    {
        var emoji = RankEmoji(tier);
        var prefix = string.IsNullOrWhiteSpace(emoji) ? "" : $"{emoji} ";
        var lpText = lp is null ? "" : $" {lp.Value}";
        return $"{prefix}{RankShort(tier)}{DivisionShort(division)}{lpText}";
    }

    private string RankEmoji(string tier)
    {
        var name = tier.Trim().ToUpperInvariant() switch
        {
            "CHALLENGER" => "Challenger",
            "GRANDMASTER" => "Grandmaster",
            "MASTER" => "Master",
            "DIAMOND" => "Diamond",
            "EMERALD" => "Emerald",
            "PLATINUM" => "Platinum",
            "GOLD" => "Gold",
            "SILVER" => "Silver",
            "BRONZE" => "Bronze",
            "IRON" => "Iron",
            _ => "",
        };
        return string.IsNullOrWhiteSpace(name) ? "" : DiscordEmoji(name);
    }

    private string DiscordEmoji(string name)
    {
        var direct = Env($"DISCORD_EMOJI_{NormalizeEnvKey(name)}");
        if (!string.IsNullOrWhiteSpace(direct))
        {
            return direct.Trim();
        }

        var map = Env("DISCORD_EMOJI_MAP");
        if (!string.IsNullOrWhiteSpace(map))
        {
            foreach (var pair in map.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var eq = pair.IndexOf('=');
                if (eq <= 0) continue;
                var key = pair[..eq].Trim();
                var value = pair[(eq + 1)..].Trim();
                if (string.Equals(key, name, StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(value))
                {
                    return value;
                }
            }
        }

        return "";
    }

    private static string NormalizeEnvKey(string value)
    {
        var chars = value
            .Select(ch => char.IsLetterOrDigit(ch) ? char.ToUpperInvariant(ch) : '_')
            .ToArray();
        return new string(chars);
    }

    private static string RankShort(string tier)
    {
        return tier.ToUpperInvariant() switch
        {
            "CHALLENGER" => "CH",
            "GRANDMASTER" => "GM",
            "MASTER" => "M",
            "DIAMOND" => "D",
            "EMERALD" => "E",
            "PLATINUM" => "P",
            "GOLD" => "G",
            "SILVER" => "S",
            "BRONZE" => "B",
            "IRON" => "I",
            _ => tier,
        };
    }

    private static string DivisionShort(string? division)
    {
        var value = (division ?? "").Trim().ToUpperInvariant();
        return string.IsNullOrWhiteSpace(value) ? "" : value switch
        {
            "I" => "1",
            "II" => "2",
            "III" => "3",
            "IV" => "4",
            _ => value.Length > 0 ? value : "",
        };
    }

    private static string PlayerPath(BsonDocument player)
    {
        return $"/p/{Uri.EscapeDataString(ReadString(player, "gameName") ?? "")}/{Uri.EscapeDataString(ReadString(player, "tagLine") ?? "")}";
    }

    private string AppBaseUrl()
    {
        var configured = (Env("PUBLIC_APP_URL") ?? Env("APP_BASE_URL") ?? Env("NEXT_PUBLIC_APP_URL") ?? "").Trim();
        if (
            Uri.TryCreate(configured, UriKind.Absolute, out var uri) &&
            uri.Host is not "127.0.0.1" and not "localhost" and not "::1")
        {
            return uri.AbsoluteUri.TrimEnd('/');
        }

        return "https://rift-board-myanmar.vercel.app";
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
            Builders<BsonDocument>.Filter.Eq("isPrimary", true) &
            Builders<BsonDocument>.Filter.In("verificationSource", new[] { "discord_connections", "riot_rso", "legacy_manual" }))
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

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException ex)
        {
            throw new DiscordApiException(
                408,
                "Discord API request timed out.",
                null,
                ex);
        }
        catch (HttpRequestException ex)
        {
            throw new DiscordApiException(
                0,
                "The tray could not reach Discord.",
                null,
                ex);
        }

        using (response)
        {
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return JsonDocument.Parse("{}").RootElement.Clone();
            }

            return JsonDocument.Parse(text).RootElement.Clone();
        }

        throw new DiscordApiException(
            (int)response.StatusCode,
            ParseDiscordError(
                text,
                response.ReasonPhrase ?? "Discord request failed"),
            RetryAfterMilliseconds(response));
        }
    }

    private async Task<JsonElement> SendDiscordChannelMessageAsync(string channelId, LiveDiscordMessage message, CancellationToken cancellationToken)
    {
        using var body = new StringContent(JsonSerializer.Serialize(new
        {
            content = message.Content,
            embeds = message.Embeds,
            allowed_mentions = new { parse = Array.Empty<string>(), users = message.AllowedUserIds },
        }), System.Text.Encoding.UTF8, "application/json");
        return await DiscordApiAsync(
            HttpMethod.Post,
            $"/channels/{Uri.EscapeDataString(channelId)}/messages",
            body,
            cancellationToken);
    }

    private async Task<JsonElement> EditDiscordChannelMessageAsync(string channelId, string messageId, LiveDiscordMessage message, CancellationToken cancellationToken)
    {
        using var body = new StringContent(JsonSerializer.Serialize(new
        {
            content = message.Content,
            embeds = message.Embeds,
            allowed_mentions = new { parse = Array.Empty<string>(), users = message.AllowedUserIds },
        }), System.Text.Encoding.UTF8, "application/json");
        return await DiscordApiAsync(
            HttpMethod.Patch,
            $"/channels/{Uri.EscapeDataString(channelId)}/messages/{Uri.EscapeDataString(messageId)}",
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
            return fallback;
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
        var sawDecryptFailure = false;
        foreach (var platform in SeaPlatforms)
        {
            try
            {
                return (platform, await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken));
            }
            catch (RiotApiException ex) when (ex.Status == 404)
            {
            }
            catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
            {
                sawDecryptFailure = true;
            }
        }

        if (sawDecryptFailure)
        {
            throw new StaleRiotIdentityException(
                "Riot could not resolve the saved LoL account identity.");
        }

        throw new PlayerNotFoundException("LoL account not found on SEA platforms.");
    }

    private async Task<JsonElement> FindTftLeagueAsync(string puuid, string? preferredPlatform, CancellationToken cancellationToken)
    {
        var platforms = new List<string>();
        if (!string.IsNullOrWhiteSpace(preferredPlatform) && preferredPlatform != "auto")
        {
            platforms.Add(preferredPlatform);
        }
        platforms.AddRange(SeaPlatforms.Where(p => !platforms.Contains(p)));

        var sawDecryptFailure = false;
        foreach (var platform in platforms)
        {
            try
            {
                return await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/tft/league/v1/by-puuid/{Uri.EscapeDataString(puuid)}", "tft", cancellationToken);
            }
            catch (RiotApiException ex) when (ex.Status == 404)
            {
            }
            catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
            {
                sawDecryptFailure = true;
            }
        }

        if (sawDecryptFailure)
        {
            throw new StaleRiotIdentityException(
                "Riot could not resolve the saved TFT account identity.");
        }

        return JsonDocument.Parse("[]").RootElement.Clone();
    }

    private async Task<(string Platform, JsonElement Game)?> FindActiveGameAsync(string puuid, string? preferredPlatform, CancellationToken cancellationToken)
    {
        var preferred = preferredPlatform?.Trim().ToLowerInvariant();
        var sawDecryptFailure = false;
        if (!string.IsNullOrWhiteSpace(preferred) && preferred != "auto")
        {
            try
            {
                var game = await RiotGetJsonAsync($"https://{preferred}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken);
                return (preferred, game);
            }
            catch (RiotApiException ex) when (ex.Status == 404)
            {
                // On a known platform, spectator 404 means the player is not in
                // an active game. Trying every other SEA shard only burns quota.
                return null;
            }
            catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
            {
                sawDecryptFailure = true;
                // A decrypting error means the stored platform may be stale. Fall
                // back to the remaining shards so a moved/misclassified player is
                // not incorrectly reported as offline.
            }
        }

        var platforms = new List<string>();
        platforms.AddRange(SeaPlatforms.Where(platform => platform != preferred));

        foreach (var platform in platforms)
        {
            try
            {
                var game = await RiotGetJsonAsync($"https://{platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{Uri.EscapeDataString(puuid)}", "lol", cancellationToken);
                return (platform, game);
            }
            catch (RiotApiException ex) when (ex.Status == 404)
            {
            }
            catch (RiotApiException ex) when (IsDecryptingBadRequest(ex))
            {
                sawDecryptFailure = true;
            }
        }

        if (sawDecryptFailure)
        {
            throw new StaleRiotIdentityException(
                "Riot could not resolve the saved account identity for live-game checks.");
        }

        return null;
    }

    private async Task<JsonElement> RiotGetJsonAsync(string url, string game, CancellationToken cancellationToken)
    {
        await RiotRequestGate.WaitAsync(cancellationToken);
        try
        {
            for (var attempt = 0; attempt < RiotMaxAttempts; attempt++)
            {
                await WaitForRiotPermitAsync(cancellationToken);
                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Get, url);
                    request.Headers.Add("X-Riot-Token", RiotKey(game));
                    request.Headers.Add("Accept-Language", "en-US,en;q=0.9");
                    using var response = await _http.SendAsync(request, cancellationToken);
                    var text = await response.Content.ReadAsStringAsync(cancellationToken);
                    if (response.IsSuccessStatusCode)
                    {
                        try
                        {
                            return JsonDocument.Parse(text).RootElement.Clone();
                        }
                        catch (JsonException) when (attempt < RiotMaxAttempts - 1)
                        {
                            BlockRiotRequestsFor(
                                TransientRetryDelayMilliseconds(attempt, null));
                            continue;
                        }
                        catch (JsonException ex)
                        {
                            throw new JsonException(
                                "Riot's API returned an unreadable response.",
                                ex);
                        }
                    }

                    var status = (int)response.StatusCode;
                    var retryAfterMs = RetryAfterMilliseconds(response);
                    if (status == 429)
                    {
                        var pauseMs = retryAfterMs ?? RiotFallbackRetryAfterMs;
                        retryAfterMs = pauseMs;
                        BlockRiotRequestsFor(pauseMs);
                        if (attempt < RiotMaxAttempts - 1)
                        {
                            continue;
                        }
                    }
                    else if (IsTransientRiotStatus(status))
                    {
                        if (attempt < RiotMaxAttempts - 1)
                        {
                            BlockRiotRequestsFor(
                                TransientRetryDelayMilliseconds(
                                    attempt,
                                    retryAfterMs));
                            continue;
                        }

                        BlockRiotRequestsFor((int)TimeSpan.FromMinutes(15).TotalMilliseconds);
                    }

                    throw new RiotApiException(
                        status,
                        ParseRiotError(text, response.ReasonPhrase ?? "Riot API error"),
                        retryAfterMs);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (TaskCanceledException ex)
                {
                    if (attempt < RiotMaxAttempts - 1)
                    {
                        BlockRiotRequestsFor(
                            TransientRetryDelayMilliseconds(attempt, null));
                        continue;
                    }

                    BlockRiotRequestsFor((int)TimeSpan.FromMinutes(15).TotalMilliseconds);
                    throw new TimeoutException("Riot's API request timed out.", ex);
                }
                catch (HttpRequestException)
                {
                    if (attempt < RiotMaxAttempts - 1)
                    {
                        BlockRiotRequestsFor(
                            TransientRetryDelayMilliseconds(attempt, null));
                        continue;
                    }

                    BlockRiotRequestsFor((int)TimeSpan.FromMinutes(15).TotalMilliseconds);
                    throw;
                }
                finally
                {
                    _riotNextRequestAt =
                        DateTimeOffset.UtcNow.AddMilliseconds(RiotRequestSpacingMs);
                }
            }

            throw new RiotApiException(429, "Rate limit exceeded", RiotFallbackRetryAfterMs);
        }
        finally
        {
            RiotRequestGate.Release();
        }
    }

    private static bool IsTransientRiotStatus(int status)
    {
        return status is
            408 or 425 or
            500 or 502 or 503 or 504 or
            520 or 521 or 522 or 523 or 524 or 525 or 526;
    }

    private static int TransientRetryDelayMilliseconds(
        int attempt,
        int? retryAfterMs)
    {
        var exponentialMs = Math.Min(15_000, 1_500 * (1 << Math.Min(attempt, 3)));
        var jitterMs = Random.Shared.Next(200, 800);
        return Math.Max(
            retryAfterMs ?? 0,
            exponentialMs + jitterMs);
    }

    private static void BlockRiotRequestsFor(int delayMs)
    {
        var blockedUntil = DateTimeOffset.UtcNow.AddMilliseconds(
            Math.Max(1000, delayMs));
        if (blockedUntil > _riotBlockedUntil)
        {
            _riotBlockedUntil = blockedUntil;
        }
    }

    private static async Task WaitForRiotPermitAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var readyAt = _riotBlockedUntil > _riotNextRequestAt ? _riotBlockedUntil : _riotNextRequestAt;
        if (readyAt > now)
        {
            await Task.Delay(readyAt - now, cancellationToken);
        }
    }

    private static int? RetryAfterMilliseconds(HttpResponseMessage response)
    {
        if (response.Headers.RetryAfter?.Delta is { } delta)
        {
            return Math.Max(1000, (int)Math.Ceiling(delta.TotalMilliseconds));
        }

        if (response.Headers.RetryAfter?.Date is { } retryAt)
        {
            var remaining = retryAt - DateTimeOffset.UtcNow;
            return Math.Max(1000, (int)Math.Ceiling(remaining.TotalMilliseconds));
        }

        return null;
    }

    private async Task<JsonElement> HttpGetJsonAsync(string url, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        using var response = await _http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"HTTP {(int)response.StatusCode}: {response.ReasonPhrase}");
        }

        return JsonDocument.Parse(text).RootElement.Clone();
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
        if (entry.ValueKind == JsonValueKind.Undefined)
        {
            // A successful empty queue response means the player is currently
            // unranked. Replace the old snapshot so a stale tier is never kept.
            updates.Add(Builders<BsonDocument>.Update.Set(path, new BsonDocument
            {
                ["fetchedAt"] = now,
            }));
            return;
        }
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

    private static BsonValue BsonBoolOrNull(JsonElement json, string key)
    {
        return json.ValueKind == JsonValueKind.Object &&
               json.TryGetProperty(key, out var value) &&
               value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : BsonNull.Value;
    }

    private static BsonValue BsonDoubleOrNull(JsonElement json, string key)
    {
        return json.ValueKind == JsonValueKind.Object && json.TryGetProperty(key, out var value) && value.TryGetDouble(out var n) ? n : BsonNull.Value;
    }

    private static string? ReadString(BsonDocument doc, string key)
    {
        return doc.TryGetValue(key, out var value) && value.IsString ? value.AsString : null;
    }

    private static DateTime? NestedDateTimeValue(BsonDocument doc, string objectKey, string key)
    {
        if (!doc.TryGetValue(objectKey, out var nested) || !nested.IsBsonDocument)
        {
            return null;
        }

        return nested.AsBsonDocument.TryGetValue(key, out var value) && value.IsBsonDateTime
            ? value.AsBsonDateTime.ToUniversalTime()
            : null;
    }

    private static bool? NestedBooleanValue(BsonDocument doc, string objectKey, string key)
    {
        if (!doc.TryGetValue(objectKey, out var nested) || !nested.IsBsonDocument)
        {
            return null;
        }

        return nested.AsBsonDocument.TryGetValue(key, out var value) && value.IsBoolean
            ? value.AsBoolean
            : null;
    }

    private async Task MarkRankRefreshStartedAsync(
        ObjectId playerId,
        DateTime requestedAt,
        DateTime startedAt,
        CancellationToken cancellationToken)
    {
        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId) &
            Builders<BsonDocument>.Filter.Eq("rankRefresh.requestedAt", requestedAt),
            Builders<BsonDocument>.Update.Combine(
                Builders<BsonDocument>.Update.Set("rankRefresh.startedAt", startedAt),
                Builders<BsonDocument>.Update.Unset("rankRefresh.lastError"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.lastErrorCode"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.retryAfterAt")),
            cancellationToken: cancellationToken);
    }

    private async Task MarkRankRefreshCompletedAsync(
        ObjectId playerId,
        DateTime requestedAt,
        DateTime completedAt,
        CancellationToken cancellationToken)
    {
        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId) &
            Builders<BsonDocument>.Filter.Eq("rankRefresh.requestedAt", requestedAt),
            Builders<BsonDocument>.Update.Combine(
                Builders<BsonDocument>.Update.Set("rankRefresh.completedAt", completedAt),
                Builders<BsonDocument>.Update.Unset("rankRefresh.requestedAt"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.startedAt"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.lastError"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.lastErrorCode"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.retryAfterAt")),
            cancellationToken: cancellationToken);
    }

    private async Task ClearRankRefreshRetryBackoffAsync(
        ObjectId playerId,
        CancellationToken cancellationToken)
    {
        // Do not mutate queue state if an owner request arrived while this
        // ordinary background refresh was in flight.
        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId) &
            Builders<BsonDocument>.Filter.Exists("rankRefresh.requestedAt", false),
            Builders<BsonDocument>.Update.Combine(
                Builders<BsonDocument>.Update.Unset("rankRefresh.lastError"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.lastErrorCode"),
                Builders<BsonDocument>.Update.Unset("rankRefresh.retryAfterAt")),
            cancellationToken: cancellationToken);
    }

    private async Task MarkRegularRankRefreshFailedAsync(
        ObjectId playerId,
        Exception error)
    {
        var failure = RefreshErrorClassifier.Classify(error);
        var failedAt = DateTime.UtcNow;
        try
        {
            await _players.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", playerId) &
                Builders<BsonDocument>.Filter.Exists("rankRefresh.requestedAt", false),
                Builders<BsonDocument>.Update.Combine(
                    Builders<BsonDocument>.Update.Set(
                        "rankRefresh.retryAfterAt",
                        failedAt.Add(PlayerFailureBackoff(failure))),
                    Builders<BsonDocument>.Update.Set("rankRefresh.lastAttemptAt", failedAt),
                    Builders<BsonDocument>.Update.Set("rankRefresh.lastError", failure.Message),
                    Builders<BsonDocument>.Update.Set("rankRefresh.lastErrorCode", failure.Code)),
                cancellationToken: CancellationToken.None);
        }
        catch
        {
            // Keep the original Riot failure as the reported job error.
        }
    }

    private async Task MarkRankRefreshFailedAsync(
        ObjectId playerId,
        DateTime requestedAt,
        Exception error)
    {
        var failure = RefreshErrorClassifier.Classify(error);
        var failedAt = DateTime.UtcNow;

        try
        {
            await _players.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", playerId) &
                Builders<BsonDocument>.Filter.Eq("rankRefresh.requestedAt", requestedAt),
                Builders<BsonDocument>.Update.Combine(
                    Builders<BsonDocument>.Update.Set("rankRefresh.completedAt", failedAt),
                    Builders<BsonDocument>.Update.Set("rankRefresh.lastAttemptAt", failedAt),
                    Builders<BsonDocument>.Update.Set(
                        "rankRefresh.retryAfterAt",
                        failedAt.Add(PlayerFailureBackoff(failure))),
                    Builders<BsonDocument>.Update.Set("rankRefresh.lastError", failure.Message),
                    Builders<BsonDocument>.Update.Set("rankRefresh.lastErrorCode", failure.Code),
                    Builders<BsonDocument>.Update.Unset("rankRefresh.requestedAt"),
                    Builders<BsonDocument>.Update.Unset("rankRefresh.startedAt")),
                cancellationToken: CancellationToken.None);
        }
        catch
        {
            // The original refresh exception remains the useful failure. If this
            // bookkeeping write also fails, the queued request remains retryable.
        }
    }

    private async Task MarkTftRefreshFailedAsync(
        ObjectId playerId,
        RefreshFailureInfo failure)
    {
        var failedAt = DateTime.UtcNow;
        await _players.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", playerId),
            Builders<BsonDocument>.Update
                .Set("tftMatchSync.lastAttemptAt", failedAt)
                .Set(
                    "tftMatchSync.retryAfterAt",
                    failedAt.Add(PlayerFailureBackoff(failure)))
                .Set("tftMatchSync.lastError", failure.Message)
                .Set("tftMatchSync.lastErrorCode", failure.Code)
                .Inc("tftMatchSync.consecutiveFailures", 1),
            cancellationToken: CancellationToken.None);
    }

    private static TimeSpan PlayerFailureBackoff(RefreshFailureInfo failure)
    {
        return failure.Code is
            RefreshErrorCodes.PlayerNotFound or
            RefreshErrorCodes.StaleIdentity or
            RefreshErrorCodes.PlayerData
                ? TimeSpan.FromHours(6)
                : TimeSpan.FromHours(1);
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
            return fallback;
        }
    }

    private static void ApplySystemicCooldown(
        CronResult result,
        RefreshFailureInfo failure,
        Exception exception)
    {
        if (!failure.StopBatch)
        {
            return;
        }

        if (exception is DiscordApiException)
        {
            return;
        }

        var cooldownMs = FailureCooldownMilliseconds(failure, exception);
        result.RetryAfterMs = result.RetryAfterMs is { } existing
            ? Math.Max(existing, cooldownMs)
            : cooldownMs;

        if (failure.Code is
            RefreshErrorCodes.RateLimited or
            RefreshErrorCodes.RiotUpstream or
            RefreshErrorCodes.Timeout or
            RefreshErrorCodes.Network or
            RefreshErrorCodes.AuthInvalid)
        {
            BlockRiotRequestsFor(cooldownMs);
        }
    }

    private static int FailureCooldownMilliseconds(
        RefreshFailureInfo failure,
        Exception exception)
    {
        var configuredMs = (int)Math.Min(
            TimeSpan.FromHours(1).TotalMilliseconds,
            TimeSpan.FromMinutes(
                Math.Max(1, failure.BaseBackoffMinutes)).TotalMilliseconds);
        var providerMs = RetryAfterMs(exception) ?? 0;
        return Math.Max(providerMs, configuredMs);
    }

    private static bool IsDecryptingBadRequest(RiotApiException ex)
    {
        return ex.Status == 400 && ex.Message.Contains("decrypt", StringComparison.OrdinalIgnoreCase);
    }

    private static int? RetryAfterMs(Exception ex)
    {
        return ex switch
        {
            RiotApiException riot => riot.RetryAfterMs,
            CronApiException cron => cron.RetryAfterMs,
            DiscordApiException discord => discord.RetryAfterMs,
            _ => null,
        };
    }

}

internal sealed class RiotApiException(int status, string message, int? retryAfterMs = null) : Exception(message)
{
    public int Status { get; } = status;
    public int? RetryAfterMs { get; } = retryAfterMs;
}

internal sealed class CronApiException(
    int status,
    string message,
    int? retryAfterMs = null,
    Exception? innerException = null) : Exception(message, innerException)
{
    public int Status { get; } = status;
    public int? RetryAfterMs { get; } = retryAfterMs;
}

internal sealed class DiscordApiException(
    int status,
    string message,
    int? retryAfterMs = null,
    Exception? innerException = null) : Exception(message, innerException)
{
    public int Status { get; } = status;
    public int? RetryAfterMs { get; } = retryAfterMs;
}

internal sealed class PlayerNotFoundException : Exception
{
    public PlayerNotFoundException(string message) : base(message)
    {
    }

    public PlayerNotFoundException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

internal sealed class StaleRiotIdentityException : Exception
{
    public StaleRiotIdentityException(string message) : base(message)
    {
    }

    public StaleRiotIdentityException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

internal static class RefreshErrorCodes
{
    public const string PlayerNotFound = "player_not_found";
    public const string ResourceNotFound = "resource_not_found";
    public const string StaleIdentity = "stale_identity";
    public const string PlayerData = "player_data";
    public const string RateLimited = "rate_limited";
    public const string AuthInvalid = "auth_invalid";
    public const string RiotUpstream = "riot_upstream";
    public const string Timeout = "timeout";
    public const string Network = "network";
    public const string Database = "database";
    public const string Configuration = "configuration";
    public const string Discord = "discord";
    public const string RefreshBusy = "refresh_busy";
    public const string Protocol = "protocol";
    public const string Server = "server";
    public const string Unknown = "unknown";
}

internal sealed record RefreshFailureInfo(
    string Code,
    string Title,
    string Message,
    bool Retryable,
    bool StopBatch,
    int BaseBackoffMinutes,
    int? Status = null);

internal static class RefreshErrorClassifier
{
    private static readonly Regex WhitespacePattern = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex HtmlPattern = new(@"<[^>]{1,500}>", RegexOptions.Compiled);
    private static readonly Regex SecretPattern = new(
        @"(?i)\b(RGAPI|Bearer)\s*[-A-Za-z0-9._~+/=]+",
        RegexOptions.Compiled);
    private static readonly Regex NamedSecretPattern = new(
        @"(?i)\b([A-Za-z][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)|password)\s*[:=]\s*(?:""[^""]*""|'[^']*'|[^\s,;]+)",
        RegexOptions.Compiled);
    private static readonly Regex UriUserInfoPattern = new(
        @"(?i)\b((?:mongodb(?:\+srv)?|https?)://)[^@\s/]+@",
        RegexOptions.Compiled);
    private static readonly Regex DiscordTokenPattern = new(
        @"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}\b",
        RegexOptions.Compiled);
    private static readonly Regex OpaqueIdentifierPattern = new(
        @"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])",
        RegexOptions.Compiled);
    private static readonly Regex StatusPattern = new(
        @"(?i)(?:HTTP|Cron|Discord(?:\s+API)?|Riot(?:\s+API)?(?:\s+error(?:\s+code)?)?)\s*[:=]?\s*(\d{3})",
        RegexOptions.Compiled);

    public static RefreshFailureInfo Classify(Exception exception)
    {
        var ex = Unwrap(exception);
        if (ex is PlayerNotFoundException)
        {
            return Known(RefreshErrorCodes.PlayerNotFound);
        }

        if (ex is StaleRiotIdentityException)
        {
            return Known(RefreshErrorCodes.StaleIdentity);
        }

        if (ex is RiotApiException riot)
        {
            return ClassifyRiot(riot);
        }

        if (ex is CronApiException cron)
        {
            return ClassifyCron(cron);
        }

        if (ex is DiscordApiException discord)
        {
            return ClassifyDiscord(discord.Status);
        }

        if (ex is MongoException)
        {
            return Known(RefreshErrorCodes.Database);
        }

        if (ex is TimeoutException or TaskCanceledException)
        {
            return Known(RefreshErrorCodes.Timeout);
        }

        if (ex is HttpRequestException requestException)
        {
            return requestException.StatusCode is { } status
                ? ClassifyHttpStatus((int)status, requestException.Message)
                : Known(RefreshErrorCodes.Network);
        }

        if (ex is JsonException)
        {
            return Known(RefreshErrorCodes.Protocol);
        }

        return Classify(ex.Message);
    }

    public static RefreshFailureInfo Classify(CronError error)
    {
        RefreshFailureInfo failure;
        if (!string.IsNullOrWhiteSpace(error.Code))
        {
            failure = Known(NormalizeCode(error.Code), error.UpstreamStatus);
        }
        else if (error.UpstreamStatus is { } status)
        {
            failure = ClassifyHttpStatus(status, error.Error);
        }
        else
        {
            failure = Classify(error.Error);
        }

        return error.Retryable is { } retryable
            ? failure with { Retryable = retryable }
            : failure;
    }

    public static RefreshFailureInfo Classify(string? raw)
    {
        var message = SafeText(raw, 360);
        var lower = message.ToLowerInvariant();
        var status = ExtractStatus(message);

        if (
            lower.Contains("discord") &&
            !lower.Contains("missing discord"))
        {
            return ClassifyDiscord(status);
        }

        if (
            lower.Contains("rate limit") ||
            lower.Contains("too many request") ||
            status == 429)
        {
            return Known(RefreshErrorCodes.RateLimited, 429);
        }

        if (
            lower.Contains("decrypt") ||
            lower.Contains("saved account identity") ||
            lower.Contains("riot id or region may have changed") ||
            lower.Contains("none matched this player") ||
            lower.Contains("none matched this player's") ||
            lower.Contains("identity has changed"))
        {
            return Known(RefreshErrorCodes.StaleIdentity, status);
        }

        if (
            lower.Contains("player not found") ||
            lower.Contains("account not found") ||
            lower.Contains("lol account not found") ||
            (status == 404 &&
             (lower.Contains("player") ||
              lower.Contains("account"))))
        {
            return Known(RefreshErrorCodes.PlayerNotFound, 404);
        }

        if (status == 404)
        {
            return Known(RefreshErrorCodes.ResourceNotFound, status);
        }

        if (
            lower.Contains("missing gamename") ||
            lower.Contains("missing tagline") ||
            lower.Contains("missing tft puuid") ||
            lower.Contains("did not return a puuid") ||
            lower.Contains("player record"))
        {
            return Known(RefreshErrorCodes.PlayerData, status);
        }

        if (
            status is 401 or 403 ||
            lower.Contains("api key") && (lower.Contains("expired") || lower.Contains("invalid") || lower.Contains("reject")) ||
            lower.Contains("unauthorized") ||
            lower.Contains("forbidden"))
        {
            return Known(RefreshErrorCodes.AuthInvalid, status);
        }

        if (
            status is 408 or 504 ||
            lower.Contains("timed out") ||
            lower.Contains("timeout"))
        {
            return Known(RefreshErrorCodes.Timeout, status);
        }

        if (
            status is 500 or 502 or 503 or 520 or 521 or 522 or 523 or 524 or 525 or 526 ||
            lower.Contains("riot's api gateway") ||
            lower.Contains("riot api gateway") ||
            lower.Contains("riot service unavailable"))
        {
            return Known(RefreshErrorCodes.RiotUpstream, status);
        }

        if (
            lower.Contains("mongodb") ||
            lower.Contains("mongo ") ||
            lower.Contains("database") ||
            lower.Contains("querysrv"))
        {
            return Known(RefreshErrorCodes.Database, status);
        }

        if (
            lower.Contains("connection refused") ||
            lower.Contains("name resolution") ||
            lower.Contains("no such host") ||
            lower.Contains("network") ||
            lower.Contains("fetch failed") ||
            lower.Contains("dns") ||
            lower.Contains("socket") ||
            lower.Contains("could not reach"))
        {
            return Known(RefreshErrorCodes.Network, status);
        }

        if (
            lower.Contains("config.json") ||
            lower.Contains("missing env") ||
            lower.Contains("missing cron token") ||
            lower.Contains("missing scheduler") ||
            lower.Contains("missing discord_bot_token") ||
            lower.Contains("configuration"))
        {
            return Known(RefreshErrorCodes.Configuration, status);
        }

        if (lower.Contains("another refresh") || lower.Contains("refresh busy"))
        {
            return Known(RefreshErrorCodes.RefreshBusy, status);
        }

        if (lower.Contains("discord"))
        {
            return Known(RefreshErrorCodes.Discord, status);
        }

        if (
            lower.Contains("json") ||
            lower.Contains("unreadable response") ||
            lower.Contains("invalid response") ||
            lower.Contains("response format"))
        {
            return Known(RefreshErrorCodes.Protocol, status);
        }

        if (status is >= 500 and <= 599)
        {
            return Known(RefreshErrorCodes.Server, status);
        }

        return new RefreshFailureInfo(
            RefreshErrorCodes.Unknown,
            "Refresh error",
            string.IsNullOrWhiteSpace(message)
                ? "The refresh failed for an unexpected reason. Open the log for details."
                : message,
            true,
            false,
            0,
            status);
    }

    public static RefreshFailureInfo? Dominant(IEnumerable<RefreshFailureInfo> failures)
    {
        return failures
            .OrderByDescending(failure => FailurePriority(failure.Code))
            .FirstOrDefault();
    }

    public static string SafeDiagnostic(string operation, Exception exception)
    {
        var ex = Unwrap(exception);
        var status = ex switch
        {
            RiotApiException riot => $" HTTP {riot.Status}",
            CronApiException cron => $" HTTP {cron.Status}",
            DiscordApiException discord => $" HTTP {discord.Status}",
            HttpRequestException request when request.StatusCode is { } code => $" HTTP {(int)code}",
            _ => string.Empty,
        };
        return SafeText(
            $"{operation} failed ({ex.GetType().Name}{status}): {ex}",
            5000);
    }

    public static string SafeText(string? raw, int maxLength = 360)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var value = raw.Replace('\0', ' ');
        value = HtmlPattern.Replace(value, " ");
        value = SecretPattern.Replace(value, "$1 [redacted]");
        value = NamedSecretPattern.Replace(value, "$1=[redacted]");
        value = UriUserInfoPattern.Replace(value, "$1[redacted]@");
        value = DiscordTokenPattern.Replace(value, "[redacted-token]");
        value = OpaqueIdentifierPattern.Replace(value, "[redacted-id]");
        value = WhitespacePattern.Replace(value, " ").Trim();
        return value.Length <= maxLength ? value : $"{value[..maxLength]}...";
    }

    private static Exception Unwrap(Exception exception)
    {
        if (exception is AggregateException aggregate)
        {
            return aggregate.Flatten().InnerExceptions.FirstOrDefault() ?? exception;
        }

        return exception;
    }

    private static RefreshFailureInfo ClassifyRiot(RiotApiException exception)
    {
        if (exception.Status == 400 &&
            exception.Message.Contains("decrypt", StringComparison.OrdinalIgnoreCase))
        {
            return Known(RefreshErrorCodes.StaleIdentity, exception.Status);
        }

        return exception.Status switch
        {
            401 or 403 => new RefreshFailureInfo(
                RefreshErrorCodes.AuthInvalid,
                "Riot key rejected",
                "The Riot API key was rejected or has expired. Update the key before refreshes can continue.",
                false,
                true,
                60,
                exception.Status),
            404 => Known(RefreshErrorCodes.ResourceNotFound, exception.Status),
            408 or 504 => Known(RefreshErrorCodes.Timeout, exception.Status),
            429 => Known(RefreshErrorCodes.RateLimited, exception.Status),
            500 or 502 or 503 or 520 or 521 or 522 or 523 or 524 or 525 or 526 =>
                Known(RefreshErrorCodes.RiotUpstream, exception.Status),
            _ => Classify(exception.Message) with { Status = exception.Status },
        };
    }

    private static RefreshFailureInfo ClassifyCron(CronApiException exception)
    {
        if (exception.Status == 0)
        {
            return new RefreshFailureInfo(
                RefreshErrorCodes.Network,
                "RiftBoard website unavailable",
                "The tray could not reach the RiftBoard website. Check the connection; it will retry automatically.",
                true,
                true,
                15);
        }

        if (exception.Status is 401 or 403)
        {
            return new RefreshFailureInfo(
                RefreshErrorCodes.AuthInvalid,
                "Refresh token rejected",
                "The website rejected the tray's refresh token. Update the cron token in the tray settings.",
                false,
                true,
                60,
                exception.Status);
        }

        if (exception.Status == 202)
        {
            return Known(RefreshErrorCodes.RefreshBusy, exception.Status);
        }

        if (exception.Status is 408 or 504)
        {
            return new RefreshFailureInfo(
                RefreshErrorCodes.Timeout,
                "RiftBoard website timed out",
                $"The RiftBoard website refresh timed out{StatusSuffix(exception.Status)}. The tray will retry automatically.",
                true,
                true,
                15,
                exception.Status);
        }

        var bodyFailure = Classify(exception.Message);
        if (bodyFailure.Code != RefreshErrorCodes.Unknown)
        {
            return bodyFailure with { Status = exception.Status };
        }

        return exception.Status switch
        {
            429 => Known(RefreshErrorCodes.RateLimited, exception.Status),
            >= 500 and <= 599 => Known(RefreshErrorCodes.Server, exception.Status),
            _ => Classify(exception.Message) with { Status = exception.Status },
        };
    }

    private static RefreshFailureInfo ClassifyDiscord(int? status)
    {
        return status switch
        {
            0 => new RefreshFailureInfo(
                RefreshErrorCodes.Discord,
                "Discord unavailable",
                "The tray could not reach Discord. It will retry the live-game update automatically.",
                true,
                true,
                15),
            401 or 403 => new RefreshFailureInfo(
                RefreshErrorCodes.Discord,
                "Discord credentials rejected",
                "Discord rejected the bot token or channel permissions. Check the Discord bot configuration.",
                false,
                true,
                60,
                status),
            408 or 504 => new RefreshFailureInfo(
                RefreshErrorCodes.Discord,
                "Discord timed out",
                $"Discord timed out{StatusSuffix(status)}. The tray will retry automatically.",
                true,
                true,
                15,
                status),
            429 => new RefreshFailureInfo(
                RefreshErrorCodes.Discord,
                "Discord rate limited",
                "Discord is rate limiting live-game posts. The tray will wait and retry automatically.",
                true,
                true,
                5,
                status),
            >= 500 and <= 599 => new RefreshFailureInfo(
                RefreshErrorCodes.Discord,
                "Discord unavailable",
                $"Discord is temporarily unavailable{StatusSuffix(status)}. The tray will retry automatically.",
                true,
                true,
                15,
                status),
            _ => new RefreshFailureInfo(
                RefreshErrorCodes.Discord,
                "Discord update failed",
                $"Discord rejected the live-game update{StatusSuffix(status)}. Check the bot and channel permissions.",
                false,
                false,
                0,
                status),
        };
    }

    private static RefreshFailureInfo ClassifyHttpStatus(int status, string? detail)
    {
        return status switch
        {
            401 or 403 => Known(RefreshErrorCodes.AuthInvalid, status),
            404 => Known(RefreshErrorCodes.ResourceNotFound, status),
            408 or 504 => Known(RefreshErrorCodes.Timeout, status),
            429 => Known(RefreshErrorCodes.RateLimited, status),
            500 or 502 or 503 or 520 or 521 or 522 or 523 or 524 or 525 or 526 =>
                Known(RefreshErrorCodes.RiotUpstream, status),
            >= 500 and <= 599 => Known(RefreshErrorCodes.Server, status),
            _ => Classify(detail) with { Status = status },
        };
    }

    private static RefreshFailureInfo Known(string code, int? status = null)
    {
        return NormalizeCode(code) switch
        {
            RefreshErrorCodes.PlayerNotFound => new RefreshFailureInfo(
                RefreshErrorCodes.PlayerNotFound,
                "Player not found",
                "The player or linked Riot account was not found. Check the Riot ID, tag, and region.",
                false,
                false,
                0,
                status),
            RefreshErrorCodes.ResourceNotFound => new RefreshFailureInfo(
                RefreshErrorCodes.ResourceNotFound,
                "Riot data not found",
                "A Riot match or account resource was not found. The saved reference may be stale.",
                false,
                false,
                0,
                status),
            RefreshErrorCodes.StaleIdentity => new RefreshFailureInfo(
                RefreshErrorCodes.StaleIdentity,
                "Account needs attention",
                "Riot could not resolve the saved account identity. The Riot ID or region may have changed.",
                false,
                false,
                0,
                status),
            RefreshErrorCodes.PlayerData => new RefreshFailureInfo(
                RefreshErrorCodes.PlayerData,
                "Player data incomplete",
                "The player record is missing Riot account data needed for refresh.",
                false,
                false,
                0,
                status),
            RefreshErrorCodes.RateLimited => new RefreshFailureInfo(
                RefreshErrorCodes.RateLimited,
                "Rate limited",
                "Riot is rate limiting refreshes. The tray will wait and retry automatically.",
                true,
                true,
                10,
                status ?? 429),
            RefreshErrorCodes.AuthInvalid => new RefreshFailureInfo(
                RefreshErrorCodes.AuthInvalid,
                "Credentials rejected",
                "Refresh credentials were rejected or have expired. Check the Riot API key or cron token.",
                false,
                true,
                60,
                status),
            RefreshErrorCodes.RiotUpstream => new RefreshFailureInfo(
                RefreshErrorCodes.RiotUpstream,
                "Riot service unavailable",
                status == 520
                    ? "Riot's API gateway is temporarily unavailable (HTTP 520). This is not a missing player."
                    : $"Riot's API is temporarily unavailable{StatusSuffix(status)}. The tray will retry automatically.",
                true,
                true,
                15,
                status),
            RefreshErrorCodes.Timeout => new RefreshFailureInfo(
                RefreshErrorCodes.Timeout,
                "Riot request timed out",
                $"Riot's API timed out{StatusSuffix(status)}. The tray will retry automatically.",
                true,
                true,
                15,
                status),
            RefreshErrorCodes.Network => new RefreshFailureInfo(
                RefreshErrorCodes.Network,
                "Network unavailable",
                "The tray could not reach Riot's API. Check the connection; it will retry automatically.",
                true,
                true,
                15,
                status),
            RefreshErrorCodes.Database => new RefreshFailureInfo(
                RefreshErrorCodes.Database,
                "Database unavailable",
                "RiftBoard could not reach its database. The tray will retry automatically.",
                true,
                true,
                15,
                status),
            RefreshErrorCodes.Configuration => new RefreshFailureInfo(
                RefreshErrorCodes.Configuration,
                "Configuration needed",
                "The refresh agent configuration is incomplete or invalid. Check config.json and the required environment values.",
                false,
                true,
                60,
                status),
            RefreshErrorCodes.Discord => new RefreshFailureInfo(
                RefreshErrorCodes.Discord,
                "Discord update failed",
                "Discord could not accept the live-game update. The tray will retry it automatically.",
                true,
                false,
                0,
                status),
            RefreshErrorCodes.RefreshBusy => new RefreshFailureInfo(
                RefreshErrorCodes.RefreshBusy,
                "Refresh already running",
                "Another refresh is already running. The tray will try again later.",
                true,
                false,
                0,
                status),
            RefreshErrorCodes.Protocol => new RefreshFailureInfo(
                RefreshErrorCodes.Protocol,
                "Unreadable response",
                "The refresh service returned an unreadable response. The tray will retry automatically.",
                true,
                true,
                15,
                status),
            RefreshErrorCodes.Server => new RefreshFailureInfo(
                RefreshErrorCodes.Server,
                "Refresh service unavailable",
                $"The refresh service is temporarily unavailable{StatusSuffix(status)}. The tray will retry automatically.",
                true,
                true,
                15,
                status),
            _ => new RefreshFailureInfo(
                RefreshErrorCodes.Unknown,
                "Refresh error",
                "The refresh failed for an unexpected reason. Open the log for details.",
                true,
                false,
                0,
                status),
        };
    }

    private static int FailurePriority(string code)
    {
        return NormalizeCode(code) switch
        {
            RefreshErrorCodes.Configuration or RefreshErrorCodes.AuthInvalid => 100,
            RefreshErrorCodes.Database => 95,
            RefreshErrorCodes.Network or RefreshErrorCodes.Timeout or RefreshErrorCodes.RiotUpstream => 90,
            RefreshErrorCodes.RateLimited => 85,
            RefreshErrorCodes.Server or RefreshErrorCodes.Protocol => 80,
            RefreshErrorCodes.Unknown => 60,
            RefreshErrorCodes.Discord => 50,
            RefreshErrorCodes.StaleIdentity or RefreshErrorCodes.PlayerData => 40,
            RefreshErrorCodes.ResourceNotFound => 35,
            RefreshErrorCodes.PlayerNotFound => 30,
            _ => 10,
        };
    }

    private static string NormalizeCode(string? code)
    {
        return (code ?? string.Empty)
            .Trim()
            .ToLowerInvariant()
            .Replace('-', '_')
            switch
            {
                "riot_rate_limited" => RefreshErrorCodes.RateLimited,
                "riot_rate_limit" => RefreshErrorCodes.RateLimited,
                "database_error" => RefreshErrorCodes.Database,
                "network_error" => RefreshErrorCodes.Network,
                "server_error" => RefreshErrorCodes.Server,
                var normalized => normalized,
            };
    }

    private static int? ExtractStatus(string message)
    {
        var match = StatusPattern.Match(message);
        return match.Success && int.TryParse(match.Groups[1].Value, out var status)
            ? status
            : null;
    }

    private static string StatusSuffix(int? status)
    {
        return status is { } value ? $" (HTTP {value})" : string.Empty;
    }
}

internal sealed record LiveDiscordMessage(string Content, object[] Embeds, string[] AllowedUserIds);

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

internal sealed record TickOutcome(
    int Ok,
    int Fail,
    int Skipped,
    int Scanned,
    string? PlayerSummary,
    string? ErrorSummary,
    int? RetryAfterMs = null,
    RefreshFailureInfo? Failure = null)
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
    public bool CronOnly { get; init; }
    public string RemoteAppUrl { get; init; } = "https://rift-board-myanmar.vercel.app";
    public string CronToken { get; init; } = "";
    public string LocalAppUrl { get; init; } = "http://127.0.0.1:43117";
    public JobConfig RankJob { get; init; } = new() { SyncMatches = true, SyncTftMatches = false };
    public JobConfig TftJob { get; init; } = new() { SyncMatches = false, SyncTftMatches = true };
    public JobConfig LiveJob { get; init; } = new() { IntervalSec = 900, Limit = 5, DelayMs = 2500, SyncMatches = false, SyncTftMatches = false, MatchesCount = 1, MatchBackfillCount = 0 };
    public int StartupTimeoutSec { get; init; } = 120;

    public AgentConfig Normalize()
    {
        return new AgentConfig
        {
            CronOnly = CronOnly,
            RemoteAppUrl = NormalizeRemoteAppUrl(RemoteAppUrl),
            CronToken = CronToken?.Trim() ?? "",
            LocalAppUrl = NormalizeLocalAppUrl(LocalAppUrl),
            RankJob = RankJob.Normalize() with { SyncTftMatches = false },
            TftJob = TftJob.Normalize() with { SyncMatches = false, SyncTftMatches = true },
            LiveJob = LiveJob.NormalizeLiveJob() with { SyncMatches = false, SyncTftMatches = false, MatchesCount = 1 },
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

    private static string NormalizeRemoteAppUrl(string? raw)
    {
        if (
            Uri.TryCreate(raw, UriKind.Absolute, out var uri) &&
            uri.Scheme is "https" or "http" &&
            uri.Host is not "127.0.0.1" and not "localhost" and not "::1")
        {
            return uri.AbsoluteUri.TrimEnd('/');
        }

        return "https://rift-board-myanmar.vercel.app";
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
    public int DelayMs { get; init; } = 1300;
    public int IntervalSec { get; init; } = 600;
    public int? CooldownMs { get; init; }
    public bool Force { get; init; }
    public bool SyncMatches { get; init; } = true;
    public bool SyncTftMatches { get; init; } = true;
    public int MatchesCount { get; init; } = 5;
    public int MatchBackfillCount { get; init; } = 0;

    public JobConfig Normalize()
    {
        return this with
        {
            Limit = Math.Max(1, Math.Min(200, Limit)),
            DelayMs = Math.Max(0, Math.Min(5000, DelayMs)),
            IntervalSec = Math.Max(10 * 60, Math.Min(24 * 60 * 60, IntervalSec)),
            CooldownMs = CooldownMs is null ? null : Math.Max(0, Math.Min(60 * 60 * 1000, CooldownMs.Value)),
            MatchesCount = Math.Max(1, Math.Min(100, MatchesCount)),
            MatchBackfillCount = Math.Max(0, Math.Min(100, MatchBackfillCount)),
        };
    }

    public JobConfig NormalizeLiveJob()
    {
        return Normalize() with
        {
            Limit = Math.Max(1, Math.Min(25, Limit)),
            DelayMs = Math.Max(2000, Math.Min(5000, DelayMs)),
            IntervalSec = Math.Max(15 * 60, Math.Min(24 * 60 * 60, IntervalSec)),
            MatchesCount = 1,
            MatchBackfillCount = 0,
        };
    }
}

internal sealed class CronResponse
{
    public bool Ok { get; init; }
    public bool Skipped { get; init; }
    public string? Reason { get; init; }
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
    public int? RetryAfterMs { get; set; }
}

internal sealed class CronError
{
    public string? PlayerId { get; init; }
    public string? Name { get; init; }
    public string Error { get; init; } = "Refresh failed";
    public string? Code { get; init; }
    public bool? Retryable { get; init; }
    public int? UpstreamStatus { get; init; }
}

internal sealed class CronPlayer
{
    public string? PlayerId { get; init; }
    public string? Name { get; init; }
    public string Status { get; init; } = "ok";
}
