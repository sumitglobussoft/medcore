# MedCore Mobile

Patient + doctor mobile companion app for [MedCore HMS](https://medcore.globusdemos.com),
built with Expo SDK 53 and `expo-router`.

## Quick start

```bash
cd apps/mobile
npm install
npm run dev          # opens the Expo dev tools
npm run ios          # iOS simulator
npm run android      # Android emulator / device
npm run web          # Web preview
npm run typecheck    # tsc --noEmit
npm test             # jest smoke tests
```

## API URL

The base URL is resolved at runtime in `lib/api.ts`:

1. `EXPO_PUBLIC_API_URL` env var (read at build time; baked into JS bundle).
2. `expoConfig.extra.apiUrl` — set in `app.config.ts`.
3. Hardcoded fallback: `https://medcore.globusdemos.com/api/v1`.

To point the app at a local API:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:3001/api/v1 npm run dev
```

The same variable is honoured by all three EAS profiles
(`development`, `preview`, `production`) — see `eas.json`.

## Build & submit

EAS commands are not run automatically (they require credentials). Once the
`EAS_PROJECT_ID` env var is set and `eas login` has been completed, the
standard flow is:

```bash
eas build --profile development --platform android   # internal dev client
eas build --profile preview     --platform ios       # internal TestFlight
eas build --profile production  --platform all       # store builds
eas submit --profile production --platform android
eas submit --profile production --platform ios
```

## Push notifications

`lib/hooks/usePushRegistration.ts` is mounted from the root layout once a
user is signed in. It:

1. Requests notification permission on the device.
2. Calls `Notifications.getExpoPushTokenAsync()` to obtain an Expo push
   token (or the underlying FCM/APNs token when bare-built).
3. POSTs the token to `POST /api/v1/notifications/push-token/register`,
   where it is stored on `User.pushToken`.

The native dispatcher (`apps/api/src/services/channels/push.ts`) reads the
token and sends notifications when the API needs to.

For an EAS production build, configure:

- iOS: an APNs key in your Apple Developer account, registered with EAS via
  `eas credentials`.
- Android: a Firebase project + `google-services.json`. Set
  `GOOGLE_SERVICES_JSON=/path/to/google-services.json` before `eas build`,
  which `app.config.ts` reads.

## Realtime queue

`lib/socket.ts` exposes `useQueueSocket(enabled, onEvent)`, used by the
patient queue tab and the doctor workspace. It connects to the API origin
(API URL minus `/api/v1`) using `socket.io-client` and listens for
`queue.update`, `queue.advance`, `queue.token.called`, and
`appointment.status.update` events. The hook lazy-loads the socket module so
the bundle still builds when offline.

## Token refresh

`lib/api.ts` wraps every request with a 401 interceptor that:

1. Calls `POST /api/v1/auth/refresh` with the stored refresh token.
2. Persists the new pair in `expo-secure-store`.
3. Retries the original request once.
4. On refresh failure, clears tokens and notifies the auth context (which
   logs the user out).

A single in-flight refresh promise is reused across concurrent requests to
avoid thundering herd.

## Role-based routing

`app/_layout.tsx` inspects `user.role` after authentication and routes:

- `DOCTOR` → `app/(doctor-tabs)/` (workspace, patients, prescriptions).
- everything else → `app/(tabs)/` (home, appointments, queue, Rx, billing).

## Folder map

```
app/
  _layout.tsx           # auth + role router
  index.tsx             # splash
  login.tsx, register.tsx
  (tabs)/               # patient stack
    home / appointments / queue / prescriptions / billing / profile
  (doctor-tabs)/        # doctor stack
    workspace / patients / prescriptions / profile
lib/
  api.ts                # fetch wrapper + token refresh + endpoint helpers
  auth.tsx              # AuthProvider / useAuth
  socket.ts             # useQueueSocket
  hooks/
    usePushRegistration.ts
__tests__/
  login.smoke.test.tsx
assets/                 # icon, splash, favicon, adaptive-icon, notification-icon
app.config.ts           # dynamic Expo config (env-aware)
eas.json                # EAS Build profiles
```
