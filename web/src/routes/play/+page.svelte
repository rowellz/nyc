<script>
  import { QUALITIES, TIMES, WEATHERS, worldUrl } from '$lib/launch.js';
  import { SPOTS } from '$lib/spots.js';

  let q = $state('');
  let time = $state('');
  let weather = $state('');
  let spot = $state('');
  let nohud = $state(false);
  let debug = $state(false);

  const href = $derived(worldUrl({ spot, time, weather, q, nohud, debug }));

  const controls = [
    ['W A S D', 'walk'],
    ['Shift', 'sprint'],
    ['Space', 'jump'],
    ['Mouse', 'look — click to capture the pointer'],
    ['Left click', 'fire'],
    ['R', 'reload'],
    ['1–4', 'switch weapon'],
    ['F', 'enter or leave a vehicle'],
    ['Touch', 'left stick walks, right stick looks, buttons on the right'],
  ];
</script>

<svelte:head><title>Play — New York</title></svelte:head>

<section class="shell">
  <p class="eyebrow">Launcher</p>
  <h1 class="title">Enter the city</h1>
  <p class="dim sub">
    The city spawns you in Bryant Park with a pistol, 120&nbsp;s of spawn protection and a
    115&nbsp;m safe zone around the park. Your typed name is never your public one — the server
    hands out a handle like <span class="mono">amber-fox-42</span> and drops what you submitted.
    Cold starts stream a lot of geometry, so give it a moment.
  </p>

  <div class="card form">
    <div class="fields">
      <div class="field">
        <label for="quality">Quality</label>
        <select id="quality" bind:value={q}>
          {#each QUALITIES as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
        </select>
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
        <label for="spot">Start at</label>
        <select id="spot" bind:value={spot}>
          <option value="">Bryant Park spawn (play)</option>
          {#each SPOTS as s (s.id)}<option value={s.id}>{s.id} — camera</option>{/each}
        </select>
      </div>
    </div>

    <div class="toggles">
      <label class="check"><input type="checkbox" bind:checked={nohud} /> Hide HUD</label>
      <label class="check"><input type="checkbox" bind:checked={debug} /> Debug overlay</label>
    </div>

    {#if spot}
      <p class="note faint">
        Picking a viewpoint puts the client in screenshot mode: it flies the camera there and
        skips the entry form, so you watch rather than play. On a phone both thumbsticks still
        work there — left flies the camera, right aims it.
      </p>
    {/if}

    <div class="go">
      <a class="btn btn-primary" {href}>Enter the city</a>
      <code class="target mono faint">{href}</code>
    </div>
  </div>

  <div class="card keys">
    <h2>Controls</h2>
    <dl>
      {#each controls as [key, what] (key)}
        <div><dt class="mono">{key}</dt><dd class="dim">{what}</dd></div>
      {/each}
    </dl>
    <p class="faint note">
      In the browser console, <span class="mono">__game.teleport(x, z)</span> moves you anywhere in
      the city and <span class="mono">__stats()</span> reports renderer counters. On phones this
      service adds the camera stick the mirrored client lacks — turn it off with
      <span class="mono">?lookstick=0</span>, or retune it with
      <span class="mono">?looksens=480</span>. The river is matte here — no sky, skyline
      or sun reflection; <span class="mono">?water=1</span> restores the original.
    </p>
  </div>
</section>

<style>
  .title { font-size: 2rem; margin-block: 0.3rem 0.4rem; }
  .sub { max-width: 68ch; font-size: 0.9rem; margin-bottom: 1.3rem; }

  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.8rem; }
  .toggles { display: flex; gap: 1.2rem; margin-top: 0.9rem; }
  .check { display: flex; align-items: center; gap: 0.4rem; margin: 0; font-size: 0.85rem; color: var(--ink-dim); }
  .check input { accent-color: var(--amber); }

  .go { display: flex; flex-wrap: wrap; align-items: center; gap: 0.8rem; margin-top: 1.2rem; }
  .target { font-size: 0.78rem; word-break: break-all; }
  .note { font-size: 0.78rem; margin: 0.9rem 0 0; }

  .keys { margin-top: 0.9rem; }
  .keys h2 { font-size: 0.95rem; margin-bottom: 0.8rem; }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0.35rem 1.2rem; margin: 0; }
  dl > div { display: flex; gap: 0.6rem; font-size: 0.85rem; }
  dt { color: var(--amber); min-width: 5.5rem; font-size: 0.78rem; padding-top: 0.1rem; }
  dd { margin: 0; }
</style>
