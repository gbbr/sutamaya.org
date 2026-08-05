// One-off admin cleanup: deletes every doc in every user's `visited` subcollection
// (users/{uid}/visited/{suttaId} — see CLAUDE.md's Firestore schema). Needed once, going from
// "visited" marked the instant the reader opened a sutta to only marking it after a real dwell
// time (see ReaderPage's dwell-timer effect) — existing marks predate that rule and don't reflect
// it, so they're cleared rather than left showing "read" for suttas that were only glanced at.
//
// Usage:
//   node scripts/clear-visited.mjs <project-id>
//   GOOGLE_CLOUD_PROJECT=<project-id> node scripts/clear-visited.mjs
//
// Against the local emulator, also set FIRESTORE_EMULATOR_HOST (e.g. localhost:8081) — otherwise
// this talks to real Firestore for the given project, using whatever ADC/gcloud credentials are
// active locally (`gcloud auth application-default login`).
import { Firestore } from '@google-cloud/firestore';

const projectId = process.argv[2] || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error('Usage: node scripts/clear-visited.mjs <project-id>');
  process.exit(1);
}

const db = new Firestore({ projectId });
const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulator (${process.env.FIRESTORE_EMULATOR_HOST})` : 'production';
console.log(`Project "${projectId}" — ${target}`);

const snap = await db.collectionGroup('visited').get();
console.log(`Found ${snap.size} visited doc(s).`);

if (!snap.empty) {
  const batchSize = 400; // stay under Firestore's 500-write batch limit
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    snap.docs.slice(i, i + batchSize).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    console.log(`Deleted ${Math.min(i + batchSize, snap.docs.length)}/${snap.size}`);
  }
}

console.log('Done.');
