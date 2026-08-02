/**
 * Web Worker that pings the main thread so CRM WebSocket keepalives
 * continue while the browser throttles background-tab timers.
 */

let intervalId = null;
const INTERVAL_MS = 25000; // 25 seconds

self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'start') {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage({ type: 'ping' });
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
