<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { spotById } from '$lib/spots';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let failure = $state<string | null>(null);
  const spot = $derived(spotById(page.url.searchParams.get('spot') ?? ''));

  /**
   * Stop the render loop. A full city can saturate the main thread, which would
   * otherwise starve SvelteKit's client-side navigation; halting the loop first
   * makes leaving immediate. Safe to call more than once.
   */
  function stopGameLoop() {
    const w = window as unknown as { __loop?: { stop(): void } };
    try { w.__loop?.stop(); } catch { /* not started, or already stopped */ }
  }

  /**
   * The 3D client is the original compiled bundle: an ES module that expects the
   * #ui / #loading / #fatal elements below to already exist, then prepends its own
   * <canvas> to <body>. Importing it here runs the real boot path (crash guard,
   * quality detection, physics, tile streaming) inside this route.
   *
   * Its URL params come straight from location.search, so /play?spot=… behaves
   * exactly as /world/?spot=… does.
   */
  onMount(() => {
    let disposed = false;

    (async () => {
      try {
        await import(/* @vite-ignore */ data.bundle.module);
      } catch (e) {
        if (!disposed) failure = e instanceof Error ? e.message : String(e);
      }
    })();

    return () => {
      disposed = true;
      // The bundle owns DOM and a rAF loop outside Svelte's control; wind both down
      // so leaving the route does not leave a WebGL context running.
      stopGameLoop();
      document.getElementById('game')?.remove();
      delete (window as unknown as { __game?: unknown }).__game;
    };
  });
</script>

<svelte:head>
  <title>{spot ? `${spot.name} — New York` : 'New York'}</title>
  {#each data.bundle.css as href (href)}
    <link rel="stylesheet" crossorigin {href} />
  {/each}
  {#each data.bundle.modulepreload as href (href)}
    <link rel="modulepreload" crossorigin {href} />
  {/each}
</svelte:head>

<!-- The exact structure the client's index.html provides; the bundle looks these up by id. -->
<div id="ui"></div>
<div id="loading">
  <div class="title">Loading New York…</div>
  <div class="bar"><i id="loading-bar"></i></div>
  <div class="sub" id="loading-sub">starting</div>
</div>
<div id="fatal"></div>

<a class="leave" href="/" title="Leave the city" onclick={stopGameLoop}>
  <span aria-hidden="true">←</span>
  <span class="label">Leave</span>
</a>

{#if spot}
  <div class="spotname">{spot.name}</div>
{/if}

{#if failure}
  <div class="boom">
    <h1>The client failed to load</h1>
    <p>{failure}</p>
    <a class="btn" href="/">Back to safety</a>
  </div>
{/if}

<style>
  /* The bundle's own stylesheet owns #ui, #loading and #fatal; only the overlay
     chrome this route adds is styled here. */
  .leave {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 13px;
    border-radius: 7px;
    background: rgba(9, 11, 15, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #f4f6f8;
    font-family: var(--head);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-decoration: none;
    opacity: 0.32;
    backdrop-filter: blur(6px);
    transition: opacity 0.15s ease;
  }
  .leave:hover { opacity: 1; }

  .spotname {
    position: fixed;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(9, 11, 15, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(244, 246, 248, 0.72);
    font-size: 12px;
    pointer-events: none;
    backdrop-filter: blur(6px);
  }

  .boom {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 30px;
    text-align: center;
    background: #0b0e14;
  }
  .boom h1 { font-size: 30px; text-transform: uppercase; }
  .boom p { max-width: 60ch; color: var(--dim); font-size: 14px; margin: 0; }
</style>
