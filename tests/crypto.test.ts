import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from "../src/crypto.js";

describe("crypto helpers", () => {
  it("round-trips encrypted secrets", () => {
    const masterKey = "very-strong-master-key";
    const encrypted = encryptSecret("secret-value", masterKey);
    expect(decryptSecret(encrypted, masterKey)).toBe("secret-value");
  });

  it("verifies hashed passwords", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });
});
