importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

// Notifications that arrive while HorCare is closed.
//
// The page hands this worker the Firebase config (FIREBASE_CONFIG) so the Firebase SDK can take over while the app is
// open. But the browser also starts this worker on its own, with no page, when a push arrives after the app — or the
// whole browser — was closed: then there is no config and no SDK. The plain `push` listener below covers exactly that
// case, so a notification is shown either way.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FIREBASE_CONFIG') {
    initFCM(event.data.config);
  }
});

let messaging = null;

const ICON = '/logo-icon.png';

function options(notification, data, fallbackTag) {
  return {
    body: (notification && notification.body) || '',
    icon: (notification && notification.icon) || ICON,
    badge: ICON,
    lang: 'th',
    // the same tag as the copy the SDK may show by itself: the browser keeps one, not two
    tag: (data && data.id) || fallbackTag || undefined,
    data: { url: (data && data.url) || '/' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };
}

function initFCM(config) {
  if (messaging) return;
  firebase.initializeApp(config);
  messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || 'HorCare', options(n, payload.data, payload.fcmMessageId));
  });
}

// Started by the browser for a push, with no page to give us the config: show the message ourselves.
self.addEventListener('push', (event) => {
  if (messaging) return;   // the SDK is running and handles it
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = {}; }
  const n = payload.notification || {};
  if (!n.title && !n.body) return;
  event.waitUntil(self.registration.showNotification(n.title || 'HorCare', options(n, payload.data, payload.fcmMessageId)));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // the app is open somewhere: bring it forward and tell it which screen the alert is about
          client.postMessage({ type: 'HORCARE_OPEN_URL', url });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
