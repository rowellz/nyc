<script lang="ts">
  import { SPOTS } from '$lib/spots';
  import { clockFromDayFraction, phaseFromDayFraction, prettyCondition } from '$lib/format';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const s = $derived(data.status);

  const FACTS = [
    { n: '3,697', l: 'streamed map tiles' },
    { n: '208k', l: 'buildings' },
    { n: '104k', l: 'road segments' },
    { n: '674k', l: 'trees and props' },
  ];
</script>

<svelte:head>
  <title>New York — a city that never ends</title>
  <meta name="description" content="A streaming 3D Manhattan, running locally in Docker." />
</svelte:head>

<section class="hero">
  <div class="wrap">
    <p class="eyebrow">Running locally in Docker</p>
    <h1>New York</h1>
    <p class="sub">a city that never ends</p>

    <p class="lede muted">
      Two hundred thousand buildings of Manhattan, streamed a tile at a time and simulated with
      real physics. Reverse engineered from a public build and rebuilt to run entirely on your
      own machine.
    </p>

    <div class="cta">
      <a class="btn" href="/play">Enter the city</a>
      <a class="btn ghost" href="/spots">Browse viewpoints</a>
    </div>

    {#if s}
      <div class="live">
        <span class="dot on"></span>
        <strong>{s.playersOnline}</strong>
        {s.playersOnline === 1 ? 'player' : 'players'} online
        <span class="sep">·</span>
        {clockFromDayFraction(s.dayFraction)} in-game ({phaseFromDayFraction(s.dayFraction)})
        <span class="sep">·</span>
        {prettyCondition(s.weather.condition)}, {Math.round(s.weather.temperatureC)}°C
        <span class="sep">·</span>
        v{s.version}
      </div>
    {:else}
      <div class="live down">
        <span class="dot off"></span>
        Game service unreachable — is the <code>nyc</code> container running?
      </div>
    {/if}
  </div>
</section>

<section class="wrap">
  <div class="facts">
    {#each FACTS as f (f.l)}
      <div class="fact">
        <div class="n">{f.n}</div>
        <div class="l muted tiny">{f.l}</div>
      </div>
    {/each}
  </div>
</section>

<section class="wrap panels">
  <div class="card">
    <h2>{SPOTS.length} camera viewpoints</h2>
    <p class="muted">
      The client ships a screenshot mode with fixed viewpoints — Times Square from 7th Avenue,
      the Flatiron from 24th, Midtown from 260 metres up. Each one skips the entry form and flies
      straight there.
    </p>
    <a class="link" href="/spots">Browse them →</a>
  </div>

  <div class="card">
    <h2>Live world state</h2>
    <p class="muted">
      The server owns the clock, the weather and the scoreboard. A two-hour day cycle runs
      continuously, and the leaderboard tracks whoever is in the city right now.
    </p>
    <a class="link" href="/status">See the status →</a>
  </div>

  <div class="card">
    <h2>How it was rebuilt</h2>
    <p class="muted">
      The client was recovered from published source maps — 62,887 lines of the original
      TypeScript. The server was never shipped to browsers, so it was rewritten against the
      wire protocol the client documents.
    </p>
    <span class="tiny muted">See <code>README.md</code> in the repository.</span>
  </div>
</section>

<style>
  .hero {
    padding: 92px 0 64px;
    background:
      radial-gradient(1100px 420px at 50% -8%, rgba(92, 178, 255, 0.16), transparent 70%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 55%);
    border-bottom: 1px solid var(--line);
  }
  h1 {
    font-size: clamp(64px, 13vw, 148px);
    line-height: 0.88;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 10px 0 0;
  }
  .sub {
    font-family: var(--head);
    font-size: clamp(15px, 2.4vw, 21px);
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--dim);
    margin: 12px 0 0;
  }
  .lede { max-width: 60ch; margin: 26px 0 0; font-size: 16px; }
  .cta { display: flex; flex-wrap: wrap; gap: 12px; margin: 30px 0 0; }
  .live {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 30px 0 0;
    font-size: 13px;
    color: var(--dim);
  }
  .live strong { color: var(--fg); }
  .live.down { color: var(--dimmer); }
  .sep { color: var(--dimmer); }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    margin: 44px 0 0;
  }
  .fact {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px;
    background: var(--panel);
  }
  .fact .n {
    font-family: var(--head);
    font-size: 34px;
    font-weight: 700;
    line-height: 1;
  }
  .fact .l { margin-top: 6px; letter-spacing: 0.1em; text-transform: uppercase; }

  .panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
    margin-top: 14px;
  }
  .panels h2 { font-size: 21px; margin-bottom: 8px; }
  .panels p { font-size: 14px; margin: 0 0 12px; }
  .link { font-size: 14px; text-decoration: none; color: var(--blue); }
  .link:hover { text-decoration: underline; }
  code { font-size: 12px; }
</style>
