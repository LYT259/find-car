// Find Car — Service Worker
// 用途：接收「设备上线」Web Push（后端 functions/report.js 在设备「旧不在线 → 新在线」跳变时，
// 向全部 pushsub: 订阅发无负载 tickle），由本 SW 的 push 事件弹出系统通知；
// 点击通知时聚焦已打开的同源页面，没有则新开首页。
// 前端注册方式：navigator.serviceWorker.register('/sw.js') + PushManager.subscribe。

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Find Donkey Car', {
      body: '有设备上线了 / A device came online',
      icon: '/favicon.png',
      badge: '/favicon.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    }),
  );
});
