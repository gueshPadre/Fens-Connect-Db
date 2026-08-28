# FENS Connect Cloud Functions

## Deploy

```bash
cd functions
npm install
cd ..
firebase login
firebase use fens-connect-db
firebase deploy --only functions,firestore:rules
```

## What it does

`onFriendAlertRequest` runs when a document is created in `AlertRequests/{id}`:

1. Rate-limits to 5 alerts per user per hour
2. Resolves friends from `Users/{fromUserId}/FriendList` (optional single `targetFriendId`)
3. Loads FCM tokens from `Users/{friendId}/Devices`
4. Sends multicast FCM via Admin SDK
5. Updates the request `status` to `sent` or `failed`

Clients never send FCM themselves.
