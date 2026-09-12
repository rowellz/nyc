import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../static/world-addons/touch-zoom.js', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body><canvas id="game"></canvas><div id="touch-controls"><button>Fire</button></div><a>Outside</a></body></html>',
  { runScripts: 'outside-only' });
const { window } = dom;
Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5 });
window.eval(source);

assert(window.document.head.textContent.includes('touch-action:none!important'));
const button = window.document.querySelector('button');
const outside = window.document.querySelector('a');

const gesture = new window.Event('gesturestart', { bubbles: true, cancelable: true });
button.dispatchEvent(gesture);
assert(gesture.defaultPrevented, 'Safari pinch gesture is cancelled on game controls');
const outsideGesture = new window.Event('gesturestart', { bubbles: true, cancelable: true });
outside.dispatchEvent(outsideGesture);
assert(!outsideGesture.defaultPrevented, 'touch behavior outside the game is preserved');

function tap(x, y) {
  const event = new window.Event('touchend', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
  button.dispatchEvent(event);
  return event;
}
assert(!tap(100, 100).defaultPrevented, 'the first game tap remains normal');
assert(tap(102, 101).defaultPrevented, 'a nearby second tap cannot zoom the page');

console.log('PASS iPhone game controls suppress Safari pinch and double-tap zoom');
