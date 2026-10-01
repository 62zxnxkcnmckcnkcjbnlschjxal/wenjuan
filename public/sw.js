// Service Worker —— 接收 Web Push 推送通知
self.addEventListener('push', function(event) {
  let data = { title: '问卷新提交', body: '有人填写了你的问卷！', url: '/' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {}
  const options = {
    body: data.body || '有人填写了你的问卷！',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200]
  };
  event.waitUntil(self.registration.showNotification(data.title || '问卷新提交', options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const c = clientList[i];
        if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
