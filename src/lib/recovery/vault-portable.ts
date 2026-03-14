/**
 * Portable vault encryption for backup files.
 * Re-encrypts vault secrets with a user-provided password so the backup
 * is self-contained and doesn't depend on the local .vault-key.
 */

import crypto from "node:crypto";
import {
  deriveKey,
  SALT_LEN,
  IV_LEN,
  KEY_LEN,
  PBKDF2_ITERATIONS,
  PBKDF2_DIGEST,
} from "@/lib/vault/vault";

export interface PortableVault {
  encrypted: true;
  algorithm: "aes-256-gcm";
  kdf: "pbkdf2";
  iterations: number;
  data: string; // base64
}

/**
 * Encrypt vault secrets with a user-provided password for backup export.
 * Returns a PortableVault object ready for JSON serialization.
 */
export function encryptForExport(
  secrets: Record<string, string>,
  password: string,
): PortableVault {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf-8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Same blob format as vault.enc: [salt][iv][ciphertext][tag]
  const blob = Buffer.concat([salt, iv, encrypted, tag]);

  return {
    encrypted: true,
    algorithm: "aes-256-gcm",
    kdf: "pbkdf2",
    iterations: PBKDF2_ITERATIONS,
    data: blob.toString("base64"),
  };
}

/**
 * Decrypt vault secrets from a backup using the user-provided password.
 * Throws if the password is wrong or data is corrupted.
 */
export function decryptForImport(
  portable: PortableVault,
  password: string,
): Record<string, string> {
  const blob = Buffer.from(portable.data, "base64");

  if (blob.length < SALT_LEN + IV_LEN + 16 + 1) {
    throw new Error("Invalid vault data in backup");
  }

  const salt = blob.subarray(0, SALT_LEN);
  const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(SALT_LEN + IV_LEN, blob.length - 16);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf-8"));
  } catch {
    throw new Error("Wrong password or corrupted backup");
  }
}
