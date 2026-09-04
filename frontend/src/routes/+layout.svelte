<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';

  let { children } = $props();

  const NAV = [
    { href: '/', label: 'Home' },
    { href: '/spots', label: 'Spots' },
    { href: '/status', label: 'Status' },
  ];

  // The game route is full-bleed: it owns the whole viewport, so no site chrome.
  const bare = $derived(page.url.pathname.startsWith('/play'));
</script>

<svelte:head>
  <link rel="stylesheet" href="/world/assets/fonts/fonts.css" />
</svelte:head>

{#if bare}
  {@render children()}
{:else}
  <header>
    <div class="wrap bar">
      <a class="brand" href="/">
        <span class="mark" aria-hidden="true"></span>
        New York
      </a>
      <nav>
        {#each NAV as item (item.href)}
          <a
            href={item.href}
            class:active={item.href === '/'
              ? page.url.pathname === '/'
              : page.url.pathname.startsWith(item.href)}>{item.label}</a>
        {/each}
        <a class="play" href="/play">Play</a>
      </nav>
    </div>
  </header>

  <main>{@render children()}</main>

  <footer>
    <div class="wrap tiny muted">
      Reverse-engineered from <code>somethingbig.ai/world</code> and rebuilt for local use.
      The 3D client is the original compiled bundle; the server and this frontend are reimplementations.
    </div>
  </footer>
{/if}

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(11, 14, 20, 0.86);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 58px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--head);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-decoration: none;
  }
  .mark {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: linear-gradient(160deg, #e8ecf1 0%, #8a94a3 100%);
  }
  nav { display: flex; align-items: center; gap: 20px; }
  nav a {
    font-size: 14px;
    text-decoration: none;
    color: var(--dim);
    transition: color 0.12s ease;
  }
  nav a:hover, nav a.active { color: var(--fg); }
  nav a.play {
    padding: 7px 16px;
    border-radius: 6px;
    background: var(--fg);
    color: #0b0e14;
    font-family: var(--head);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  main { min-height: calc(100vh - 58px - 92px); }
  footer { border-top: 1px solid var(--line); padding: 26px 0; margin-top: 60px; }
  code { font-size: 11px; color: var(--dim); }
</style>
