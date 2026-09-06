<script>
  import { compass } from '$lib/format.js';
  import { QUALITIES, TIMES, WEATHERS, worldUrl } from '$lib/launch.js';
  import { SPOTS } from '$lib/spots.js';
  import { lonLatToXZ } from '$lib/shared/constants.js';

  let query = $state('');
  let time = $state('');
  let weather = $state('');
  let q = $state('');
  let nohud = $state(true);

  const shown = $derived(
    SPOTS.filter((s) => `${s.id} ${s.name}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
</script>

<svelte:head><title>Viewpoints — New York</title></svelte:head>

<section class="shell">
  <p class="eyebrow">{SPOTS.length} named cameras</p>
  <h1 class="title">Viewpoints</h1>
  <p class="dim sub">
    The client ships a camera mode for screenshots: <span class="mono">?spot=&lt;id&gt;</span> flies to a fixed
    viewpoint and skips the entry form. These are its own coordinates, recovered from
    <span class="mono">core/spots.ts</span> — the fastest way to confirm the city renders.
    You are not stuck where it lands: on a desktop, drag with the left mouse button to look and fly
    with WASD; on a phone, this service adds two thumbsticks the client does not have.
  </p>

  <div class="card controls">
    <div class="field grow">
      <label for="filter">Filter</label>
      <input id="filter" type="search" placeholder="times square, aerial, bridge…" bind:value={query} />
    </div>
    <div class="field">
      <label for="time">Time of day</label>
      <select id="time" bind:value={time}>
        {#each TIMES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="weather">Weather</label>
      <select id="weather" bind:value={weather}>
        {#each WEATHERS as w (w.value)}<option value={w.value}>{w.label}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="quality">Quality</label>
      <select id="quality" bind:value={q}>
        {#each QUALITIES as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
      </select>
    </div>
    <label class="check"><input type="checkbox" bind:checked={nohud} /> Hide HUD</label>
  </div>

  <div class="spots">
    {#each shown as s (s.id)}
      {@const xz = lonLatToXZ(s.lon, s.lat)}
      <a class="card spot" href={worldUrl({ spot: s.id, time, weather, q, nohud })}>
        <p class="id mono">{s.id}</p>
        <p class="name">{s.name}</p>
        <p class="meta mono faint">
          {compass(s.heading)} {s.heading}° · pitch {s.pitch}° · {s.h} m
          <br />
          x {Math.round(xz.x)}, z {Math.round(xz.z)}
        </p>
      </a>
    {:else}
      <p class="dim">No viewpoint matches “{query}”.</p>
    {/each}
  </div>
</section>

<style>
  .title { font-size: 2rem; margin-block: 0.3rem 0.4rem; }
  .sub { max-width: 70ch; font-size: 0.9rem; margin-bottom: 1.3rem; }

  .controls { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: end; margin-bottom: 1.2rem; }
  .field { min-width: 150px; }
  .field.grow { flex: 1 1 220px; }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.45rem;
    font-size: 0.85rem;
    color: var(--ink-dim);
    white-space: nowrap;
  }
  .check input { accent-color: var(--amber); }

  .spots { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.8rem; }
  .spot { color: var(--ink); display: block; transition: border-color 0.12s ease; }
  .spot:hover { border-color: var(--amber); text-decoration: none; }
  .spot p { margin: 0; }
  .id { color: var(--amber); font-size: 0.78rem; }
  .name { font-size: 0.92rem; margin-block: 0.25rem 0.45rem; }
  .meta { font-size: 0.73rem; line-height: 1.5; }
</style>
