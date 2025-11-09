// Copy this file to `assets/js/firebase-config.js` and fill in your Firebase project values.
// This file is intentionally ignored by git (.gitignore) because it contains project-specific values.

// Example usage:
// window.FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project-id",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef012345",
//   measurementId: "G-XXXXXXX" // optional
// };

// Minimal template (replace the placeholders below):
window.FIREBASE_CONFIG = {
  apiKey: "<YOUR_API_KEY>",
  authDomain: "<YOUR_PROJECT>.firebaseapp.com",
  projectId: "<YOUR_PROJECT_ID>",
  storageBucket: "<YOUR_PROJECT>.appspot.com",
  messagingSenderId: "<YOUR_SENDER_ID>",
  appId: "<YOUR_APP_ID>",
  measurementId: "<YOUR_MEASUREMENT_ID>"
};

// After creating the file, reload the page. The site will automatically call firebase.initializeApp(window.FIREBASE_CONFIG)
// and authentication (email/password) should work. If you still see the error
// "No Firebase App '[DEFAULT]' has been created", ensure the file is served at /assets/js/firebase-config.js
// and that the values are correct. If hosting locally, the file must be inside the project and accessible by the dev server.
