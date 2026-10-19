# src/Utils/passwords.py
"""Password hashing with salted scrypt (Python standard library, memory-hard).

Stored format:  scrypt$<log2 N>$<r>$<p>$<salt base64>$<hash base64>
Hashes written before 2026-10-19 are unsalted SHA-256 hex digests. They still
verify, and needs_rehash() reports them so callers can upgrade on next login.
"""
import base64
import hashlib
import hmac
import os
import re

_LOG2_N, _R, _P = 15, 8, 1          # ~90 ms and 32 MB per hash
_SALT_BYTES, _KEY_BYTES = 16, 32
_MAXMEM = 64 * 1024 * 1024
_LEGACY_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _scrypt(password: str, salt: bytes, log2_n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** log2_n, r=r, p=p,
                          maxmem=_MAXMEM, dklen=_KEY_BYTES)


def hash_password(password: str) -> str:
    """Return a new salted scrypt hash for storage."""
    salt = os.urandom(_SALT_BYTES)
    digest = _scrypt(password, salt, _LOG2_N, _R, _P)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return f"scrypt${_LOG2_N}${_R}${_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Check a password against a stored scrypt or legacy SHA-256 hash."""
    if not password or not stored_hash:
        return False
    if stored_hash.startswith("scrypt$"):
        try:
            _, log2_n, r, p, salt, digest = stored_hash.split("$")
            expected = base64.b64decode(digest)
            actual = _scrypt(password, base64.b64decode(salt), int(log2_n), int(r), int(p))
        except (ValueError, TypeError):
            return False
        return hmac.compare_digest(actual, expected)
    if _LEGACY_SHA256.match(stored_hash):
        legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy, stored_hash)
    return False


def needs_rehash(stored_hash: str) -> bool:
    """True for legacy hashes or scrypt hashes made with weaker parameters."""
    if not stored_hash or not stored_hash.startswith("scrypt$"):
        return True
    try:
        _, log2_n, r, p, *_ = stored_hash.split("$")
        return (int(log2_n), int(r), int(p)) != (_LOG2_N, _R, _P)
    except ValueError:
        return True
