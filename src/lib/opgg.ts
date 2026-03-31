function normalizePlatform(platform: unknown) {
  return String(platform ?? "").trim().toLowerCase();
}

export function platformToOpggRegion(platform: unknown) {
  const value = normalizePlatform(platform);

  switch (value) {
    case "na1":
      return "na";
    case "br1":
      return "br";
    case "euw1":
      return "euw";
    case "eun1":
      return "eune";
    case "kr":
      return "kr";
    case "jp1":
      return "jp";
    case "la1":
      return "lan";
    case "la2":
      return "las";
    case "oc1":
      return "oce";
    case "ru":
      return "ru";
    case "tr1":
      return "tr";
    case "sg2":
      return "sg";
    case "ph2":
      return "ph";
    case "th2":
      return "th";
    case "tw2":
      return "tw";
    case "vn2":
      return "vn";
    default:
      return null;
  }
}

export function buildOpggSummonerUrl(
  platform: unknown,
  gameName: unknown,
  tagLine: unknown
) {
  const region = platformToOpggRegion(platform);
  const cleanGameName = String(gameName ?? "").trim();
  const cleanTagLine = String(tagLine ?? "").trim();

  if (!region || !cleanGameName || !cleanTagLine) return null;

  const slug = encodeURIComponent(`${cleanGameName}-${cleanTagLine}`);
  return `https://op.gg/lol/summoners/${region}/${slug}`;
}
