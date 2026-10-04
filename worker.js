export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    /*
      P.V. HOUSE SPORTS DATA SERVICE

      /mlb   = today's MLB schedule/live data
      /ncaaf = NCAA Football odds + scores
      /nfl   = NFL odds + scores
    */

    if (url.pathname === "/mlb") {
      return fetchMlb(request);
    }

    if (url.pathname === "/ncaa-rankings") {
      return fetchNcaaRankings();
    }

    if (url.pathname === "/nfl-standings") {
      return fetchNflStandings();
    }

    let sportKey = null;

    if (url.pathname === "/ncaaf") {
      sportKey = "americanfootball_ncaaf";
    }

    if (url.pathname === "/nfl") {
      sportKey = "americanfootball_nfl";
    }

    if (!sportKey) {
      return new Response(
        "P.V. House Sports API is running.",
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain"
          }
        }
      );
    }

    const oddsURL =
      "https://api.the-odds-api.com/v4/sports/" +
      sportKey +
      "/odds/" +
      "?apiKey=" +
      encodeURIComponent(env.ODDS_API_KEY) +
      "&regions=us" +
      "&markets=h2h,spreads,totals" +
      "&oddsFormat=american" +
      "&dateFormat=iso";

    const scoresURL =
      "https://api.the-odds-api.com/v4/sports/" +
      sportKey +
      "/scores/" +
      "?apiKey=" +
      encodeURIComponent(env.ODDS_API_KEY) +
      "&daysFrom=3" +
      "&dateFormat=iso";

    try {

      const [oddsResponse, scoresResponse] =
        await Promise.all([
          fetch(oddsURL),
          fetch(scoresURL)
        ]);

      if (!oddsResponse.ok) {
        const details = await oddsResponse.text();

        return new Response(
          JSON.stringify({
            error: "Odds request failed",
            status: oddsResponse.status,
            details
          }),
          {
            status: oddsResponse.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }

      if (!scoresResponse.ok) {
        const details = await scoresResponse.text();

        return new Response(
          JSON.stringify({
            error: "Scores request failed",
            status: scoresResponse.status,
            details
          }),
          {
            status: scoresResponse.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }

      const odds = await oddsResponse.json();
      const scores = await scoresResponse.json();
      const espnResponse = sportKey === "americanfootball_nfl"
        ? await fetch(ESPN_NFL_SCOREBOARD).catch(() => null)
        : null;
      const espnPayload = espnResponse && espnResponse.ok
        ? await espnResponse.json().catch(() => null)
        : null;

      const scoreLookup = {};

      for (const scoreGame of scores) {
        scoreLookup[scoreGame.id] = scoreGame;
      }

      const mergedGames = odds.map(game => {
        const scoreGame = scoreLookup[game.id];

        return {
          ...game,
          completed: scoreGame
            ? scoreGame.completed
            : false,
          scores: scoreGame && scoreGame.scores
            ? scoreGame.scores
            : null,
          last_update: scoreGame
            ? scoreGame.last_update
            : null
        };
      });

      // Enrich NFL odds games with the free ESPN scoreboard feed. This adds
      // verified game status, scores, records, venue, and available leaders
      // without exposing another API key to the browser.
      if (sportKey === "americanfootball_nfl" && Array.isArray(espnPayload?.events)) {
        for (const game of mergedGames) {
          const espnEvent = espnPayload.events.find(event => {
            const competition = event.competitions?.[0];
            const competitors = competition?.competitors || [];
            const away = competitors.find(team => team.homeAway === "away");
            const home = competitors.find(team => team.homeAway === "home");
            return away && home &&
              sameFootballTeam(game.away_team, away.team?.displayName) &&
              sameFootballTeam(game.home_team, home.team?.displayName);
          });

          if (espnEvent) game.espn = normalizeEspnNflEvent(espnEvent);
        }
      }

      // The odds endpoint can omit recently completed games. Keep those
      // score-only games for MLB so the board can show recent finals too.
      if (sportKey === "baseball_mlb") {
        const oddsIds = new Set(mergedGames.map(game => game.id));

        for (const scoreGame of scores) {
          if (oddsIds.has(scoreGame.id)) continue;

          mergedGames.push({
            id: scoreGame.id,
            sport_key: sportKey,
            commence_time: scoreGame.commence_time,
            home_team: scoreGame.home_team,
            away_team: scoreGame.away_team,
            completed: scoreGame.completed === true,
            scores: scoreGame.scores || null,
            last_update: scoreGame.last_update || null,
            bookmakers: []
          });
        }
      }

      return new Response(
        JSON.stringify(mergedGames),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=300"
          }
        }
      );

    } catch (error) {

      return new Response(
        JSON.stringify({
          error: error.message
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );

    }
  }
};

const MLB_API = "https://statsapi.mlb.com/api/v1/schedule";
const ESPN_NFL_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const MLB_TIME_ZONE = "America/Los_Angeles";
const LOCAL_MLB_TEAMS = {
  "Los Angeles Dodgers": "Dodgers",
  "Los Angeles Angels": "Angels"
};

const NCAA_RANKINGS_URL = "https://www.ncaa.com/rankings/football/fbs/associated-press";
const NFL_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";
const NCAA_LOGO_SLUGS = {
  "Texas": "texas",
  "Georgia": "georgia",
  "Notre Dame": "notre-dame",
  "Miami (FL)": "miami",
  "Miami": "miami",
  "Ohio State": "ohio-state",
  "Indiana": "indiana",
  "Alabama": "alabama",
  "Florida": "florida",
  "Ole Miss": "ole-miss",
  "BYU": "byu",
  "LSU": "lsu",
  "Texas Tech": "texas-tech",
  "Utah": "utah",
  "Iowa": "iowa",
  "Oregon": "oregon",
  "Mississippi State": "mississippi-state",
  "Tennessee": "tennessee",
  "Southern Cal": "usc",
  "USC": "usc",
  "Oklahoma State": "oklahoma-state",
  "Houston": "houston",
  "SMU": "smu",
  "Boise State": "boise-state",
  "UCLA": "ucla",
  "Kentucky": "kentucky",
  "Missouri": "missouri",
  "Wisconsin": "wisconsin",
  "Duke": "duke",
  "Penn State": "penn-state",
  "Wake Forest": "wake-forest",
  "Virginia Tech": "virginia-tech",
  "Michigan": "michigan",
  "Pittsburgh": "pittsburgh",
  "Nebraska": "nebraska",
  "Louisville": "louisville",
  "Cincinnati": "cincinnati",
  "James Madison": "james-madison",
  "Arizona": "arizona",
  "Minnesota": "minnesota",
  "North Dakota State": "north-dakota-state",
  "Northwestern": "northwestern"
};

async function fetchNcaaRankings() {
  try {
    const response = await fetch(NCAA_RANKINGS_URL, {
      headers: { "User-Agent": "PVHSN/1.0 standings display" }
    });

    if (!response.ok) {
      return jsonResponse({ error: "NCAA rankings request failed", status: response.status }, response.status);
    }

    const html = await response.text();
    const through = cleanHtmlText(html.match(/<figure class="rankings-last-updated">([\s\S]*?)<\/figure>/i)?.[1] || "");
    const rankings = [];
    const rowPattern = /<tr>\s*<td>(\d+)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;

    for (const match of html.matchAll(rowPattern)) {
      const rank = Number(match[1]);
      const team = cleanHtmlText(match[2]).replace(/\s*\([^)]*\)\s*$/, "");
      const record = cleanHtmlText(match[3]);
      const previous = cleanHtmlText(match[4]);
      if (!rank || !team) continue;

      rankings.push({
        rank,
        team,
        record,
        previous,
        move: movementFor(rank, previous),
        logo: NCAA_LOGO_SLUGS[team] || null,
        abbr: initialsFor(team)
      });

      if (rankings.length === 25) break;
    }

    if (rankings.length !== 25) {
      return jsonResponse({ error: "NCAA rankings table could not be parsed" }, 502);
    }

    return jsonResponse({ source: NCAA_RANKINGS_URL, through, updatedAt: new Date().toISOString(), rankings }, 200, 300);
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function fetchNflStandings() {
  try {
    const response = await fetch(NFL_STANDINGS_URL, {
      headers: { "User-Agent": "PVHSN/1.0 standings display" }
    });

    if (!response.ok) {
      return jsonResponse({ error: "NFL standings request failed", status: response.status }, response.status);
    }

    const payload = await response.json();
    return jsonResponse(payload, 200, 60);
  } catch (error) {
    return jsonResponse({ error: error.message }, 502);
  }
}

function cleanHtmlText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#039;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function movementFor(rank, previous) {
  if (!/^\d+$/.test(previous)) return "NR";
  const previousRank = Number(previous);
  if (previousRank === rank) return "—";
  return previousRank > rank ? `+${previousRank - rank}` : `-${rank - previousRank}`;
}

function initialsFor(team) {
  return team.split(/\s+/).map(word => word[0]).join("").slice(0, 4).toUpperCase();
}

function jsonResponse(payload, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": `public, max-age=${maxAge}`
    }
  });
}

function sameFootballTeam(left, right) {
  if (!left || !right) return false;

  const normalize = value => value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/atlanta|neworleans|losangeles|sanfrancisco|tampabay|newyork/g, "");

  return normalize(left) === normalize(right) ||
    normalize(left).includes(normalize(right)) ||
    normalize(right).includes(normalize(left));
}

function normalizeEspnNflEvent(event) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const away = competitors.find(team => team.homeAway === "away") || {};
  const home = competitors.find(team => team.homeAway === "home") || {};
  const status = competition.status || event.status || {};
  const statusType = status.type || {};
  const records = team => team.records?.find(record => record.type === "total")?.summary || null;
  const leaders = {};

  for (const leaderGroup of competition.leaders || []) {
    const leader = leaderGroup.leaders?.[0];
    if (!leader?.athlete?.fullName || !leader.team?.id) continue;
    if (leaderGroup.name === "passingYards") leaders[leader.team.id] = {
      name: leader.athlete.fullName,
      stat: leader.displayValue || `${leader.value} YDS`
    };
  }

  return {
    eventId: event.id || null,
    status: statusType.shortDetail || statusType.detail || statusType.description || null,
    state: statusType.state || null,
    completed: statusType.completed === true,
    away: {
      abbreviation: away.team?.abbreviation || null,
      score: away.score ?? null,
      record: records(away),
      passingLeader: leaders[away.team?.id] || null
    },
    home: {
      abbreviation: home.team?.abbreviation || null,
      score: home.score ?? null,
      record: records(home),
      passingLeader: leaders[home.team?.id] || null
    },
    venue: competition.venue?.fullName || null
  };
}

function todayInLosAngeles() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MLB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function mlbCacheKey(date) {
  return new Request(
    `https://pv-house-sports.gian-ganziano.workers.dev/mlb?date=${date}&source=stats-v2`,
    { method: "GET" }
  );
}

function mlbTeam(team) {
  if (!team) return null;

  return {
    id: team.id ?? null,
    name: team.name || team.teamName || null,
    abbreviation: team.abbreviation || null,
    shortName: team.shortName || null
  };
}

function mlbPitcher(team) {
  const pitcher = team && team.probablePitcher;
  if (!pitcher) return null;

  return {
    id: pitcher.id ?? null,
    name: pitcher.fullName || pitcher.firstLastName || pitcher.lastName || null
  };
}

function normalizeMlbGame(game) {
  const away = game.teams && game.teams.away;
  const home = game.teams && game.teams.home;
  const linescore = game.linescore || {};
  const linescoreAway = linescore.teams && linescore.teams.away || {};
  const linescoreHome = linescore.teams && linescore.teams.home || {};
  const status = game.status || {};
  const awayTeam = mlbTeam(away && away.team);
  const homeTeam = mlbTeam(home && home.team);
  const localTeamName = [awayTeam, homeTeam]
    .map(team => team && team.name)
    .find(name => LOCAL_MLB_TEAMS[name]);
  const isLive = status.abstractGameState === "Live" || status.codedGameState === "I";
  const isFinal = status.abstractGameState === "Final" || status.codedGameState === "F";

  return {
    id: game.gamePk,
    gamePk: game.gamePk,
    startTime: game.gameDate || null,
    awayTeam,
    homeTeam,
    awayScore: away && away.score != null ? away.score : null,
    homeScore: home && home.score != null ? home.score : null,
    status: {
      label: isFinal ? "FINAL" : isLive ? "LIVE" : "UPCOMING",
      abstract: status.abstractGameState || null,
      detailed: status.detailedState || null,
      code: status.statusCode || status.codedGameState || null
    },
    currentInning: linescore.currentInning ?? null,
    currentInningOrdinal: linescore.currentInningOrdinal || null,
    inningState: linescore.inningState || null,
    outs: linescore.outs ?? null,
    awayStats: {
      runs: linescoreAway.runs != null ? linescoreAway.runs : (away && away.score != null ? away.score : null),
      hits: linescoreAway.hits != null ? linescoreAway.hits : (away && away.hits != null ? away.hits : null),
      errors: linescoreAway.errors != null ? linescoreAway.errors : (away && away.errors != null ? away.errors : null)
    },
    homeStats: {
      runs: linescoreHome.runs != null ? linescoreHome.runs : (home && home.score != null ? home.score : null),
      hits: linescoreHome.hits != null ? linescoreHome.hits : (home && home.hits != null ? home.hits : null),
      errors: linescoreHome.errors != null ? linescoreHome.errors : (home && home.errors != null ? home.errors : null)
    },
    probablePitchers: {
      away: mlbPitcher(away),
      home: mlbPitcher(home)
    },
    venue: game.venue ? {
      id: game.venue.id ?? null,
      name: game.venue.name || null
    } : null,
    isLocalTeam: Boolean(localTeamName),
    localTeam: localTeamName ? {
      name: localTeamName,
      shortName: LOCAL_MLB_TEAMS[localTeamName]
    } : null
  };
}

async function fetchMlb(request) {
  const date = todayInLosAngeles();
  const cache = caches.default;
  const cacheKey = mlbCacheKey(date);
  const cached = await cache.match(cacheKey);

  const apiUrl = new URL(MLB_API);
  apiUrl.searchParams.set("sportId", "1");
  apiUrl.searchParams.set("date", date);
  apiUrl.searchParams.set(
    "hydrate",
    "team,venue,probablePitcher,linescore"
  );

  try {
    const upstream = await fetch(apiUrl.toString(), {
      headers: { "Accept": "application/json" }
    });

    if (!upstream.ok) {
      throw new Error(`MLB schedule request failed (${upstream.status})`);
    }

    const payload = await upstream.json();
    const games = (payload.dates || [])
      .flatMap(day => day.games || [])
      .map(normalizeMlbGame)
      .filter(game => game && game.id != null)
      .sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));

    const hasLiveGame = games.some(game => game.status.label === "LIVE");
    const cacheSeconds = hasLiveGame ? 15 : 300;
    const response = new Response(JSON.stringify(games), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": `public, max-age=${cacheSeconds}, stale-while-revalidate=60`,
        "X-MLB-Date": date,
        "X-MLB-Source": "MLB Stats API"
      }
    });

    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    if (cached) {
      const body = await cached.json();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "X-MLB-Date": date,
          "X-MLB-Source": "MLB Stats API (last-known-good)",
          "X-MLB-Data-Stale": "1"
        }
      });
    }

    return new Response(JSON.stringify({
      error: "MLB schedule unavailable",
      message: error.message,
      date,
      games: []
    }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "X-MLB-Date": date
      }
    });
  }
}
