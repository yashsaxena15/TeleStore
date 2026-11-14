"""One-off: re-wrap every vault recovery copy still sealed with the old public default secret.

Vaults made before 2026-10-19 sealed their recovery copy (used by "Forgot PIN") with a secret that
was public in the repo. The server now only knows the current SESSION_SECRET_KEY; this re-seals
those copies with it. Run once inside the app container, giving the old secret for this run only:

    LEGACY_RECOVERY_SECRET=<old default> python -m telestore.tools.rewrap_vault_recovery

It changes nothing that already opens with the current secret, and prints only counts.
"""

import os
import sys

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def rewrap(coll, legacy_secret: str) -> dict:
    from telestore.api.routes.vault import _get_recovery_master_key, _wrap_recovery_envelope
    counts = {"current": 0, "rewrapped": 0, "unreadable": 0}
    for config in coll.find({"recovery_envelope": {"$exists": True}}):
        user_id = config["user_id"]
        iv, env = bytes.fromhex(config["recovery_iv"]), bytes.fromhex(config["recovery_envelope"])
        try:
            AESGCM(_get_recovery_master_key(user_id)).decrypt(iv, env, None)
            counts["current"] += 1
            continue
        except InvalidTag:
            pass
        try:
            vault_key = AESGCM(_get_recovery_master_key(user_id, legacy_secret)).decrypt(iv, env, None)
        except InvalidTag:
            counts["unreadable"] += 1
            continue
        coll.update_one({"_id": config["_id"]}, {"$set": _wrap_recovery_envelope(user_id, vault_key)})
        counts["rewrapped"] += 1
    return counts


def main() -> int:
    legacy = os.getenv("LEGACY_RECOVERY_SECRET", "")
    if not legacy:
        print("Set LEGACY_RECOVERY_SECRET for this run.")
        return 2
    from telestore.services.email_service import get_vault_db  # the same database the vault uses
    db = get_vault_db()
    print(rewrap(db["VaultConfig"], legacy))
    return 0


if __name__ == "__main__":
    sys.exit(main())
