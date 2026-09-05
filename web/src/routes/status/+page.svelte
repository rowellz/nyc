<script>
  import { onMount } from 'svelte';

  import { cityClock, duration, weatherLabel, phaseOfDay } from '$lib/format.js';
  import { LANDMARKS } from '$lib/shared/constants.js';

  let { data } = $props();

  // Rendered on the server from the live world, then refreshed from
  // /world/api/status — the same object, over HTTP.
  let status = $state(data.status);
  let stale = $state(false);

  const found = $derived(new Set(status?.landmarksDiscovered ?? []));
  const players = $derived([...(status?.players ?? [])].sort((a, b) => b.score - a.score));

  onMount(() => {
    const poll = async () => {
      try {
        const res = await fetch('/world/api/status');
        const body = await res.json();
        if (body.running) { status = body; stale = false; } else { stale = true; }
      } catch {
        stale = true;
      }
    };
    const timer = setInterval(poll, 2000);
    poll();
    return () => clearInterval(timer);
  });
</script>

<svelte:head><title>Status — New York</title></svelte:head>

<section class="shell">
  <p class="eyebrow">Live</p>
  <h1 class="title">City status</h1>

  {#if !status}
    <div class="card">
      <p class="dim" style="margin:0">
        The simulation is not running in this process. Start it with
        <span class="mono">node server.js</span>.
      </p>
    </div>
  {:else}
    <p class="dim sub">
      Polled every 2&nbsp;s from <span class="mono">/world/api/status</span>.
      {#if stale}<span style="color: var(--red)"> — connection lost, showing the last good read.</span>{/if}
    </p>

    <div class="stats">
      <div class="card stat">
        <p class="eyebrow">Online</p>
        <p class="stat-value" style="color: var(--amber)">{status.playersOnline}</p>
        <p class="faint small">of {status.maxPlayers.toLocaleString()} slots</p>
      </div>
      <div class="card stat">
        <p class="eyebrow">City time</p>
        <p class="stat-value">{cityClock(status.dayFraction)}</p>
        <p class="faint small">{phaseOfDay(status.dayFraction)}</p>
      </div>
      <div class="card stat">
        <p class="eyebrow">Weather</p>
        <p class="stat-value" style="color: var(--sky)">{weatherLabel(status.weather.condition)}</p>
        <p class="faint small">
          {status.weather.temperatureC}°C · cloud {(status.weather.cloudCover * 100) | 0}% ·
          wet {(status.weather.wetness * 100) | 0}% · source {status.weather.source}
        </p>
      </div>
      <div class="card stat">
        <p class="eyebrow">Uptime</p>
        <p class="stat-value">{duration(status.uptimeSeconds)}</p>
        <p class="faint small">server clock {status.serverTime.toFixed(0)}s</p>
      </div>
    </div>

    <div class="columns">
      <div class="card">
        <h2>Leaderboard</h2>
        {#if status.leaderboard.length === 0}
          <p class="faint small" style="margin:0">Nobody has joined since boot.</p>
        {:else}
          <table>
            <thead>
              <tr><th>#</th><th>Handle</th><th>Score</th><th>Kills</th><th></th></tr>
            </thead>
            <tbody>
              {#each status.leaderboard as e (e.name)}
                <tr>
                  <td class="num faint">{e.rank}</td>
                  <td class="mono">{e.name}</td>
                  <td class="num">{e.score}</td>
                  <td class="num">{e.kills}</td>
                  <td>{#if e.online}<span class="pill pill-live">online</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <div class="card">
        <h2>In the city now</h2>
        {#if players.length === 0}
          <p class="faint small" style="margin:0">The streets are empty. <a href="/play">Go for a walk</a>.</p>
        {:else}
          <table>
            <thead>
              <tr><th>Handle</th><th>Score</th><th>Position</th><th>For</th><th></th></tr>
            </thead>
            <tbody>
              {#each players as p (p.id)}
                <tr>
                  <td class="mono">{p.name}</td>
                  <td class="num">{p.score}</td>
                  <td class="num faint">{p.x}, {p.z}</td>
                  <td class="num faint">{duration(p.onlineSeconds)}</td>
                  <td>
                    {#if p.dead}<span class="pill pill-dead">down</span>
                    {:else if p.inSafeZone}<span class="pill">safe zone</span>
                    {:else if p.protected}<span class="pill">protected</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>

    <div class="card landmarks">
      <h2>Landmarks discovered <span class="faint mono">{found.size}/{LANDMARKS.length}</span></h2>
      <ul>
        {#each LANDMARKS as l (l.id)}
          <li class:found={found.has(l.id)}>{l.name}</li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .title { font-size: 2rem; margin-block: 0.3rem 0.4rem; }
  .sub { font-size: 0.85rem; margin-bottom: 1.4rem; }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.9rem;
    margin-bottom: 1.4rem;
  }
  .stat p { margin: 0; }
  .stat .stat-value { margin-block: 0.35rem 0.2rem; }
  .small { font-size: 0.78rem; }

  .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0.9rem; }
  h2 { font-size: 0.95rem; margin-bottom: 0.7rem; }
  tbody tr:last-child td { border-bottom: none; }

  .landmarks { margin-top: 0.9rem; }
  .landmarks ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 0.2rem 0.9rem;
    font-size: 0.85rem;
  }
  .landmarks li { color: var(--ink-faint); }
  .landmarks li::before { content: '· '; }
  .landmarks li.found { color: var(--green); }
  .landmarks li.found::before { content: '✓ '; }
</style>
