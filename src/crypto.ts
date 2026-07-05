import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ENCRYPTION_VERSION = "v1";

function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey, "utf8").digest();
}

export function encryptSecret(plainText: string, masterKey: string): string {
  const iv = randomBytes(12);
  const key = deriveKey(masterKey);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(cipherText: string, masterKey: string): string {
  const [version, ivB64, tagB64, payloadB64] = cipherText.split(":");
  if (version !== ENCRYPTION_VERSION || !ivB64 || !tagB64 || !payloadB64) {
    throw new Error("Unsupported encrypted secret format");
  }

  const decipher = createDecipheriv("aes-256-gcm", deriveKey(masterKey), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return ["scrypt", salt.toString("base64"), derived.toString("base64")].join(":");
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [algorithm, saltB64, hashB64] = encodedHash.split(":");
  if (algorithm !== "scrypt" || !saltB64 || !hashB64) {
    return false;
  }

  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
