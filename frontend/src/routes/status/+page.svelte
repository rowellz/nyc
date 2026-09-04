<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { clockFromDayFraction, phaseFromDayFraction, prettyCondition, formatUptime } from '$lib/format';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const s = $derived(data.status);

  let live = $state(true);

  // The status endpoint is a plain poll; the authoritative feed is the game's
  // WebSocket, which belongs to the client, not to this page.
  onMount(() => {
    const id = setInterval(() => { if (live) invalidateAll(); }, 5000);
    return () => clearInterval(id);
  });

  const windDirName = (rad: number) => {
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const deg = ((-rad * 180) / Math.PI + 360) % 360;
    return names[Math.round(deg / 45) % 8];
  };
</script>

<svelte:head><title>Status — New York</title></svelte:head>

<section class="wrap head">
  <p class="eyebrow">Live world state</p>
  <h1>Status</h1>
  <label class="toggle tiny muted">
    <input type="checkbox" bind:checked={live} />
    <span>Auto-refresh every 5s</span>
  </label>
</section>

{#if !s}
  <section class="wrap">
    <div class="card down">
      <span class="dot off"></span>
      <div>
        <strong>Game service unreachable.</strong>
        <p class="muted tiny">
          This page reads <code>/world/api/status</code> from the <code>nyc</code> service.
          Check that it is running: <code>docker compose ps</code>.
        </p>
      </div>
    </div>
  </section>
{:else}
  <section class="wrap tiles">
    <div class="card tile">
      <div class="k eyebrow">Players online</div>
      <div class="v">{s.playersOnline}</div>
      <div class="tiny muted">{s.profilesSeen} profiles seen since boot</div>
    </div>
    <div class="card tile">
      <div class="k eyebrow">City time</div>
      <div class="v">{clockFromDayFraction(s.dayFraction)}</div>
      <div class="tiny muted">{phaseFromDayFraction(s.dayFraction)} · {s.dayLength / 3600}h day cycle</div>
    </div>
    <div class="card tile">
      <div class="k eyebrow">Weather</div>
      <div class="v small">{prettyCondition(s.weather.condition)}</div>
      <div class="tiny muted">
        {Math.round(s.weather.temperatureC)}°C · wind {s.weather.wind.toFixed(1)} m/s {windDirName(s.weather.windDir)}
        · source {s.weather.source}
      </div>
    </div>
    <div class="card tile">
      <div class="k eyebrow">Uptime</div>
      <div class="v">{formatUptime(s.uptimeSeconds)}</div>
      <div class="tiny muted">v{s.version} · protocol v{s.protocol}</div>
    </div>
  </section>

  <section class="wrap cols">
    <div class="card">
      <h2>In the city now</h2>
      {#if s.players.length === 0}
        <p class="muted tiny empty">Nobody is online. <a href="/play">Be the first →</a></p>
      {:else}
        <table>
          <thead>
            <tr><th>Player</th><th class="num">Score</th><th class="num">Kills</th><th class="num">Position</th></tr>
          </thead>
          <tbody>
            {#each s.players as p (p.id)}
              <tr>
                <td>
                  <span class="dot" class:on={!p.dead} class:off={p.dead}></span>
                  {p.name}
                </td>
                <td class="num">{p.score}</td>
                <td class="num">{p.kills}</td>
                <td class="num tiny muted">{p.x}, {p.z}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="card">
      <h2>Leaderboard</h2>
      {#if s.leaderboard.length === 0}
        <p class="muted tiny empty">No scores yet.</p>
      {:else}
        <table>
          <thead>
            <tr><th class="num">#</th><th>Player</th><th class="num">Score</th><th class="num">Kills</th></tr>
          </thead>
          <tbody>
            {#each s.leaderboard as e (e.rank)}
              <tr>
                <td class="num muted">{e.rank}</td>
                <td><span class="dot" class:on={e.online} class:off={!e.online}></span> {e.name}</td>
                <td class="num">{e.score}</td>
                <td class="num">{e.kills}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </section>

  <section class="wrap">
    <div class="card">
      <h2>World</h2>
      <div class="kv">
        <div><span class="eyebrow">Landmarks</span><b>{s.landmarksDiscovered} / {s.landmarks} discovered</b></div>
        <div><span class="eyebrow">Safe zone</span><b>{s.safeZone.radius} m around Bryant Park</b></div>
        <div><span class="eyebrow">Server time</span><b>{s.serverTime.toFixed(1)} s</b></div>
      </div>
      <p class="tiny muted note">
        Progress lives in memory only — restarting the <code>nyc</code> container resets scores and profiles.
      </p>
    </div>
  </section>
{/if}

<style>
  .head { padding: 54px 0 0; }
  h1 { font-size: clamp(38px, 6vw, 60px); text-transform: uppercase; margin: 8px 0 10px; }
  .toggle { display: inline-flex; align-items: center; gap: 8px; }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-top: 26px;
  }
  .tile .k { display: block; }
  .tile .v {
    font-family: var(--head);
    font-size: 40px;
    font-weight: 700;
    line-height: 1.05;
    margin: 6px 0 4px;
  }
  .tile .v.small { font-size: 26px; text-transform: capitalize; }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
    gap: 12px;
    margin-top: 12px;
  }
  h2 { font-size: 19px; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 10px; }
  .empty { margin: 6px 0 0; }
  .empty a { color: var(--blue); }
  .down { display: flex; gap: 12px; align-items: start; }
  .down p { margin: 4px 0 0; }
  .kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .kv b { display: block; font-weight: 500; margin-top: 3px; }
  .note { margin: 14px 0 0; }
  code { font-size: 12px; }
</style>
