<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} — New York</title></svelte:head>

<section class="wrap">
  <p class="eyebrow">Error {page.status}</p>
  <h1>{page.status === 404 ? 'No such street' : 'Something broke'}</h1>
  <p class="muted lede">{page.error?.message ?? 'Unknown error.'}</p>
  <a class="btn" href="/">Back to the city</a>
</section>

<style>
  section { padding: 96px 0; }
  h1 { font-size: clamp(38px, 7vw, 68px); text-transform: uppercase; margin: 8px 0 14px; }
  .lede { max-width: 60ch; margin: 0 0 26px; }
</style>
