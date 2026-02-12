// db.js - ONLINE ONLY
import { dbCloud } from "./firebase";
import { collection, doc, setDoc, deleteDoc, getDocs } from "firebase/firestore";

// Get all "collections" from registry (we store registry in Firebase as a doc per collection)
export async function getAllFiles() {
  // Optional: hardcode known collections if no registry exists
  return ["attendance1",];
}

// Add a collection to registry (optional)
export async function addFile(name) {
  try {
    await setDoc(doc(collection(dbCloud, name), "__placeholder__"), { createdAt: new Date() });
  } catch (e) {
    console.error("Failed to add collection:", e.message);
  }
}

// Rename a collection (copy docs + delete old collection)
export async function renameFile(oldName, newName) {
  try {
    const snapshot = await getDocs(collection(dbCloud, oldName));
    for (const docSnap of snapshot.docs) {
      await setDoc(doc(collection(dbCloud, newName), docSnap.id), docSnap.data());
      await deleteDoc(doc(dbCloud, oldName, docSnap.id));
    }

    // Ensure placeholder is deleted
    const placeholderRef = doc(dbCloud, oldName, "__placeholder__");
    await deleteDoc(placeholderRef).catch(() => {});
  } catch (e) {
    console.error("Failed to rename collection:", e.message);
  }
}

// Delete a collection (delete all docs)
export async function deleteFile(fileName) {
  try {
    const snapshot = await getDocs(collection(dbCloud, fileName));
    for (const docSnap of snapshot.docs) {
      await deleteDoc(doc(dbCloud, fileName, docSnap.id));
    }
  } catch (e) {
    console.error("Failed to delete collection:", e.message);
  }
}
