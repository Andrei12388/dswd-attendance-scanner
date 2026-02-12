import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBHTgYDMfgNdVdXZxvXSWJ03hMkjxxfOLg",
  authDomain: "dswd-attendance.firebaseapp.com",
  projectId: "dswd-attendance",
  storageBucket: "dswd-attendance.firebasestorage.app",
  messagingSenderId: "649463915378",
  appId: "1:649463915378:web:69349b0eace061ecc2b3eb",
  measurementId: "G-JFVBSXKVRR"
};


const app = initializeApp(firebaseConfig);

export const dbCloud = getFirestore(app);
