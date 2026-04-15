// Shared Firebase config for static HTML pages (Auth + Realtime Database).
var firebaseConfig = {
    apiKey: "AIzaSyDTpXLffLrLP4o6Yn60ZMHh4pmUG5geEgU",
    authDomain: "diriyah-trains.firebaseapp.com",
    projectId: "diriyah-trains",
    storageBucket: "diriyah-trains.firebasestorage.app",
    messagingSenderId: "1046487985819",
    appId: "1:1046487985819:web:17550174e1ba6eebb3203e",
    // If your RTDB URL is different, update this field from Firebase Console.
    databaseURL: "https://diriyah-trains-default-rtdb.firebaseio.com"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

window.auth = firebase.auth();
window.rtdb = firebase.database();
window.fsdb = (typeof firebase.firestore === 'function') ? firebase.firestore() : null;

// Bootstrap admin emails (lowercase). Update this list with your admin accounts.
window.ADMIN_EMAILS = [
    'thanwa-admin-email@gmail.com'
];

// Code required when selecting Admin during registration.
window.ADMIN_SIGNUP_CODE = '123456';

// Code required when selecting Staff during registration.
window.STAFF_SIGNUP_CODE = 'staff2026';

// Optional: local profile image path for passenger card.
// Supported examples: 'profile.jpg', 'assets/profile.png'
window.PASSENGER_PROFILE_IMAGE = 'profile.jpg';
