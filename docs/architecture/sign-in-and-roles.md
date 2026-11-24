# Sign-in and roles (login screen, non-production)

Applies to the standalone and local stacks, where users sign in on the login screen. In production the
application is reached through SAP BTP single sign-on (XSUAA): the login action answers HTTP 403 there and
nothing on this page applies.

## Who may sign in

A user signs in with their own SAP user name and password. SAP checks the password
(`srv/integration/s4hana/AuthAdapter.js`); the application never stores it.

| Setting | Effect |
| :--- | :--- |
| `APP_ALLOW_ANY_SAP_USER=true` | Every SAP user with a valid password may sign in. No user list is needed. |
| `APP_ALLOW_ANY_SAP_USER=false` (or unset) | Only users named in `APP_ADMIN_USERS`, `APP_USER_ROLES` or `APP_USERS_FILE` may sign in; anyone else is refused before SAP is asked. |

The SAP connection user (`S4_USERNAME`) can never sign in, and `S4_PASSWORD` is refused as a login password
for every user. At startup a warning is logged when `S4_USERNAME` is named in `APP_ADMIN_USERS` or
`APP_USER_ROLES`. Use a technical SAP user for the connection, not a person's own logon.

## Which roles a user gets

Decided once SAP has accepted the user's own password, in this order:

1. **Admin** is given only to the users named in `APP_ADMIN_USERS` (comma-separated SAP logon names,
   case-insensitive). No default, no SAP role, no `config/role-map.json` entry and no override entry grants it.
   A user named there gets Admin on top of the roles from steps 2 to 4, also while SAP cannot be asked for roles.
2. **Optional override**: an entry for the user in `APP_USER_ROLES` or `APP_USERS_FILE`. Both are empty by
   default and never required. An Admin entry in them grants nothing (a startup warning names such entries).
3. **SAP roles**: the user's SAP roles are read with `BAPI_USER_GET_DETAIL` (`ACTIVITYGROUPS[].AGR_NAME`).
   An SAP role named `<APP_SAP_ROLE_PREFIX><Role>` (default prefix `ZAPP_`) grants the application role `<Role>`;
   the part after the prefix is compared without regard to case and underscores, and Admin is excluded.
   All matches are combined. `config/role-map.json` maps SAP roles with other names. It holds only role names that
   exist in the connected SAP system; the current entries (2026-11-24) map the sales and purchase group roles and
   `ZWM_WM_ALL`, each to `Viewer` plus one functional role. An empty file (`{}`) maps nothing.
4. **Defaults**: when no SAP role matches, or the BAPI call fails or times out, the user gets only
   `APP_DEFAULT_ROLES` (default `Viewer`, never Admin). A warning with the user name is logged. It never falls
   back to more roles.

Application roles: `Viewer`, `PurchasingManager`, `SalesRepresentative`, `SalesManager`, `WarehouseClerk`,
`WarehouseManager`, `SapLogsReader`, `Admin`.

Step 3 needs RFC (SAP NW RFC SDK and `node-rfc`) in the running server. Without it every user without an
override gets the default roles; see `docs/deployment/rfc-production-readiness.md`.

## When a change applies

The roles are written into the sign-in token (valid 24 hours at most).

| Change | Applies |
| :--- | :--- |
| A role added or removed in SAP, a user locked in SAP | At the user's next sign-in. |
| A user removed from `APP_ADMIN_USERS` | At once: Admin is checked against the list on every request. |
| A user added to `APP_ADMIN_USERS` | At the user's next sign-in (at once for a user with an override entry). |
| An override entry added, changed or removed | At once for the entry's roles; a user whose entry was removed signs in again. |
| `APP_ALLOW_ANY_SAP_USER` switched off | At once: users known by no list are refused. |

## Local password

`LOCAL_DEV_PASSWORD` is a shared password for listed users on a development server (`NODE_ENV=development`) or in
the isolated Docker profile (`APP_ROLE=cap-local`). It is never accepted for an administrator: a user named in
`APP_ADMIN_USERS`, or listed with Admin anywhere.

## Server log

The SAP answer to a sign-in check is logged on the server only: `HTTP 401` (SAP did not accept the user name
and password), `HTTP 403` (SAP refused the read of the Gateway service catalog) or a connection error. The log
names the user and never contains a password or token.
