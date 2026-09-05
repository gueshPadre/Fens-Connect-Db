const { initializeApp, applicationDefault } =
    require("firebase-admin/app");

const { getMessaging } =
    require("firebase-admin/messaging");

console.log("1️⃣ Initializing Firebase...");

const app = initializeApp({
    credential: applicationDefault(),
    projectId: "fens-connect-db"
});

console.log("2️⃣ Firebase app:", app.name);

const deviceToken = "fSlhIIP3Q3K4Obbuxl4YcQ:APA91bH44uJHiCUq6mDr0jaBxjfkTL3iNKDQ8_MwefRsOkEp7jn5plnfC--64MwY_plq7mk1n-Jq4teU8Xt-n4TDUhkcMt8JKSMVo19hkaZuuV06wgcwxT4";


const title = `YOUR FRIEND MAY NEED YOU`;
const body = `Pay Attention to them and Open FENS Connect.`;

const message = {
    token: deviceToken,

    data: {
        title,
        body,
        type: "friend_sos",
        fromUserId: "from_user",
        lat: "45.52347325683222",
        lng: "- 73.70867217238381",
    }
};

console.log("3️⃣ Getting Firebase Messaging...");

const messaging = getMessaging(app);

console.log("4️⃣ Sending FCM...");

messaging.send(message)
    .then((response) => {
        console.log("🔥🔥🔥 FCM SENT!");
        console.log("Message ID:", response);
    })
    .catch((error) => {
        console.error("❌ FCM ERROR:");
        console.error(error);
    });