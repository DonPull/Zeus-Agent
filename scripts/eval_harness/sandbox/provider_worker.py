"""Host-only fixed Abacus transport. Credentials never leave this process.

The Node controller uses anonymous pipes, never command-line credentials. The
offline mode accepts only an explicit IPv4 loopback origin and a dummy key.
"""
import base64
import ctypes
from ctypes import wintypes
import http.client
import json
import os
import sys
import time
from urllib.parse import urlsplit

MAXIMUM = 1024 * 1024


def credential():
    if os.name != 'nt':
        raise ValueError('Windows credential store required')

    class Credential(ctypes.Structure):
        _fields_ = [('Flags', wintypes.DWORD), ('Type', wintypes.DWORD),
                    ('TargetName', wintypes.LPWSTR), ('Comment', wintypes.LPWSTR),
                    ('LastWritten', wintypes.FILETIME), ('CredentialBlobSize', wintypes.DWORD),
                    ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)),
                    ('Persist', wintypes.DWORD), ('AttributeCount', wintypes.DWORD),
                    ('Attributes', ctypes.c_void_p), ('TargetAlias', wintypes.LPWSTR),
                    ('UserName', wintypes.LPWSTR)]

    vault = ctypes.WinDLL('Advapi32.dll', use_last_error=True)
    pointer = ctypes.POINTER(Credential)()
    vault.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                               ctypes.POINTER(ctypes.POINTER(Credential))]
    vault.CredReadW.restype = wintypes.BOOL
    vault.CredFree.argtypes = [ctypes.c_void_p]
    if not vault.CredReadW('routellm-api-key.zeus-agent', 1, 0, ctypes.byref(pointer)):
        raise ValueError('Configured Abacus credential unavailable')
    try:
        size = pointer.contents.CredentialBlobSize
        if not 0 < size <= 16384 or size % 2:
            raise ValueError('Invalid configured credential encoding')
        key = ctypes.string_at(pointer.contents.CredentialBlob, size).decode('utf-16-le')
        if not key or any(ord(char) < 33 or ord(char) > 126 for char in key):
            raise ValueError('Invalid configured credential')
        return key
    finally:
        vault.CredFree(pointer)


def main():
    started = time.monotonic()
    raw = sys.stdin.buffer.read(2 * MAXIMUM + 1)
    if len(raw) > 2 * MAXIMUM:
        raise ValueError('Oversized host transport instruction')
    request = json.loads(raw)
    if set(request) != {'method', 'path', 'body_base64', 'timeout_ms'}:
        raise ValueError('Invalid host transport fields')
    method, route = request['method'], request['path']
    if (method, route) not in [('GET', '/models'), ('POST', '/chat/completions')]:
        raise ValueError('Undeclared provider route')
    body = base64.b64decode(request['body_base64'], validate=True)
    if len(body) > MAXIMUM or (method == 'GET' and body):
        raise ValueError('Invalid provider body bounds')
    timeout = request['timeout_ms']
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 300000:
        raise ValueError('Invalid provider deadline')
    offline = len(sys.argv) == 3 and sys.argv[1] == '--offline-origin'
    if len(sys.argv) != 1 and not offline:
        raise ValueError('Unknown host transport arguments')
    if offline:
        origin = urlsplit(sys.argv[2])
        if origin.scheme != 'http' or origin.hostname != '127.0.0.1' or not origin.port or origin.path or origin.query or origin.fragment or origin.username or origin.password:
            raise ValueError('Offline provider must be an explicit IPv4 loopback origin')
        connection = http.client.HTTPConnection(origin.hostname, origin.port, timeout=timeout / 1000)
        key = 'offline-provider-key'
    else:
        connection = http.client.HTTPSConnection('routellm.abacus.ai', timeout=timeout / 1000)
        key = credential()
    deadline = started + timeout / 1000
    try:
        connection.request(method, '/v1' + route, body=body if method == 'POST' else None,
                           headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                                    'Accept': 'text/event-stream, application/json'})
        response = connection.getresponse()
        first_byte_ms = round((time.monotonic() - started) * 1000)
        # Redirect responses are returned as failures; never forward credentials.
        chunks, size = [], 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Provider deadline')
            if connection.sock:
                connection.sock.settimeout(remaining)
            chunk = response.read1(min(65536, MAXIMUM - size + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > MAXIMUM:
                raise ValueError('Provider response exceeds allowance')
            chunks.append(chunk)
        result = b''.join(chunks)
        # Never return an echoed credential, including from an error body.
        if key.encode() in result:
            raise ValueError('Credential echo in provider response')
        return {'status': response.status, 'content_type': response.getheader('Content-Type', '').split(';')[0].lower(),
                'body_base64': base64.b64encode(result).decode('ascii'), 'first_byte_ms': first_byte_ms,
                'duration_ms': round((time.monotonic() - started) * 1000)}
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except Exception:
        # No arbitrary exception/body/header text can expose the configured key.
        print(json.dumps({'error': 'Provider transport failed; usage may be unknown'}))
        raise SystemExit(1)
