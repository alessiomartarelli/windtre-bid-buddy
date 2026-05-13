import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Cifratura simmetrica AES-256-GCM per segreti at-rest (es. password SMTP
 * salvata in `system_config`). La chiave viene derivata da `SMTP_SECRET_KEY`
 * via SHA-256 in modo da accettare stringhe di lunghezza arbitraria.
 *
 * Formato del valore cifrato: `enc:v1:<base64(iv|tag|ciphertext)>`.
 *  - iv: 12 byte (consigliato per GCM)
 *  - tag: 16 byte
 *  - ciphertext: lunghezza variabile
 */

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let warnedMissingKey = false;

export function getSecretKey(): Buffer | null {
  const raw = process.env.SMTP_SECRET_KEY;
  if (!raw || !raw.trim()) {
    if (!warnedMissingKey) {
      console.warn(
        "[crypto] SMTP_SECRET_KEY non configurata: la password SMTP nel DB non potrà essere cifrata/decifrata. " +
          "Verrà usata solo la configurazione da variabili d'ambiente.",
      );
      warnedMissingKey = true;
    }
    return null;
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const key = getSecretKey();
  if (!key) {
    throw new Error("SMTP_SECRET_KEY non configurata: impossibile cifrare il segreto");
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decifra un valore prodotto da `encryptSecret`. Ritorna `null` se il valore
 * è cifrato ma non si riesce a decifrarlo (chiave mancante o errata, payload
 * corrotto). Se il valore non ha il prefisso di cifratura viene ritornato così
 * com'è: utile per la transizione da password salvate in chiaro.
 */
export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  if (!value.startsWith(PREFIX)) return value;
  const key = getSecretKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), "base64");
    if (buf.length < IV_LEN + TAG_LEN + 1) {
      throw new Error("payload troppo corto");
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString("utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[crypto] decifratura segreto fallita: ${msg}`);
    return null;
  }
}
