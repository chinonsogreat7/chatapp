# Chateo test client

An Expo SDK 57 app for testing Chateo’s complete authenticated messaging flow against the live API at `https://chateo-lhuw.onrender.com`.

The app includes:

- phone-number OTP request, resend, and verification
- encrypted persistent sessions with rotating refresh tokens
- mandatory profile completion and profile editing
- display-name search and on-device contact matching
- idempotent direct-conversation creation
- conversation list and durable REST message history
- realtime messages, presence, typing, delivery, and read receipts
- the original low-level Socket Lab under the **Lab** tab

The server contract is available in the [Chateo API documentation](https://chateo-lhuw.onrender.com/v1/docs).

## Run it

```bash
cd /Users/greatichoku/Documents/react-native/chateo-app
npm install
npm start
```

Press `i` for the iOS Simulator or `a` for an Android emulator, or scan the QR code with Expo Go on a physical device.

The production screens use the live Render server by default. Override it at build time with an origin only—without `/v1` or `/chat`:

```bash
EXPO_PUBLIC_API_ORIGIN=http://127.0.0.1:3000 npm start
```

Use `http://10.0.2.2:3000` for the Android Studio emulator. A physical device needs the computer’s LAN IP or an HTTPS tunnel. Do not send valuable credentials over an unencrypted LAN connection.

## Two-device end-to-end test

1. Open the app on two devices and sign in with two E.164 phone numbers you control.
2. Retrieve each OTP through the configured delivery provider:
   - `twilio`: read the SMS on the controlled phone.
   - `console`: read the code from private API/Render logs on a restricted development deployment.
3. Complete both profiles with distinct display names.
4. On device A, open **People**, search for device B’s display name, and tap **Chat**.
5. Send messages in both directions. The normal chat UI persists each send through REST and merges the corresponding `message.created` socket event by `clientMessageId`.
6. Verify online/offline presence, the typing indicator, unread badges, and Sent/Delivered/Read state.
7. Background and reopen a device, or wait for token rotation, to verify session recovery and socket recreation.

Never enable a fixed OTP on a publicly reachable deployment. OTP verification creates users automatically, so database seeding is not required for this flow.

## Session behavior

The native app stores the session only in Expo SecureStore (iOS Keychain / encrypted Android storage); it does not use AsyncStorage. Refresh operations are single-flight because every refresh rotates the token and invalidates the previous access token. The client refreshes shortly before expiry, refreshes again when returning to the foreground if needed, and retries one authenticated request after a `401`.

Logging out revokes the server refresh session when reachable and always removes local credentials. Web builds intentionally do not persist credentials because Expo SecureStore is native-only.

## Contacts and privacy

Contact access is requested only after tapping **Match contacts**. Phone numbers are normalized to E.164 on-device using the signed-in number’s country when available, deduplicated, capped at 100, sent once to `/v1/contacts/match`, and never persisted by the app. iOS and Android permission descriptions are configured through the Expo Contacts plugin.

## Socket Lab

The **Lab** tab keeps the original developer harness for manually testing:

- authenticated Socket.IO connect/disconnect
- presence subscribe/unsubscribe
- typing start/stop acknowledgements
- REST message, history, delivery, read, and receipt-frontier operations
- a raw event and acknowledgement timeline

The production socket is suspended while the Lab tab is active so a manually connected lab socket does not distort presence counts. The Lab token remains memory-only and independent from the app’s secure product session.

## Verification

```bash
npm run typecheck
npx expo export --platform ios --output-dir /private/tmp/chateo-ios-export
npx expo export --platform android --output-dir /private/tmp/chateo-android-export
```

The app cannot complete a live authenticated two-user test without OTPs for two controlled phone numbers (or access to private console-provider logs). No OTP requests are made by automated verification.
