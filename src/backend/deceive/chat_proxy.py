"""Local TCP/TLS MITM bridge that forwards XMPP chat traffic.

Mirrors the Godot ChatProxy (src/presence/chat_proxy.gd): a loopback listener
that accepts the Riot client's chat connection, terminates TLS with our
self-signed certificate, opens a TLS connection to the real Riot chat server
(with validation disabled, matching Godot's TLSOptions.client_unsafe()), and
bridges the two byte streams while filtering outbound <presence> stanzas.
"""

import socket
import ssl
import threading

from . import crypto_helper
from . import presence_constants as pc
from . import xmpp_filter

import sys


def print(*args, **kwargs):  # noqa: A001  route logs to stderr; stdout carries the IPC channel
    sys.stderr.write(' '.join(str(a) for a in args) + '\n')
    sys.stderr.flush()


BUFFER_SIZE = pc.BUFFER_SIZE
HANDSHAKE_TIMEOUT_SEC = 20.0


class _BridgeSession(threading.Thread):
    """One client <-> upstream bridge, run in its own daemon thread."""

    def __init__(self, raw_client, upstream_host, upstream_port, server_ssl_ctx, client_ssl_ctx):
        super().__init__(name="deceive-chat-bridge", daemon=True)
        self._client_sock = raw_client
        self._upstream_host = upstream_host
        self._upstream_port = upstream_port
        self._server_ssl_ctx = server_ssl_ctx
        self._client_ssl_ctx = client_ssl_ctx
        self._should_stop = threading.Event()

    def stop(self):
        self._should_stop.set()
        self._close_both()

    def run(self):
        try:
            client_ssl = self._server_ssl_ctx.wrap_socket(
                self._client_sock, server_side=True
            )
        except (ssl.SSLError, OSError):
            self._close_both()
            return

        upstream_sock = socket.create_connection(
            (self._upstream_host, self._upstream_port), timeout=HANDSHAKE_TIMEOUT_SEC
        )
        try:
            upstream_ssl = self._client_ssl_ctx.wrap_socket(
                upstream_sock, server_hostname=self._upstream_host
            )
        except (ssl.SSLError, OSError, ValueError):
            client_ssl.close()
            self._close_sock(upstream_sock)
            return

        print(
            f"[Presence/ChatProxy] Dual TLS handshake established ({self._upstream_host}:{self._upstream_port}). "
            "XMPP traffic bridging active."
        )

        client_out = threading.Thread(
            target=self._drain_client_to_upstream,
            args=(client_ssl, upstream_ssl),
            daemon=True,
        )
        upstream_out = threading.Thread(
            target=self._drain_upstream_to_client,
            args=(upstream_ssl, client_ssl),
            daemon=True,
        )
        client_out.start()
        upstream_out.start()

        client_out.join(timeout=1)
        upstream_out.join(timeout=1)
        client_ssl.close()
        upstream_ssl.close()
        print("[Presence/ChatProxy] Closed XMPP bridge session.")

    def _drain_client_to_upstream(self, src, dst):
        try:
            while not self._should_stop.is_set():
                data = src.recv(BUFFER_SIZE)
                if not data:
                    break
                filtered = xmpp_filter.filter_outbound(data)
                if filtered:
                    dst.sendall(filtered)
        except (ssl.SSLError, OSError, ValueError):
            pass
        finally:
            self._should_stop.set()

    def _drain_upstream_to_client(self, src, dst):
        try:
            while not self._should_stop.is_set():
                data = src.recv(BUFFER_SIZE)
                if not data:
                    break
                dst.sendall(data)
        except (ssl.SSLError, OSError, ValueError):
            pass
        finally:
            self._should_stop.set()

    def _close_both(self):
        self._close_sock(self._client_sock)

    @staticmethod
    def _close_sock(sock):
        try:
            sock.close()
        except OSError:
            pass


class ChatProxy:
    """Loopback TCP/TLS listener accepting Riot XMPP connections."""

    def __init__(self):
        self._server = None
        self._upstream_host = "br.chat.si.riotgames.com"
        self._upstream_port = pc.DEFAULT_RIOT_CHAT_PORT
        self._server_ssl_ctx = None
        self._client_ssl_ctx = None
        self._sessions = []
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, upstream_host="", upstream_port=pc.DEFAULT_RIOT_CHAT_PORT):
        if upstream_host:
            self._upstream_host = upstream_host
        self._upstream_port = int(upstream_port)

        key_pem, cert_pem = crypto_helper.CryptoHelper.get_server_tls_options()
        self._server_ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        try:
            self._server_ssl_ctx.load_cert_chain(
                certfile=_to_temp(cert_pem, "cert.pem"),
                keyfile=_to_temp(key_pem, "key.pem"),
            )
        except (ssl.SSLError, OSError) as exc:
            return False, str(exc)

        self._client_ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self._client_ssl_ctx.check_hostname = False
        self._client_ssl_ctx.verify_mode = ssl.CERT_NONE

        try:
            self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._server.bind((pc.LOCALHOST_IP, 0))
            self._server.listen(16)
            self._server.settimeout(0.5)
        except OSError as exc:
            return False, str(exc)

        threading.Thread(target=self._accept_loop, name="deceive-chat-accept", daemon=True).start()
        print(
            f"[Presence/ChatProxy] XMPP Chat Proxy listening on {pc.LOCALHOST_IP}:{self.get_port()} "
            f"(Upstream: {self._upstream_host}:{self._upstream_port})"
        )
        return True, ""

    def stop(self):
        with self._lock:
            sessions = list(self._sessions)
            self._sessions.clear()
        for s in sessions:
            s.stop()
        if self._server is not None:
            self._server.close()
            self._server = None
            print("[Presence/ChatProxy] Stopped listening.")

    def get_port(self):
        return self._server.getsockname()[1] if self._server is not None else 0

    def set_upstream_target(self, host, port=pc.DEFAULT_RIOT_CHAT_PORT):
        if host:
            self._upstream_host = host
        if int(port) > 0:
            self._upstream_port = int(port)
        print(f"[Presence/ChatProxy] Updated upstream target to {self._upstream_host}:{self._upstream_port}")

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _accept_loop(self):
        while self._server is not None:
            try:
                conn, _ = self._server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            session = _BridgeSession(
                conn,
                self._upstream_host,
                self._upstream_port,
                self._server_ssl_ctx,
                self._client_ssl_ctx,
            )
            with self._lock:
                self._sessions.append(session)
            session.start()


def _to_temp(pem_bytes, name):
    """Persist a PEM blob to a temp file so ssl can load it, tracked for GC.

    Returns the file path. The file persists for the process lifetime; it holds
    only a self-signed cert and key that already exist in memory, so this is not
    a new secret exposure. Loaded once and read immediately.
    """
    import os
    import tempfile

    fd, path = tempfile.mkstemp(prefix="deceive_", suffix="_" + name)
    with os.fdopen(fd, "wb") as fh:
        fh.write(pem_bytes)
    return path
