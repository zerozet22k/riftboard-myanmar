using RiftBoardRefreshTray;

var failures = new List<string>();

Check(
    "player not found",
    RefreshErrorClassifier.Classify(
        new PlayerNotFoundException("missing")),
    RefreshErrorCodes.PlayerNotFound,
    retryable: false,
    stopBatch: false);
Check(
    "stale Riot identity",
    RefreshErrorClassifier.Classify(
        new StaleRiotIdentityException("decrypt failed")),
    RefreshErrorCodes.StaleIdentity,
    retryable: false,
    stopBatch: false);
Check(
    "Riot 520",
    RefreshErrorClassifier.Classify(
        new RiotApiException(520, "Web server returned an unknown error")),
    RefreshErrorCodes.RiotUpstream,
    retryable: true,
    stopBatch: true);
Check(
    "Riot 504",
    RefreshErrorClassifier.Classify(
        new RiotApiException(504, "Gateway timeout")),
    RefreshErrorCodes.Timeout,
    retryable: true,
    stopBatch: true);
Check(
    "Riot 429",
    RefreshErrorClassifier.Classify(
        new RiotApiException(429, "Rate limit exceeded", 120_000)),
    RefreshErrorCodes.RateLimited,
    retryable: true,
    stopBatch: true);
Check(
    "Riot credentials",
    RefreshErrorClassifier.Classify(
        new RiotApiException(403, "Forbidden")),
    RefreshErrorCodes.AuthInvalid,
    retryable: false,
    stopBatch: true);
Check(
    "Riot match 404",
    RefreshErrorClassifier.Classify(
        new RiotApiException(404, "Data not found")),
    RefreshErrorCodes.ResourceNotFound,
    retryable: false,
    stopBatch: false);
Check(
    "network",
    RefreshErrorClassifier.Classify(
        new HttpRequestException("No such host is known")),
    RefreshErrorCodes.Network,
    retryable: true,
    stopBatch: true);
Check(
    "remote website timeout",
    RefreshErrorClassifier.Classify(
        new CronApiException(408, "website timed out")),
    RefreshErrorCodes.Timeout,
    retryable: true,
    stopBatch: true);
Check(
    "Discord rate limit",
    RefreshErrorClassifier.Classify(
        new DiscordApiException(429, "rate limited", 5_000)),
    RefreshErrorCodes.Discord,
    retryable: true,
    stopBatch: true);
Check(
    "structured cron error",
    RefreshErrorClassifier.Classify(new CronError
    {
        Error = "opaque provider message",
        Code = "PLAYER_NOT_FOUND",
        Retryable = false,
        UpstreamStatus = 404,
    }),
    RefreshErrorCodes.PlayerNotFound,
    retryable: false,
    stopBatch: false);

var dominant = RefreshErrorClassifier.Dominant(
[
    RefreshErrorClassifier.Classify(
        new PlayerNotFoundException("missing")),
    RefreshErrorClassifier.Classify(
        new RiotApiException(520, "gateway failure")),
]);
if (dominant?.Code != RefreshErrorCodes.RiotUpstream)
{
    failures.Add(
        $"dominant failure: expected {RefreshErrorCodes.RiotUpstream}, got {dominant?.Code ?? "null"}");
}

var opaqueId = new string('A', 64);
var unsafeDiagnostic =
    $"MONGODB_URI=mongodb+srv://admin:secret@cluster.example/db " +
    $"DISCORD_BOT_TOKEN=abc.def.ghi opaque={opaqueId}";
var safeDiagnostic = RefreshErrorClassifier.SafeText(
    unsafeDiagnostic,
    1000);
if (
    safeDiagnostic.Contains("admin:secret", StringComparison.Ordinal) ||
    safeDiagnostic.Contains("abc.def.ghi", StringComparison.Ordinal) ||
    safeDiagnostic.Contains(opaqueId, StringComparison.Ordinal))
{
    failures.Add("diagnostic redaction: a credential or opaque identifier remained visible");
}

var realLogShape = RefreshErrorClassifier.Classify(
    "Rank / LoL: Riot API error code: 520 Web server returned an unknown error");
if (realLogShape.Code != RefreshErrorCodes.RiotUpstream)
{
    failures.Add(
        $"real 520 log: expected {RefreshErrorCodes.RiotUpstream}, got {realLogShape.Code}");
}

if (failures.Count > 0)
{
    Console.Error.WriteLine("RiftBoard tray smoke tests failed:");
    foreach (var failure in failures)
    {
        Console.Error.WriteLine($"- {failure}");
    }
    return 1;
}

Console.WriteLine("RiftBoard tray smoke tests passed (14 checks).");
return 0;

void Check(
    string name,
    RefreshFailureInfo actual,
    string expectedCode,
    bool retryable,
    bool stopBatch)
{
    if (
        actual.Code != expectedCode ||
        actual.Retryable != retryable ||
        actual.StopBatch != stopBatch)
    {
        failures.Add(
            $"{name}: expected {expectedCode}/{retryable}/{stopBatch}, " +
            $"got {actual.Code}/{actual.Retryable}/{actual.StopBatch}");
    }
}
