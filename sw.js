// ═══════════════════════════════════════════════
// SERVICE WORKER — Diet Plan App
// Background notifications + offline support
// ═══════════════════════════════════════════════

const CACHE_NAME = 'diet-plan-v1';
const STORAGE_KEY = 'dietPlan_v1';
const PROFILE_KEY = 'dietPlan_profile';

// Task schedule
const TASK_TIMES = [
  { id:'t1',  h:6,  m:0,  emoji:'💧', name:'Morning Hydration',   desc:'1 glass water lene ka waqt!' },
  { id:'t2',  h:6,  m:30, emoji:'🎧', name:'Morning Club Join',    desc:'Wellness session join karein!' },
  { id:'t3',  h:7,  m:0,  emoji:'🌿', name:'Afresh (Morning)',     desc:'1 scoop Afresh lene ka time!' },
  { id:'t4',  h:8,  m:0,  emoji:'🥤', name:'Breakfast Time',       desc:'Formula-1 + ShakeMate banana ka waqt!' },
  { id:'t5',  h:10, m:0,  emoji:'🍌', name:'Mid-Morning Snack',    desc:'2 Banana ya Chiku khayein!' },
  { id:'t6',  h:12, m:0,  emoji:'🍛', name:'Lunch Time',           desc:'4 Roti + Sabzi + Salad + Curd!' },
  { id:'t7',  h:13, m:0,  emoji:'🌿', name:'Afresh (Afternoon)',   desc:'Dopahar ki Afresh lena na bhulen!' },
  { id:'t8',  h:16, m:0,  emoji:'☕', name:'Evening Snack',        desc:'Chai + healthy snacks ka waqt!' },
  { id:'t9',  h:17, m:0,  emoji:'🌱', name:'Evening Nutrition',    desc:'Sprouts + dry fruits khayein!' },
  { id:'t10', h:20, m:0,  emoji:'🍽', name:'Dinner Time',          desc:'3 Roti + Sabzi ka waqt hai!' },
];

// ── Install: cache the app shell ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(['./index.html', './sw.js'])
    ).catch(() => {})
  );
});

// ── Activate ──
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      )
    ])
  );
  // Schedule notifications right away
  scheduleNotificationsFromSW();
});

// ── Fetch: serve from cache when offline ──
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // Return offline fallback if needed
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ── Message from page: reschedule ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    scheduleNotificationsFromSW();
  }
  if (event.data && event.data.type === 'TEST_NOTIFICATION') {
    const name = event.data.name || 'Aap';
    self.registration.showNotification('🧪 Test Notification', {
      body: name + ' ji — Notifications bilkul sahi kaam kar rahi hain! ✅',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'test-notif',
      vibrate: [200, 100, 200]
    });
  }
});

// ── Notification click: open app ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('./');
    })
  );
});

// ── Core: schedule today's push notifications via setTimeout ──
let scheduledTimers = [];

function scheduleNotificationsFromSW() {
  scheduledTimers.forEach(t => clearTimeout(t));
  scheduledTimers = [];

  const now = new Date();

  TASK_TIMES.forEach(task => {
    // Get advance from IndexedDB or default 5 min
    getProfileFromIDB().then(profile => {
      const advance = profile ? (parseInt(profile.advance) || 0) : 5;
      const name    = profile ? profile.name : '';

      const target = new Date();
      // Handle time calculation properly: subtract advance minutes
      const totalMinutes = task.h * 60 + task.m - advance;
      const targetHours = Math.floor(totalMinutes / 60);
      const targetMins = totalMinutes % 60;
      target.setHours(targetHours, targetMins, 0, 0);
      
      if (target <= now) return;

      const delay = target - now;

      const timer = setTimeout(() => {
        // Check if task already done via IDB
        getDataFromIDB().then(allData => {
          const today = new Date().toISOString().split('T')[0];
          const dayData = (allData && allData[today]) ? allData[today] : { tasks: {} };
          if (dayData.tasks && dayData.tasks[task.id]) return; // already done

          const advStr = advance > 0 ? ` (${advance} min mein)` : '';
          const nameStr = name ? name + ' ji — ' : '';

          self.registration.showNotification(`${task.emoji} ${task.name}${advStr}`, {
            body: nameStr + task.desc,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: 'task-' + task.id,
            vibrate: [150, 50, 150],
            requireInteraction: false,
            data: { taskId: task.id }
          });

          // Reschedule tomorrow
          const tomorrow = new Date(target);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowDelay = tomorrow - new Date();
          const t2 = setTimeout(() => scheduleNotificationsFromSW(), tomorrowDelay);
          scheduledTimers.push(t2);
        });
      }, delay);

      scheduledTimers.push(timer);
    });
  });
}

// ── IndexedDB helpers (SW can't use localStorage) ──
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dietPlanDB', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function getFromIDB(key) {
  return openIDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  }));
}

function getDataFromIDB()    { return getFromIDB(STORAGE_KEY); }
function getProfileFromIDB() { return getFromIDB(PROFILE_KEY); }
