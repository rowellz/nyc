import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
import { NameEntry } from './nameEntry';
import { injectStyles } from './styles';
import { isIOS } from '@/core/quality';
import { setNameFormUp, stageBeacon } from '@/core/crashGuard';

/** Keep keyboard entry entirely outside renderer, physics, workers and world startup. */
export function waitForMobileEntry(returning = false): Promise<{ name: string; email: string; newsletter: boolean } | undefined> {
  injectStyles(!isIOS());
  const root = document.createElement('div');
  root.id = 'nyc';
  root.style.background = '#0b0e14';
  if (isIOS()) {
    root.classList.add('static-entry');
    root.style.background = `#0b0e14 url("${__launchBasePath('/assets/entry-bg.jpg')}") center / cover no-repeat`;
    const style = document.createElement('style');
    style.textContent = '#nyc.static-entry, #nyc.static-entry * { animation:none!important; transition:none!important; backdrop-filter:none!important; -webkit-backdrop-filter:none!important; filter:none!important; } #nyc.static-entry .intro { touch-action:pan-y; }';
    root.append(style);
  }
  document.getElementById('ui')!.appendChild(root);
  const loading = document.getElementById('loading')!;
  loading.hidden = true;
  return new Promise(resolve => {
    if (returning) {
      const panel = document.createElement('main'); panel.className = 'screen ia intro';
      const title = document.createElement('h1'); title.textContent = 'New York'; title.className = 'title head';
      const form = document.createElement('form');
      const button = document.createElement('button'); button.type = 'submit'; button.className = 'btn'; button.textContent = 'Enter the city';
      form.append(button); panel.append(title, form); root.append(panel);
      setNameFormUp(true); stageBeacon('form_shown', 'returning player');
      form.onsubmit = e => {
        e.preventDefault(); stageBeacon('submit'); setNameFormUp(false); root.remove(); loading.hidden = false;
        setTimeout(() => resolve(undefined), 500);
      };
      return;
    }
    const entry = new NameEntry(root, (name, email, newsletter) => {
      (document.activeElement as HTMLElement | null)?.blur();
      root.remove();
      loading.hidden = false;
      // Let the iOS keyboard close before allocating the first drawing buffer.
      setTimeout(() => resolve({ name, email, newsletter }), 500);
    });
    entry.show();
  });
}
