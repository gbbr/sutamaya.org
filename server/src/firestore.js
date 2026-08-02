import { Firestore, FieldValue } from '@google-cloud/firestore';

// Local dev talks to the Firestore emulator by default (no GCP credentials or cost involved).
// `npm run dev:emulator` starts it; NODE_ENV=production (set in the Cloud Run image) skips this
// so the deployed service always talks to real Firestore via the attached service account.
if (process.env.NODE_ENV !== 'production' && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8081';
}

export const db = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'sutamaya-local',
});

export { FieldValue };

export const usersCol = () => db.collection('users');
export const userDoc = (userId) => usersCol().doc(userId);
export const listsCol = (userId) => userDoc(userId).collection('lists');
export const notesCol = (userId) => userDoc(userId).collection('notes');
export const highlightsCol = (userId) => userDoc(userId).collection('highlights');
export const visitedCol = (userId) => userDoc(userId).collection('visited');
