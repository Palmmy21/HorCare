importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

// Injected by vite-plugin-pwa at build time via injectManifest strategy, but
// we also need this self-contained for the FCM token flow (separate registration).
// Values are read from the SW scope's script URL query params set by useFCMToken.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FIREBASE_CONFIG') {
    initFCM(event.data.config);
  }
});

let messaging = null;

function initFCM(config) {
  if (messaging) return;
  firebase.initializeApp(config);
  messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const { title, body, icon, data } = payload.notification || {};
    const notifIcon = icon || '/logo-icon.png';
    const opts = {
      body: body || '',
      icon: notifIcon,
      badge: '/logo-icon.png',
      lang: 'th',
      data: data || {},
      requireInteraction: false,
    };
    self.registration.showNotification(title || 'HorCare', opts);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
