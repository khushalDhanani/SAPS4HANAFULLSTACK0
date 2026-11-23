# Custom CA certificates

Optionally place a PEM CA bundle named `ca-bundle.pem` in this directory on the
deployment host. Compose mounts the directory read-only at `/run/certs`; the
entrypoint sets `NODE_EXTRA_CA_CERTS=/run/certs/ca-bundle.pem` only when that
file exists. A path explicitly supplied through `CUSTOM_CA_CERT_FILE` must
exist, or startup fails.

For the standalone stack's TLS proxy (`docker compose --profile tls`), also place
the server certificate (with its chain) as `server.crt` and its private key as
`server.key` here, readable by the Docker daemon only (`chmod 600`).

Do not commit private keys or certificate material. Use the approved host
certificate-management process and rotate the bundle as required.
