import './style.css';
import { beginBoot, markGameStarted, reportStartupError, showSafeMode, stageBeacon } from './core/crashGuard';
import { isIOS, isMobileDevice } from './core/quality';

async function boot(): Promise<void> {
  if (beginBoot()) { showSafeMode(); return; }
  (window as any).__ready = false;
  let token: string | null = null;
  try { token = localStorage.getItem('nyc.token'); } catch { /* disabled storage */ }
  const params = new URLSearchParams(location.search);
  let registration;
  if (isIOS() || (isMobileDevice() && !params.has('spot') && !params.has('fly') && !token)) {
    registration = await (await import('./ui/mobileEntry')).waitForMobileEntry(!!token);
  }
  markGameStarted();
  const canvas = document.createElement('canvas');
  canvas.id = 'game'; canvas.tabIndex = 0;
  document.body.prepend(canvas);
  stageBeacon('game_import');
  if (isIOS()) (await import('./core/textureRelease')).installTextureRelease();
  const { main } = await import('./main');
  await main(registration);
}
void boot().catch(error => { reportStartupError('fatal', error); showSafeMode(); });
