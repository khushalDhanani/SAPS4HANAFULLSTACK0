# Docker service bindings

Place the approved service binding files in this directory on the deployment host.
Binding files are ignored by Git; do not commit service keys or credential values.
Restrict access to the files and their parent directory to the deployment operator.
The files must be readable by the container's unprivileged `node` user (UID
1000); Compose mounts the directory read-only and does not change host file
permissions.

Compose expects three JSON files:

- `xsuaa.json` — one binding object with `label: "xsuaa"`, a non-empty `name`,
  and a non-empty `credentials` object.
- `destination.json` — one binding object with `label: "destination"`, a
  non-empty `name`, and a non-empty `credentials` object.
- `hana.json` — one binding object with `label: "hana"`, a non-empty `name`,
  and a non-empty `credentials` object.

Each file must contain the binding object itself, not the complete
`VCAP_SERVICES` document. The container entrypoint combines the mounted objects
into the standard `VCAP_SERVICES` structure before starting CAP or the approuter.
The loader never logs file contents. Startup fails with the file path and
service label when a required file is missing or malformed.

The directory is mounted read-only at `/run/secrets`, so missing or malformed
files reach the entrypoint's explicit service-specific validation. `.env.example`
supports an alternate host directory through `BINDINGS_HOST_PATH`. Use the
deployment platform's protected secret store or a host directory with restrictive
permissions.
