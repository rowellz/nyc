<script>
  import { cityClock, duration, weatherLabel, phaseOfDay } from '$lib/format.js';
  import { SPOTS } from '$lib/spots.js';

  let { data } = $props();
  const s = $derived(data.status);
</script>

<svelte:head>
  <title>New York — the world service, in SvelteKit</title>
  <meta name="description" content="A streaming 3D Manhattan: static client, REST API and the authoritative WebSocket game loop, all served by one SvelteKit process." />
</svelte:head>

<section class="shell hero">
  <p class="eyebrow">Reconstructed world service · v{s?.version ?? '0.2.8'} · protocol v{s?.protocol ?? 1}</p>
  <h1>A streaming 3D Manhattan,<br />served by one SvelteKit process.</h1>
  <p class="lede dim">
    The mirrored client, 3,697 world tiles, the REST endpoints and the authoritative
    WebSocket game loop are all handled here. The browser sees a single origin; the
    simulation runs in the same process that renders these pages.
  </p>
  <div class="actions">
    <a class="btn btn-primary" href="/play">Enter the city</a>
    <a class="btn" href="/spots">{SPOTS.length} viewpoints</a>
    <a class="btn" href="/status">Live status</a>
  </div>
</section>

<section class="shell stats">
  {#if s}
    <div class="card stat">
      <p class="eyebrow">Players online</p>
      <p class="stat-value" style="color: var(--amber)">{s.playersOnline}</p>
      <p class="faint small">{s.profilesSeen} profile{s.profilesSeen === 1 ? '' : 's'} since boot</p>
    </div>
    <div class="card stat">
      <p class="eyebrow">City time</p>
      <p class="stat-value">{cityClock(s.dayFraction)}</p>
      <p class="faint small">{phaseOfDay(s.dayFraction)} · {s.dayLength / 60}-minute day</p>
    </div>
    <div class="card stat">
      <p class="eyebrow">Weather</p>
      <p class="stat-value" style="color: var(--sky)">{weatherLabel(s.weather.condition)}</p>
      <p class="faint small">{s.weather.temperatureC}°C · wind {s.weather.wind.toFixed(1)} m/s</p>
    </div>
    <div class="card stat">
      <p class="eyebrow">Uptime</p>
      <p class="stat-value">{duration(s.uptimeSeconds)}</p>
      <p class="faint small">{s.landmarksDiscovered.length}/{s.landmarks} landmarks found</p>
    </div>
  {:else}
    <div class="card stat wide">
      <p class="eyebrow">Simulation</p>
      <p class="stat-value">not running</p>
      <p class="faint small">Start the app with <span class="mono">node server.js</span> so the world loop and the game socket come up.</p>
    </div>
  {/if}
</section>

<section class="shell how">
  <h2>What this process answers</h2>
  <div class="grid routes">
    <div class="card">
      <p class="mono route">GET /world/*</p>
      <p class="dim small">
        The client exactly as it was mirrored, plus its assets and the gzipped map tiles.
        Tiles go out as <span class="mono">application/gzip</span> with no
        <span class="mono">Content-Encoding</span> — the streamer worker sniffs the magic
        bytes itself, so letting the browser inflate them would break the decoder.
      </p>
    </div>
    <div class="card">
      <p class="mono route">WS /world/ws</p>
      <p class="dim small">
        JSON control messages and 34-byte binary player states. Area-of-interest snapshots
        at {s?.snapshotHz ?? 15}&nbsp;Hz within {s?.aoiRadius ?? 350}&nbsp;m, hitscan combat,
        a {s?.safeZone?.radius ?? 115}&nbsp;m safe zone over Bryant Park, and a 120&nbsp;s
        spawn protection.
      </p>
    </div>
    <div class="card">
      <p class="mono route">GET /world/api/admin/me</p>
      <p class="dim small">
        Asked once at boot: may this player noclip and teleport? Currently
        <strong>{s?.admin ? 'yes — ADMIN=1' : 'no'}</strong>.
      </p>
    </div>
    <div class="card">
      <p class="mono route">POST /world/api/telemetry</p>
      <p class="dim small">
        The client's boot and crash beacons. Answered with 204; set
        <span class="mono">VERBOSE=1</span> to watch how far a browser gets before it dies.
      </p>
    </div>
  </div>
</section>

<style>
  .hero { padding-block: 2rem 2.5rem; }
  .hero h1 { margin-block: 0.7rem 1rem; }
  .lede { max-width: 62ch; font-size: 1.02rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.4rem; }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.9rem;
    margin-bottom: 3rem;
  }
  .stat p { margin: 0; }
  .stat .stat-value { margin-block: 0.35rem 0.2rem; }
  .wide { grid-column: 1 / -1; }
  .small { font-size: 0.8rem; }

  .how h2 { margin-bottom: 1rem; }
  .routes { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .route { margin: 0 0 0.5rem; color: var(--amber); font-size: 0.85rem; }
  .routes p:last-child { margin: 0; }
</style>
