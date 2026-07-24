/**
 * Web Worker that sends periodic keep-alive pings to the main thread.
 * Unlike setInterval in a background tab, Web Workers are NOT throttled
 * by the browser — ensuring Twilio's signaling WebSocket stays alive.
 */

let intervalId = null;
const INTERVAL_MS = 12000; // 12 seconds

self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'start') {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage({ type: 'keepalive' });
    }, INTERVAL_MS);
    self.postMessage({ type: 'started' });
  }

  if (type === 'stop') {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    self.postMessage({ type: 'stopped' });
  }
});
