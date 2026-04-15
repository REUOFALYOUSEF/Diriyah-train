
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDTpXLffLrLP4o6Yn60ZMHh4pmUG5geEgU",
  authDomain: "diriyah-trains.firebaseapp.com",
  projectId: "diriyah-trains",
  databaseURL: "https://diriyah-trains-default-rtdb.firebaseio.com",
  storageBucket: "diriyah-trains.firebasestorage.app",
  messagingSenderId: "1046487985819",
  appId: "1:1046487985819:web:17550174e1ba6eebb3203e",
  measurementId: "G-9Z7YQET7BY"
};



// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);