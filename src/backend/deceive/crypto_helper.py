"""Self-signed TLS certificate generation for the local Deceive MITM proxy.

Mirrors the Godot CryptoHelper (src/presence/crypto_helper.gd): generates an
in-memory RSA key pair plus a long-lived self-signed certificate whose common
name is the Deceive localhost domain so the Riot client's hostname validation
accepts it. The certificate embodies the same properties Godot produced.

Uses the `cryptography` package because it is already installed and the Python
standard library has no certificate generation primitives.
"""

import datetime

from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from . import presence_constants as pc

import sys


def print(*args, **kwargs):  # noqa: A001  route logs to stderr; stdout carries the IPC channel
    sys.stderr.write(' '.join(str(a) for a in args) + '\n')
    sys.stderr.flush()


# Certificate validity window matches the Godot version (2024..2034).
_NOT_BEFORE = datetime.datetime(2024, 1, 1)
_NOT_AFTER = datetime.datetime(2034, 1, 1)


def _normalize(subject) -> str:
    """Collapse a cryptography Name into an rfc2253-ish string for logging."""
    parts = []
    for attr in subject:
        parts.append(f"{attr.oid._name}={attr.value}")
    return ",".join(parts)


class CryptoHelper:
    """Static helper for the cached self-signed TLS server certificate."""

    _cached_key = None
    _cached_cert = None
    _cached_tls_options = None

    # ------------------------------------------------------------------
    # API
    # ------------------------------------------------------------------

    @classmethod
    def get_server_tls_options(cls):
        """Return a (key_pem, cert_pem) tuple cached for the chat server.

        Mirrors Godot's get_server_tls_options returning TLSOptions.server(),
        but this backend hands the PEM bytes to the Python ssl.SSLContext.
        """
        if cls._cached_tls_options is not None:
            return cls._cached_tls_options
        cls._build_certificate()
        return cls._cached_tls_options

    @classmethod
    def cleanup(cls):
        """Clear cached keys and certificates on full shutdown."""
        cls._cached_tls_options = None
        cls._cached_cert = None
        cls._cached_key = None

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @classmethod
    def _build_certificate(cls):
        if cls._cached_key is None:
            cls._cached_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
                backend=default_backend(),
            )

        if cls._cached_cert is None and cls._cached_key is not None:
            key = cls._cached_key
            subject = issuer = x509.Name(
                [
                    x509.NameAttribute(NameOID.COMMON_NAME, pc.DECEIVE_LOCALHOST_DOMAIN),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Deceive"),
                    x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
                ]
            )
            cert = (
                x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(issuer)
                .public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(_NOT_BEFORE)
                .not_valid_after(_NOT_AFTER)
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(
                    x509.SubjectAlternativeName([x509.DNSName(pc.DECEIVE_LOCALHOST_DOMAIN)]),
                    critical=False,
                )
                .sign(key, hashes.SHA256(), default_backend())
            )
            cls._cached_cert = cert
            key_pem = key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            )
            cert_pem = cert.public_bytes(serialization.Encoding.PEM)
            cls._cached_tls_options = (key_pem, cert_pem)
            print(f"[Presence/Crypto] Self-signed TLS certificate generated successfully for {pc.DECEIVE_LOCALHOST_DOMAIN}.")
