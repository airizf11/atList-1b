// alis1b/src/utils/crypto.ts
import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, "hex")
  : Buffer.alloc(32);
const IV_LENGTH = 16;

if (ENCRYPTION_KEY.length !== 32 && process.env.ENCRYPTION_KEY) {
  console.error(
    "ENCRYPTION_KEY must be 32 bytes (64 hex characters). Current length:",
    ENCRYPTION_KEY.length
  );
  // throw new Error('Invalid ENCRYPTION_KEY length. Must be 32 bytes (64 hex characters).');
}

export function encrypt(text: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    console.warn(
      "ENCRYPTION_KEY is not set. Encryption will not be performed."
    );
    return text;
  }
  if (ENCRYPTION_KEY.length !== 32) {
    console.warn(
      "ENCRYPTION_KEY is not 32 bytes. Encryption might be weak or fail."
    );
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(text: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    console.warn(
      "ENCRYPTION_KEY is not set. Decryption will not be performed."
    );
    return text;
  }
  if (ENCRYPTION_KEY.length !== 32) {
    console.warn(
      "ENCRYPTION_KEY is not 32 bytes. Decryption might be weak or fail."
    );
  }
  try {
    const parts = text.split(":");
    if (parts.length !== 2)
      throw new Error("Invalid encrypted text format (no IV)");
    const iv = Buffer.from(parts.shift()!, "hex");
    const encryptedText = Buffer.from(parts.join(":"), "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error("Decryption failed:", error);
    return ""; // Atau throw error;
  }
}
