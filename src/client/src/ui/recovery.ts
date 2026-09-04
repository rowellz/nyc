import type { InputManager } from '@/core/input';
import type { NetClientImpl } from '@/core/net';

/** Available before asynchronous scene modules finish, including on a stalled startup. */
export function showLoadingRecovery(): void {
  const loading = document.getElementById('loading');
  const sub = document.getElementById('loading-sub');
  if (sub) sub.textContent = 'Still loading the city… You can wait or reload.';
  if (!loading || document.getElementById('loading-reload')) return;
  // main's progress updates replace loading-sub each frame; keep recovery status independent.
  const status = document.createElement('div');
  status.id = 'loading-status'; status.setAttribute('role', 'status');
  status.textContent = 'Still loading the city… You can wait or reload.';
  loading.appendChild(status);
  const reload = document.createElement('button');
  reload.id = 'loading-reload'; reload.type = 'button'; reload.textContent = 'Reload';
  reload.style.cssText = 'margin-top:16px;padding:10px 20px;pointer-events:auto;cursor:pointer';
  reload.onclick = () => location.reload();
  loading.appendChild(reload);
}

/** Independent of the render loop: a kick must remain readable even during module startup. */
export class ConnectionNotice {
  private el = document.createElement('div');
  private text = document.createElement('div');
  private reload = document.createElement('button');
  private timer: ReturnType<typeof setInterval>;
  constructor(net: NetClientImpl, input: InputManager, screenshot: () => boolean) {
    this.el.id = 'disconnected'; this.el.setAttribute('role', 'alert'); this.el.hidden = true;
    this.el.style.cssText = 'position:fixed;top:68px;left:50%;transform:translateX(-50%);z-index:10000;background:#241820f5;color:white;padding:14px 20px;border:1px solid #eaa;border-radius:8px;text-align:center;pointer-events:auto;max-width:90vw;font:16px system-ui';
    this.reload.textContent = 'Reload'; this.reload.type = 'button';
    this.reload.onclick = () => net.admissionRefusal ? net.retryAdmission() : location.reload();
    this.el.append(this.text, this.reload); document.body.appendChild(this.el);
    this.timer = setInterval(() => {
      const interrupted = !screenshot() && net.interrupted;
      this.el.hidden = !interrupted && !net.mustUpdate;
      input.blocked = interrupted;
      if (interrupted) { input.releaseAll(); input.releaseLock(); }
      if (net.mustUpdate) {
        this.text.textContent = 'Updated: click to reload';
        this.reload.textContent = 'Updated: click to reload';
        this.reload.hidden = false; this.reload.disabled = false;
        return;
      }
      if (net.admissionRefusal) {
        this.text.textContent = net.admissionRefusal.reason;
        const seconds = Math.max(0, Math.ceil((net.admissionRefusal.retryAt - Date.now()) / 1000));
        this.reload.textContent = seconds ? `Try again in ${seconds}s` : 'Try again';
        this.reload.disabled = seconds > 0;
        this.reload.hidden = false;
        return;
      }
      this.reload.textContent = 'Reload'; this.reload.disabled = false;
      // Explicit kicks are terminal: reconnecting the same token would kick the new session.
      this.text.textContent = net.kickReason ? `Disconnected — ${net.kickReason}` : net.reloadRequired
        ? 'Disconnected — reconnecting failed after 3 minutes.' : net.updating
        ? 'The city is updating — back in a moment' : 'Reconnecting… Your last position will be restored.';
      this.reload.hidden = !net.reloadRequired;
    }, 100);
  }
  dispose(): void { clearInterval(this.timer); this.el.remove(); }
}
