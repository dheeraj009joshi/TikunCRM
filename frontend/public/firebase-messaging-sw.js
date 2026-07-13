/**
 * TikunCRM Firebase Messaging Service Worker
 * Version: 2.1 - Incoming call alerts when CRM tab is backgrounded
 * 
 * This service worker handles FCM push notifications.
 * Uses raw 'push' event listener for maximum browser compatibility.
 */

// SW Version for cache busting
const SW_VERSION = '2.1';

// Import Firebase scripts (required for getToken() to work)
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Firebase configuration (must match frontend config)
const firebaseConfig = {
  apiKey: "AIzaSyCubNWyMpGr9PwjjrMXHF0NKzmtcLpZ_oA",
  authDomain: "tikuncrm.firebaseapp.com",
  projectId: "tikuncrm",
  storageBucket: "tikuncrm.firebasestorage.app",
  messagingSenderId: "241604704783",
  appId: "1:241604704783:web:cc054d12805a9bcbfe417a"
};

// Initialize Firebase (required for token management)
firebase.initializeApp(firebaseConfig);
firebase.messaging();

// Track if we've shown a notification for this push to avoid duplicates
let lastPushTime = 0;
let lastPushTag = '';

// Raw push event listener - catches ALL push notifications
// This is more reliable than Firebase's onBackgroundMessage across browsers
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received:', event);
  
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[SW] Failed to parse push data:', e);
  }

  console.log('[SW] Push payload:', JSON.stringify(payload));

  const notification = payload.notification || {};
  const data = payload.data || {};
  const fcmOptions = payload.fcmOptions || {};
  
  const title = notification.title || data.title || 'TikunCRM';
  const body = notification.body || data.body || 'You have a new notification';
  const icon = notification.icon || data.icon || '/icon.svg';
  const tag = notification.tag || data.tag || 'tikuncrm-' + Date.now();
  const url = data.url || fcmOptions.link || '/notifications';
  const type = data.type || '';

  // Prevent duplicate notifications (same tag within 1 second)
  const now = Date.now();
  if (now - lastPushTime < 1000 && tag === lastPushTag) {
    console.log('[SW] Ignoring duplicate push');
    return;
  }
  lastPushTime = now;
  lastPushTag = tag;

  const isIncomingCall = type === 'incoming_call' || String(tag).startsWith('incoming-call');

  const options = {
    body: body,
    icon: icon,
    badge: '/icon.svg',
    tag: tag,
    data: {
      url: url,
      type: type,
      call_sid: data.call_sid || '',
      lead_id: data.lead_id || '',
    },
    requireInteraction: true,
    silent: false,
    renotify: isIncomingCall,
    vibrate: isIncomingCall ? [300, 100, 300, 100, 300] : [100, 50, 100],
  };

  if (isIncomingCall) {
    options.actions = [
      { action: 'open', title: 'Open CRM' },
    ];
  }

  console.log('[SW] Showing notification:', title, options);
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks - open the URL from notification data
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const data = event.notification.data || {};
  const url = data.url ||
              data.FCM_MSG?.data?.url ||
              '/notifications';
  const isIncomingCall = data.type === 'incoming_call';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({
            type: isIncomingCall ? 'INCOMING_CALL_CLICK' : 'NOTIFICATION_CLICK',
            url,
            call_sid: data.call_sid || '',
            lead_id: data.lead_id || '',
          });
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Service worker lifecycle
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activated version:', SW_VERSION);
  event.waitUntil(clients.claim());
});
