# Custom CA certificates

Optionally place a PEM CA bundle named `ca-bundle.pem` in this directory on the
deployment host. Compose mounts the directory read-only at `/run/certs`; the
entrypoint sets `NODE_EXTRA_CA_CERTS=/run/certs/ca-bundle.pem` only when that
file exists. A path explicitly supplied through `CUSTOM_CA_CERT_FILE` must
exist, or startup fails.

Do not commit private keys or certificate material. Use the approved host
certificate-management process and rotate the bundle as required.
