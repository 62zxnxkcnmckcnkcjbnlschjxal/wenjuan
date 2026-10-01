// Service Worker
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', function(event) {
  let title = '测试通知';
  let body = '如果你看到这条，说明推送通了！';
  let url = '/';
  try {
    if (event.data) {
      const d = event.data.json();
      title = d.title || title;
      body = d.body || body;
      url = d.url || url;
    }
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icons/icon-192.png',
      data: { url: url }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(list) {
      for (let c of list) { if (c.url.indexOf(url) !== -1) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});
