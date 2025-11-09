/*
  This file exposes your Firebase config as window.FIREBASE_CONFIG so that
  the legacy compat loader in assets/js/main.js can call firebase.initializeApp(window.FIREBASE_CONFIG).

  IMPORTANT: This file contains sensitive keys for your Firebase project.
  It's included in the repository for local development convenience only when you add it.
  The repo's .gitignore already excludes /assets/js/firebase-config.js by default.
*/

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCfqhKmMGWLhbG5yXfMuLJRyoXG_weHihU",
  authDomain: "sand-study-5c84b.firebaseapp.com",
  projectId: "sand-study-5c84b",
  storageBucket: "sand-study-5c84b.firebasestorage.app",
  messagingSenderId: "142543528127",
  appId: "1:142543528127:web:fab3f88e791feb010fe60a",
  measurementId: "G-VFDML50CWV"
};
// Note: main.js will dynamically load the compat SDKs and call firebase.initializeApp(window.FIREBASE_CONFIG)