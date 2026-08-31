#pragma once

// Arduino IDE has no build_flags mechanism (that's a PlatformIO thing), so
// this toggle lives here instead: set to 1 only for bench testing without a
// valid TLS cert configured below, 0 otherwise. Never ship a unit with this
// on — it disables server certificate validation entirely.
#define FP_TLS_INSECURE 0

// Paste the current Let's Encrypt root CA here (ISRG Root X1), PEM format,
// from https://letsencrypt.org/certificates/ — needed so WiFiClientSecure can
// validate the backend's certificate instead of trusting blindly.
//
// If FP_TLS_INSECURE is 1 above, this is never used and the client skips
// certificate validation instead — fine on a bench with a self-signed cert,
// never on a unit that will sit in a factory entrance.
static const char *ROOT_CA_PEM = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE THE ISRG ROOT X1 CERTIFICATE HERE
-----END CERTIFICATE-----
)EOF";
