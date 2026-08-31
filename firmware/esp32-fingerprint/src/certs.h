#pragma once

// Paste the current Let's Encrypt root CA here (ISRG Root X1), PEM format,
// from https://letsencrypt.org/certificates/ — needed so WiFiClientSecure can
// validate the backend's certificate instead of trusting blindly.
//
// If FP_TLS_INSECURE=1 (see platformio.ini), this is never used and the
// client skips certificate validation instead — fine on a bench with a
// self-signed cert, never on a unit that will sit in a factory entrance.
static const char *ROOT_CA_PEM = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE THE ISRG ROOT X1 CERTIFICATE HERE
-----END CERTIFICATE-----
)EOF";
