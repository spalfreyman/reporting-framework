#!/bin/sh
# Behind a TLS-inspecting proxy (e.g. Zscaler), Node needs the proxy's root CA to verify
# intercepted hosts like google-analytics.com. If corp-ca.pem is present, add it (it only
# EXTENDS the default roots, so normal hosts keep verifying). Absent → plain run.
CA="$(cd "$(dirname "$0")" && pwd)/corp-ca.pem"
[ -f "$CA" ] && export NODE_EXTRA_CA_CERTS="$CA"
exec "$@"
