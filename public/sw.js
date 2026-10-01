// Service Worker —— 接收 Web Push 推送通知
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  let data = { title: '问卷新提交', body: '有人填写了你的问卷！', url: '/' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    try { data.body = event.data.text(); } catch (e2) {}
  }
  const title = data.title || '问卷新提交';
  const options = {
    body: data.body || '有人填写了你的问卷！',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/', dateOfArrival: Date.now() },
    vibrate: [200, 100, 200],
    tag: 'survey-push',
    renotify: true
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const c = clientList[i];
        if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
