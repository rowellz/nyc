/**
 * The way back, on /world/safe.html.
 *
 * crashGuard.showSafeMode() sends iOS here with location.replace(), which drops
 * the query string, and the page's own button goes to `./?q=mobile&safe=1` — so
 * a viewpoint you were trying to reach turns into Bryant Park in play mode.
 * camera-boot.js stashes the search before that happens; this offers it back,
 * carrying the same `safe=1` that lets the next load through the guard.
 */
(function () {
  'use strict';

  var search = null;
  try { search = sessionStorage.getItem('nyc.web.camera-return'); } catch (e) { return; }
  if (!search) return;

  var params = new URLSearchParams(search);
  var spot = params.get('spot');
  if (!spot && !params.has('fly')) return;

  params.set('q', 'mobile');
  params.set('safe', '1');
  var href = './?' + params.toString();

  var panel = document.getElementById('safe-mode');
  if (!panel) return;

  // A link rather than a button: it is a navigation, and it keeps working even
  // if this page's own script never ran.
  var link = document.createElement('a');
  link.href = href;
  link.textContent = 'Retry at ' + (spot || 'that viewpoint');
  // The page styles `button`; match it so the two read as one pair of choices.
  link.style.cssText = 'display:inline-block;padding:14px 22px;border-radius:8px;'
    + 'background:#e8ecf1;color:#0b0e14;text-decoration:none;font:inherit;cursor:pointer';

  var note = document.createElement('p');
  note.textContent = 'Or go straight back to the viewpoint you were opening.';

  var existing = panel.querySelector('button');
  if (existing) panel.insertBefore(note, existing);
  else panel.appendChild(note);
  note.after(link);
})();
