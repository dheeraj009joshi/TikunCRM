// importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
// importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// firebase.initializeApp({
//   apiKey: "AIzaSyCubNWyMpGr9PwjjrMXHF0NKzmtcLpZ_oA",
//   authDomain: "tikuncrm.firebaseapp.com",
//   projectId: "tikuncrm",
//   messagingSenderId: "241604704783",
//   appId: "1:241604704783:web:cc054d12805a9bcbfe417a"
// });

// const messaging = firebase.messaging();

// messaging.onBackgroundMessage((payload) => {
//   self.registration.showNotification(
//     payload.notification.title,
//     {
//       body: payload.notification.body,
//       icon: "https://firebase.google.com/favicon.ico"
//     }
//   );
// });
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCubNWyMpGr9PwjjrMXHF0NKzmtcLpZ_oA",
  authDomain: "tikuncrm.firebaseapp.com",
  projectId: "tikuncrm",
  messagingSenderId: "241604704783",
  appId: "1:241604704783:web:cc054d12805a9bcbfe417a"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(
    payload.notification.title,
    {
      body: payload.notification.body,
      icon: "https://firebase.google.com/favicon.ico"
    }
  );
});
