/**
 * MWT-4E — Authenticated Identity v0 (Local deterministic identity binding)
 *
 * Minimal trusted-identity slice for approval records. Binds `approver_id` to a
 * locally verifiable identity material (Ed25519 public key + fingerprint), so an
 * approval can be cryptographically attributed to its signer — not merely a free
 * string.
 *
 * Design constraints (MWT-4E scope gate):
 *   - No backend DB / schema / migration.
 *   - No external identity service / CA / PKI.
 *   - No global auth system.
 *   - Uses Web Crypto only (crypto.subtle) — identical in browser and Node 18+.
 *     No new dependency.
 *   - Deterministic + injectable so Node test scripts can assert without async crypto.
 *
 * The signing/verification core is pure and accepts an injected `signFn`/`verifyFn`
 * (mirrors the MWT-5 approval-record pattern: buildApprovalRecordSync + hashFn).
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Local identity descriptor. The public half is what gets embedded in records. */
export interface IdentityDescriptor {
  /** Stable local id, e.g. "local:pm:01". Free string but should be stable. */
  id: string;
  /** Public-key fingerprint (sha256 of exported spki, hex). Binds approver_id. */
  public_key_fingerprint: string;
  /** Signing algorithm. v0 uses Ed25519. */
  algo: "Ed25519";
  /** ISO-8601 creation time (pinned in tests for determinism). */
  created_at: string;
}

/** Exported key pair material (private half kept local; never embedded in records). */
export interface IdentityKeyPair {
  descriptor: IdentityDescriptor;
  /** Exported private key (pkcs8, base64url). Local-only. */
  private_key_pem: string;
  /** Exported public key (spki, base64url). Embedded fingerprint source. */
  public_key_pem: string;
}

/** A signature envelope attached to an approval record (public, verifiable). */
export interface ApprovalSignatureEnvelope {
  signer_id: string;
  public_key_fingerprint: string;
  algo: "Ed25519";
  /** Base64url signature over the record's canonical body. */
  signature: string;
}

// ── Base64url helpers (deterministic, no dependency) ─────────────────────────

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── SHA-256 (Web Crypto) ─────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Key generation (real runtime path; async via Web Crypto) ─────────────────

/**
 * Generate a fresh Ed25519 identity. Real path used by the identity bootstrap.
 * Private key stays local; only the descriptor (with fingerprint) is shared.
 */
export async function generateIdentity(
  id: string,
  created_at: string,
): Promise<IdentityKeyPair> {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const privateKeyPem = bytesToB64url(
    new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  );
  const publicKeyPem = bytesToB64url(
    new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
  );
  const public_key_fingerprint = await sha256Hex(publicKeyPem);
  return {
    descriptor: { id, public_key_fingerprint, algo: "Ed25519", created_at },
    private_key_pem: privateKeyPem,
    public_key_pem: publicKeyPem,
  };
}

// ── Sync core (injectable, for deterministic Node tests) ─────────────────────

/**
 * Derive a descriptor from a known public key pem + id (no private key needed).
 * Used when loading an identity whose private key is unavailable (verify-only).
 */
export function descriptorFromPublicKeyPem(
  id: string,
  publicKeyPem: string,
  created_at: string,
  hashFn: (input: string) => string,
): IdentityDescriptor {
  return {
    id,
    public_key_fingerprint: hashFn(publicKeyPem),
    algo: "Ed25519",
    created_at,
  };
}

/**
 * Sign a canonical body string with an Ed25519 private key (pkcs8 base64url).
 * Pure: accepts the crypto sign fn so tests can inject a deterministic stub.
 */
export async function signBody(
  privateKeyPem: string,
  body: string,
  signFn: (privKey: CryptoKey, data: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const privKey = await crypto.subtle.importKey(
    "pkcs8",
    b64urlToBytes(privateKeyPem) as BufferSource,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const sig = await signFn(privKey, new TextEncoder().encode(body));
  return bytesToB64url(sig);
}

/**
 * Verify a signature over a canonical body using a public key (spki base64url).
 * Pure: accepts the crypto verify fn so tests can inject a deterministic stub.
 */
export async function verifySignature(
  publicKeyPem: string,
  body: string,
  signatureB64url: string,
  verifyFn: (pubKey: CryptoKey, sig: Uint8Array, data: Uint8Array) => Promise<boolean>,
): Promise<boolean> {
  try {
    const pubKey = await crypto.subtle.importKey(
      "spki",
      b64urlToBytes(publicKeyPem) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await verifyFn(pubKey, b64urlToBytes(signatureB64url) as Uint8Array, new TextEncoder().encode(body));
  } catch {
    return false;
  }
}

/** Real Web Crypto Ed25519 sign fn. Returns Uint8Array (subtle.sign yields ArrayBuffer). */
export const webCryptoSign = (
  privKey: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> =>
  crypto.subtle.sign("Ed25519", privKey, data as BufferSource).then((buf) => new Uint8Array(buf));

/** Real Web Crypto Ed25519 verify fn. */
export const webCryptoVerify = (
  pubKey: CryptoKey,
  sig: Uint8Array,
  data: Uint8Array,
): Promise<boolean> =>
  crypto.subtle.verify("Ed25519", pubKey, sig as BufferSource, data as BufferSource);
