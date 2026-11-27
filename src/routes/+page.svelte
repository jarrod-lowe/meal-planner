<script lang="ts">
  import { t } from '#lib/i18n/en.js';
</script>

<main>
  <h1>{t('app.title')}</h1>
  <p>{t('home.placeholder')}</p>
</main>

<style>
  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0 0 var(--space-4);
  }

  p {
    color: var(--color-text-muted);
    margin: 0;
  }
</style>
