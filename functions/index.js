const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { logger } = require("firebase-functions");
const { credential } = require("./node_modules/firebase-admin/lib/firebase-namespace-api");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

/** Max friend-alert pushes a user may trigger per rolling hour. */
const MAX_ALERTS_PER_HOUR = 5;

/**
 * When a client writes AlertRequests/{id}, validate friendship + rate limits,
 * then send FCM to friends' device tokens. Clients never call FCM themselves.
 */
exports.onFriendAlertRequest = onDocumentCreated(
    "AlertRequests/{requestId}",
    async (event) => {
        const snap = event.data;
        if (!snap) {
            return;
        }

        const requestId = event.params.requestId;
        const data = snap.data() || {};
        const fromUserId = data.fromUserId;
        const type = data.type || "friend_sos";
        const alertId = data.alertId;
        let lat;
        let lng;
        if (type == "friend_sos") {
            lat = data.lat;
            lng = data.lng;
        }

        const targetFriendId = data.targetFriendId || null;

        try {
            // const allowed = await checkRateLimit(fromUserId);
            // if (!allowed) {
            //     logger.warn("Rate limit exceeded", { fromUserId, requestId });
            //     await snap.ref.set(
            //         { status: "failed", error: "rate_limited" },
            //         { merge: true }
            //     );
            //     return;
            // }

            const Ids = [];
            if (targetFriendId) {
                Ids.push(targetFriendId);
            }
            const tokens = await collectDeviceTokens(Ids);
            if (tokens.length === 0) {
                await snap.ref.set(
                    { status: "failed", error: "no_tokens" },
                    { merge: true }
                );
                return;
            }

            const fromProfile = await db.collection("Users").doc(fromUserId).get();
            const fromName =
                (fromProfile.exists &&
                    (fromProfile.get("DisplayName") || fromProfile.get("Name"))) ||
                "A friend";

            if (type == "friendRequest") {
                const title = `${fromName} wants to be your friend`;
                const body = `Accept or Reject their request.`;

                const response = await messaging.sendEachForMulticast({
                    tokens,
                    notification: { title, body },
                    data: {
                        type: String(type),
                        alertId: String(alertId),
                    },
                    android: {
                        priority: "high",
                        notification: {
                            channelId: "fens_friend_alerts",
                            priority: "high",
                        },
                    },
                });

                logger.info("FCM send result", {
                    requestId,
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                });

                await snap.ref.set(
                    {
                        status: response.successCount > 0 ? "sent" : "failed",
                        sentAt: Timestamp.now(),
                        successCount: response.successCount,
                        failureCount: response.failureCount,
                    },
                    { merge: true }
                );
            }
            else if (type == "friend_sos") {

                // CHECKS
                // if the request has proper lat and lng
                if (!fromUserId || typeof lat !== "number" || typeof lng !== "number") {
                    await snap.ref.set(
                        { status: "failed", error: "invalid_payload" },
                        { merge: true }
                    );
                    return;
                }

                // If target user is NOT part of the sender's friend list
                const recipientIds = await resolveRecipients(fromUserId, targetFriendId);
                if (recipientIds.length === 0) {
                    await snap.ref.set(
                        { status: "failed", error: "no_recipients" },
                        { merge: true }
                    );
                    return;
                }

                const tokens = await collectDeviceTokens(recipientIds);
                if (tokens.length === 0) {
                    await snap.ref.set(
                        { status: "failed", error: "no_tokens" },
                        { merge: true }
                    );
                    return;
                }

                const title = `${fromName} MAY NEED YOU`;
                const body = `Pay Attention to them and Open FENS Connect.`;

                const response = await messaging.sendEachForMulticast({
                    tokens,
                    notification: { title, body },
                    data: {
                        title,
                        body,
                        type: String(type),
                        fromUserId: String(fromUserId),
                        lat: String(lat),
                        lng: String(lng),
                        requestId: String(requestId),
                    },
                    android: {
                        priority: "high",
                        notification: {
                            channelId: "fens_friend_alerts",
                            priority: "high",
                        },
                    },
                });

                logger.info("FCM send result", {
                    requestId,
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                });

                await snap.ref.set(
                    {
                        status: response.successCount > 0 ? "sent" : "failed",
                        sentAt: Timestamp.now(),
                        successCount: response.successCount,
                        failureCount: response.failureCount,
                    },
                    { merge: true }
                );
            }
        } catch (err) {
            logger.error("onFriendAlertRequest failed", err);
            await snap.ref.set(
                { status: "failed", error: String(err && err.message ? err.message : err) },
                { merge: true }
            );
        }
    }
);

async function checkRateLimit(fromUserId) {
    const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    const recent = await db
        .collection("AlertRequests")
        .where("fromUserId", "==", fromUserId)
        .where("createdAt", ">=", oneHourAgo)
        .get();

    // Includes the document that just triggered this function.
    return recent.size <= MAX_ALERTS_PER_HOUR;
}

async function resolveRecipients(fromUserId, targetFriendId) {
    const friendSnap = await db
        .collection("Users")
        .doc(fromUserId)
        .collection("FriendList")
        .get();

    const friendIds = [];
    friendSnap.forEach((doc) => {
        const uid = doc.get("uID");
        if (uid) {
            friendIds.push(String(uid));
        }
    });

    if (targetFriendId) {
        if (!friendIds.includes(targetFriendId)) {
            logger.warn("targetFriendId is not a friend", {
                fromUserId,
                targetFriendId,
            });
            return [];
        }
        return [targetFriendId];
    }

    return friendIds;
}

async function collectDeviceTokens(userIds) {
    const tokens = new Set();

    for (const userId of userIds) {
        const devices = await db
            .collection("Users")
            .doc(userId)
            .collection("Devices")
            .get();

        devices.forEach((doc) => {
            const token = doc.get("token");
            if (token) {
                tokens.add(String(token));
            }
        });
    }

    return Array.from(tokens);
}