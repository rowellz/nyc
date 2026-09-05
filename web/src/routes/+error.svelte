<script>
  import { page } from '$app/state';
</script>

<section class="shell">
  <p class="eyebrow">{page.status}</p>
  <h1>{page.error?.message ?? 'Lost in the city'}</h1>
  <p class="dim">That street does not exist. <a href="/">Back to the overview</a>.</p>
</section>

<style>
  section { padding-block: 3rem; }
  h1 { margin-block: 0.4rem 0.8rem; }
</style>
