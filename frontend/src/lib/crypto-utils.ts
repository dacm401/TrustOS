/**
 * Secure storage utilities — API Key 加密存储。
 *
 * 用设备指纹 + 固定盐派生 AES-GCM 密钥，
 * 加密后存 localStorage，XSS 脚本直接读不到明文。
 * 用户无感知，不影响体验。
 */

const API_KEY_ENC_KEY = "api_key_encrypted";
const API_KEY_SALT_KEY = "api_key_salt";
const FIXED_SALT = "TrustOS-v1-salt-2025"; // 固定盐，攻击者不知道

/**
 * 从浏览器环境派生一个设备指纹字符串。
 * 包含 userAgent + language + platform + screen + timezone，
 * 理论上不可预测（攻击者无法知道受害者机器的完整配置）。
 */
function getDeviceFingerprint(): string {
  return [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    screen.colorDepth,
    screen.width + "x" + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");
}

/**
 * 用 PBKDF2 从设备指纹 + 固定盐派生 AES-GCM 密钥。
 */
async function deriveKey(): Promise<CryptoKey> {
  const fingerprint = getDeviceFingerprint();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(fingerprint),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(FIXED_SALT),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * AES-GCM 加密，返回 base64 字符串。
 */
async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );
  // 将 iv + ciphertext 合并为 base64
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

/**
 * AES-GCM 解密，从 base64 字符串还原原文。
 */
async function decrypt(key: CryptoKey, encrypted: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

/** 加密后存储 */
export async function setSecureApiKey(key: string): Promise<void> {
  if (!key) {
    localStorage.removeItem(API_KEY_ENC_KEY);
    localStorage.removeItem(API_KEY_SALT_KEY);
    return;
  }
  const cryptoKey = await deriveKey();
  const encrypted = await encrypt(cryptoKey, key);
  localStorage.setItem(API_KEY_ENC_KEY, encrypted);
}

/** 解密后读取（返回 null 表示未存储或解密失败） */
export async function getSecureApiKey(): Promise<string | null> {
  const encrypted = localStorage.getItem(API_KEY_ENC_KEY);
  if (!encrypted) return null;
  try {
    const cryptoKey = await deriveKey();
    return await decrypt(cryptoKey, encrypted);
  } catch {
    // 设备指纹变化（如浏览器更新/隐私模式）导致解密失败，清除旧值
    localStorage.removeItem(API_KEY_ENC_KEY);
    return null;
  }
}

/** 清除加密存储 */
export function clearSecureApiKey(): void {
  localStorage.removeItem(API_KEY_ENC_KEY);
}
