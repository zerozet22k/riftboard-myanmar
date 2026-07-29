using RiftBoardRefreshTray;
using MongoDB.Bson;

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
var missingPlatformHost = new HttpRequestException(
    HttpRequestError.NameResolutionError,
    "No such host is known");
if (!CSharpRefreshService.IsMissingPlatformHost(missingPlatformHost))
{
    failures.Add("missing shard host: name-resolution failure was not skippable");
}
Check(
    "Riot shard DNS",
    RefreshErrorClassifier.Classify(
        new RiotTransportException(
            "ph2.api.riotgames.com",
            missingPlatformHost)),
    RefreshErrorCodes.Network,
    retryable: true,
    stopBatch: true);
Check(
    "confirmed decrypt survives missing shard host",
    RefreshErrorClassifier.Classify(
        new StaleRiotIdentityException(
            "confirmed decrypting failure",
            new RiotTransportException(
                "ph2.api.riotgames.com",
                missingPlatformHost))),
    RefreshErrorCodes.StaleIdentity,
    retryable: false,
    stopBatch: false);
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

var systemicSummary = RefreshLoop.BuildCronErrorSummary(
[
    new CronError
    {
        Name = "Keriya#sawny",
        Error = "network",
        Code = RefreshErrorCodes.Network,
        Retryable = true,
    },
]);
if (
    systemicSummary?.Contains("Affected:", StringComparison.OrdinalIgnoreCase) ==
    true)
{
    failures.Add("systemic summary: first in-flight player was shown as affected");
}

var savedIdentityLabel = CSharpRefreshService.FailurePlayerLabel(
    "Keriya#sawny",
    RefreshErrorClassifier.Classify(
        new StaleRiotIdentityException("decrypt failed")));
if (!savedIdentityLabel.Contains("(saved Riot ID)", StringComparison.Ordinal))
{
    failures.Add("stale identity label: did not identify the displayed name as saved");
}

if (
    !CSharpRefreshService.HasSavedLolIdentity(" stored-puuid ") ||
    CSharpRefreshService.HasSavedLolIdentity("   ") ||
    CSharpRefreshService.HasSavedLolIdentity(null))
{
    failures.Add("identity anchor: existing players must resolve from their saved LoL PUUID");
}

if (
    CSharpRefreshService.HasSeparateTftIdentityScope(
        "shared",
        " shared ",
        null) ||
    CSharpRefreshService.HasSeparateTftIdentityScope(
        "shared",
        null,
        null) ||
    !CSharpRefreshService.HasSeparateTftIdentityScope(
        "lol",
        "tft",
        null) ||
    !CSharpRefreshService.HasSeparateTftIdentityScope(
        "lol",
        "   ",
        "legacy-tft"))
{
    failures.Add("TFT key scope: shared keys should reuse the LoL PUUID");
}

var providerOpaqueId = new string('P', 78);
var providerDiagnostic = RefreshErrorClassifier.SafeDiagnostic(
    "TFT refresh",
    new StaleRiotIdentityException(
        "saved identity failed",
        new RiotApiException(
            400,
            $"Bad Request - Exception decrypting {providerOpaqueId}",
            endpointHost: "asia.api.riotgames.com")));
if (
    !providerDiagnostic.Contains("HTTP 400", StringComparison.Ordinal) ||
    !providerDiagnostic.Contains(
        "host=asia.api.riotgames.com",
        StringComparison.Ordinal) ||
    providerDiagnostic.Contains(providerOpaqueId, StringComparison.Ordinal))
{
    failures.Add("provider diagnostic: host/status missing or opaque ID was not redacted");
}

var renamedPlayer = new BsonDocument
{
    ["gameName"] = "Keriya",
    ["tagLine"] = "sawny",
    ["riotIdAliases"] = new BsonArray
    {
        new BsonDocument
        {
            ["gameName"] = "PeyzPal",
            ["tagLine"] = "sawny",
            ["gameNameNorm"] = "peyzpal",
            ["tagLineNorm"] = "sawny",
            ["observedAt"] = DateTime.UtcNow.AddDays(-1),
        },
    },
};
var renamedAliases = CSharpRefreshService.BuildCanonicalRiotIdAliases(
    renamedPlayer,
    "PeyzPal",
    "sawny",
    DateTime.UtcNow);
if (
    renamedAliases.Count != 1 ||
    renamedAliases[0]["gameName"] != "Keriya" ||
    renamedAliases.Any(alias =>
        alias["gameNameNorm"] == "peyzpal" &&
        alias["tagLineNorm"] == "sawny"))
{
    failures.Add("canonical aliases: old Riot ID was not preserved cleanly");
}

var envFixtureRoot = Path.Combine(
    Path.GetTempPath(),
    $"riftboard-tray-env-smoke-{Guid.NewGuid():N}");
var envOnlyKey = $"RIFTBOARD_SMOKE_ENV_ONLY_{Guid.NewGuid():N}";
var localWinsKey = $"RIFTBOARD_SMOKE_LOCAL_WINS_{Guid.NewGuid():N}";
var processWinsKey = $"RIFTBOARD_SMOKE_PROCESS_WINS_{Guid.NewGuid():N}";
var processBlankKey = $"RIFTBOARD_SMOKE_PROCESS_BLANK_{Guid.NewGuid():N}";
Directory.CreateDirectory(envFixtureRoot);
try
{
    File.WriteAllLines(
        Path.Combine(envFixtureRoot, ".env"),
        [
            $"{envOnlyKey}=env",
            $"{localWinsKey}=env",
            $"{processWinsKey}=env",
            $"{processBlankKey}=env",
        ]);
    File.WriteAllLines(
        Path.Combine(envFixtureRoot, ".env.local"),
        [
            $"{localWinsKey}=local",
            $"{processWinsKey}=local",
            $"{processBlankKey}=local",
        ]);

    var loadedEnv = CSharpRefreshService.LoadEnv(
        envFixtureRoot,
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [processWinsKey] = "process",
            [processBlankKey] = "",
        });
    CheckEnvValue(".env fallback", loadedEnv, envOnlyKey, "env");
    CheckEnvValue(".env.local precedence", loadedEnv, localWinsKey, "local");
    CheckEnvValue("process env precedence", loadedEnv, processWinsKey, "process");
    CheckEnvValue("blank process env revocation", loadedEnv, processBlankKey, "");

    if (Environment.GetEnvironmentVariable(envOnlyKey) is not null)
    {
        failures.Add("env parsing: file values leaked into the process environment");
    }
}
finally
{
    Directory.Delete(envFixtureRoot, recursive: true);
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

Console.WriteLine("RiftBoard tray smoke tests passed (26 checks).");
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

void CheckEnvValue(
    string name,
    IReadOnlyDictionary<string, string> values,
    string key,
    string expected)
{
    if (!values.TryGetValue(key, out var actual) || actual != expected)
    {
        failures.Add($"{name}: effective environment did not contain the expected source");
    }
}
