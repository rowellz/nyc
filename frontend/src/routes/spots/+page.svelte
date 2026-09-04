<script lang="ts">
  import { SPOTS, SPOT_GROUPS, spotById, type Spot } from '$lib/spots';

  let time = $state('13:30');
  let weather = $state('clear');
  let quality = $state('medium');
  let nohud = $state(true);

  const TIMES = ['06:30', '09:00', '13:30', '17:45', '20:15', '23:00'];
  const WEATHER = ['clear', 'partly_cloudy', 'cloudy', 'fog', 'rain', 'heavy_rain', 'snow', 'thunder'];
  const QUALITY = ['low', 'medium', 'high'];

  function href(spot: Spot): string {
    const p = new URLSearchParams({ spot: spot.id, time, weather, q: quality });
    if (nohud) p.set('nohud', '1');
    return `/play?${p}`;
  }

  const compass = (deg: number) => {
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  };
</script>

<svelte:head><title>Viewpoints — New York</title></svelte:head>

<section class="wrap head">
  <p class="eyebrow">Screenshot mode</p>
  <h1>{SPOTS.length} viewpoints</h1>
  <p class="muted lede">
    Fixed cameras defined in the client's own source. Opening one skips the entry form and places
    you there directly — the fastest way to see whether the city is rendering.
  </p>

  <div class="controls card">
    <label>
      <span class="eyebrow">Time</span>
      <select bind:value={time}>
        {#each TIMES as t (t)}<option value={t}>{t}</option>{/each}
      </select>
    </label>
    <label>
      <span class="eyebrow">Weather</span>
      <select bind:value={weather}>
        {#each WEATHER as w (w)}<option value={w}>{w.replace(/_/g, ' ')}</option>{/each}
      </select>
    </label>
    <label>
      <span class="eyebrow">Quality</span>
      <select bind:value={quality}>
        {#each QUALITY as q (q)}<option value={q}>{q}</option>{/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={nohud} />
      <span>Hide HUD</span>
    </label>
  </div>
</section>

{#each SPOT_GROUPS as group (group.title)}
  <section class="wrap group">
    <h2>{group.title}</h2>
    <p class="muted tiny blurb">{group.blurb}</p>
    <div class="cards">
      {#each group.ids.map(spotById).filter(Boolean) as spot (spot!.id)}
        <a class="spot card" href={href(spot!)}>
          <div class="id">{spot!.id}</div>
          <div class="name">{spot!.name}</div>
          <div class="meta tiny muted">
            {spot!.lat.toFixed(4)}, {spot!.lon.toFixed(4)}
            <span class="sep">·</span> facing {compass(spot!.heading)}
            <span class="sep">·</span>
            {spot!.h >= 100 ? `${Math.round(spot!.h)} m up` : `${spot!.h} m`}
          </div>
        </a>
      {/each}
    </div>
  </section>
{/each}

<style>
  .head { padding: 54px 0 0; }
  h1 { font-size: clamp(38px, 6vw, 60px); text-transform: uppercase; margin: 8px 0 0; }
  .lede { max-width: 62ch; margin: 14px 0 0; }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: end;
    margin: 26px 0 0;
  }
  .controls label { display: flex; flex-direction: column; gap: 6px; }
  .controls .check { flex-direction: row; align-items: center; gap: 8px; font-size: 14px; }
  select {
    background: #11151d;
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 10px;
    font: inherit;
    font-size: 14px;
  }
  .group { margin-top: 46px; }
  .group h2 { font-size: 24px; text-transform: uppercase; letter-spacing: 0.06em; }
  .blurb { margin: 4px 0 16px; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
    gap: 12px;
  }
  .spot {
    display: block;
    text-decoration: none;
    transition: border-color 0.12s ease, transform 0.12s ease, background 0.12s ease;
  }
  .spot:hover {
    border-color: rgba(92, 178, 255, 0.55);
    background: rgba(92, 178, 255, 0.07);
    transform: translateY(-2px);
  }
  .id {
    font-family: var(--head);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--blue);
  }
  .name { font-size: 14px; margin: 5px 0 9px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; }
  .sep { color: var(--dimmer); }
</style>
