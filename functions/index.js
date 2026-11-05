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
        let lat = data.lat || null;
        let lng = data.lng || null;
        const targetFriendIds = data.targetFriendIds || null;

        try {
            // UNCOMMENT THIS BLOCK TO ENABLE RATE LIMITING

            // const allowed = await checkRateLimit(fromUserId);
            // if (!allowed) {
            //     logger.warn("Rate limit exceeded", { fromUserId, requestId });
            //     await snap.ref.set(
            //         { status: "failed", error: "rate_limited" },
            //         { merge: true }
            //     );
            //     return;
            // }


            const tokens = await collectDeviceTokens(targetFriendIds);
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
            else if (type == "friendRequestAccepted") {
                const title = `${fromName} accepted your friendship!`;

                const response = await messaging.sendEachForMulticast({
                    tokens,
                    notification: { title },
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

                const locationAllowedIds = await CheckForCloseFriends(fromUserId, targetFriendIds);

                const title = `${fromName} MAY NEED YOU`;
                const body = `Pay Attention to them and Open FENS Connect.`;


                const messages = [];

                for (const recipientId of targetFriendIds) {

                    const recipientTokens = await collectDeviceTokens([recipientId]);

                    const canShareLoc = locationAllowedIds.has(String(recipientId));
                    logger.info(`${recipientId} can share loc?: ${canShareLoc}`);

                    for (const token of recipientTokens) {
                        messages.push({
                            token,
                            notification: { title, body },
                            data: {
                                type: String(type),
                                fromName: fromName,
                                lat: canShareLoc ? String(lat) : "null",
                                lng: canShareLoc ? String(lng) : "null",
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
                    }
                }

                const response = await messaging.sendEach(messages);


                // const response = await messaging.sendEachForMulticast({
                //     tokens,
                //     notification: { title, body },
                //     data: {
                //         title,
                //         body,
                //         type: String(type),
                //         fromUserId: String(fromUserId),
                //         lat: String(lat),
                //         lng: String(lng),
                //         requestId: String(requestId),
                //     },
                //     android: {
                //         priority: "high",
                //         notification: {
                //             channelId: "fens_friend_alerts",
                //             priority: "high",
                //         },
                //     },
                // });

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
            else if (type == "alone_mode") {
                const title = `${fromName} has been alone for a while`;
                const body = `Stay alert in case they need help!`;

                // if the request has proper lat and lng
                if (!fromUserId || typeof lat !== "number" || typeof lng !== "number") {
                    await snap.ref.set(
                        { status: "failed", error: "invalid_payload" },
                        { merge: true }
                    );
                    return;
                }

                const locationAllowedIds = await CheckForCloseFriends(fromUserId, targetFriendIds);

                const messages = [];

                for (const recipientId of targetFriendIds) {

                    const recipientTokens = await collectDeviceTokens([recipientId]);

                    const canShareLoc = locationAllowedIds.has(String(recipientId));
                    logger.info(`${recipientId} can share loc?: ${canShareLoc}`);

                    for (const token of recipientTokens) {
                        messages.push({
                            token,
                            notification: { title, body },
                            data: {
                                type: String(type),
                                lat: canShareLoc ? String(lat) : "null",
                                lng: canShareLoc ? String(lng) : "null",
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
                    }
                }

                const response = await messaging.sendEach(messages);

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
        }
        catch (err) {
            logger.error("AlertRequest failed", err);
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


async function collectDeviceTokens(userIds) {
    const tokens = new Set();

    for (const userId of userIds ?? []) {

        const devices = await db
            .collection("Users")
            .doc(userId)
            .collection("Devices")
            .get();

        devices.forEach((doc) => {
            const token = doc.get("token");

            // console.log(
            //     `Device ${doc.id}: token field exists =`,
            //     typeof token === "string" && token.length > 0
            // );

            if (token) {
                tokens.add(String(token));
            }
        });
    }

    logger.info("Total unique tokens found:", tokens.size);

    return Array.from(tokens);
}

async function CheckForCloseFriends(_fromUserId, _targetFriendIds) {
    //check if the user has enabled alerts to be sent to all friends or just close friends
    const settings = await db
        .collection("Users")
        .doc(_fromUserId)
        .collection("UserSettings")
        .doc("GeneralSettings")
        .get();

    const locationSharedWithFriends =
        settings.exists &&
        settings.get("LocationSharedWithFriends") === true;

    const frnds = await db
        .collection("Users")
        .doc(_fromUserId)
        .collection("FriendList")
        .get();

    const locationAllowedIds = new Set();

    if (locationSharedWithFriends) {
        _targetFriendIds.forEach(id => locationAllowedIds.add(String(id)));
    } else {
        frnds.forEach(friendDoc => {
            const friendUID = friendDoc.get("uID");

            if (
                friendUID &&
                _targetFriendIds.includes(String(friendUID)) &&
                friendDoc.get("IsCloseFriend") === true
            ) {
                locationAllowedIds.add(String(friendUID));
            }
        });
    }

    return locationAllowedIds;
}