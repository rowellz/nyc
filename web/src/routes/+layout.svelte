<script>
  import '../app.css';
  import { page } from '$app/state';

  let { children } = $props();

  const nav = [
    { href: '/', label: 'Overview' },
    { href: '/play', label: 'Play' },
    { href: '/spots', label: 'Viewpoints' },
    { href: '/status', label: 'Status' },
  ];

  const current = $derived(page.url.pathname);
</script>

<div class="page">
  <header>
    <div class="shell bar">
      <a class="brand" href="/">
        <span class="mark" aria-hidden="true"></span>
        <span>New&nbsp;York <span class="faint mono">/world</span></span>
      </a>
      <nav>
        {#each nav as item (item.href)}
          <a href={item.href} class:active={item.href === '/' ? current === '/' : current.startsWith(item.href)}>
            {item.label}
          </a>
        {/each}
      </nav>
    </div>
  </header>

  <main>
    {@render children()}
  </main>

  <footer>
    <div class="shell">
      <p class="faint">
        SvelteKit port of the reconstructed <span class="mono">nyc</span> service — static client, REST API and the
        authoritative WebSocket game loop in one process. The game itself is served at
        <a href="/world/">/world/</a>.
      </p>
    </div>
  </footer>
</div>

<style>
  .page { display: flex; flex-direction: column; min-height: 100%; }
  main { flex: 1; padding-block: 2.5rem 4rem; }

  header {
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(8px);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .bar { display: flex; align-items: center; gap: 1.5rem; height: 56px; }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--ink);
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .brand:hover { text-decoration: none; }
  .mark {
    width: 10px;
    height: 18px;
    background: linear-gradient(180deg, var(--amber), #8a6410);
    border-radius: 2px;
    box-shadow: 14px 4px 0 -1px var(--sky);
  }

  nav { display: flex; gap: 1.1rem; margin-left: auto; font-size: 0.9rem; }
  nav a { color: var(--ink-dim); }
  nav a:hover { color: var(--ink); text-decoration: none; }
  nav a.active { color: var(--amber); }

  footer { border-top: 1px solid var(--line); padding-block: 1.4rem; font-size: 0.82rem; }
  footer p { margin: 0; }
</style>
