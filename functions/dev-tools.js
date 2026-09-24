const { onDocumentCreated } = require("firebase-functions/v2/firestore");
//const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
//const { getMessaging } = require("firebase-admin/messaging");
const { logger } = require("firebase-functions");
const { credential } = require("./node_modules/firebase-admin/lib/firebase-namespace-api");
const { initializeApp, applicationDefault } =
    require("firebase-admin/app");
//const { getFirestore, Timestamp } = require("firebase-admin/firestore");


const { getMessaging } =
    require("firebase-admin/messaging");

console.log("1️⃣ Initializing Firebase...");

const app = initializeApp({
    credential: applicationDefault(),
    projectId: "fens-connect-db"
});
const db = getFirestore();

async function clearAlertRequests() {
    const snapshot = await db.collection("AlertRequests").get();

    if (snapshot.empty) {
        console.log("No alert requests to delete.");
        return;
    }

    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });

    await batch.commit();

    console.log(`🔥 Deleted ${snapshot.size} alert requests.`);
}

const command = process.argv[2];

if (command === "clear-alerts") {
    clearAlertRequests()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("❌ Error:", error);
            process.exit(1);
        });
}