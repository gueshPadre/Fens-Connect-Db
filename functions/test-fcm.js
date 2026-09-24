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

const deviceToken = "eHsYzGq8Tii8MGvWZ9oaM7:APA91bG7hlDejuInUlcagcwikPqPa8axJ93i9Ap9JtSIYiVvW0smbZ1D-DVE_gpaOcLDNMmuHB4VaEuVA36HYMR-Bt8KV-LSzzXeXrctQymva1zbV9eYn4s";


const title = `YOUR FRIEND MAY NEED YOU`;
const body = `Pay Attention to them and Open FENS Connect.`;

const message = {
    token: deviceToken,

    data: {
        title,
        body,
        fromName: "MarthaC",
        type: "friend_sos",
        fromUserId: "from_user",
        lat: "48.43591262501287",
        lng: "-123.36971664750212",
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