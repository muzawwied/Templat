import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const source = process.env.SESSION_SECRET;
  if (!source) throw new Error("SESSION_SECRET is required to encrypt provider credentials.");
  return Buffer.from(
    hkdfSync("sha256", source, "ai-router-provider-keys", "aes-256-gcm:v1", 32),
  );
}

export function encryptProviderKey(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${nonce.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptProviderKey(value: string): string {
  const [version, noncePart, tagPart, ciphertextPart] = value.split(".");
  if (version !== "v1" || !noncePart || !tagPart || !ciphertextPart) {
    throw new Error("Provider credential has an unsupported encryption format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(noncePart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
