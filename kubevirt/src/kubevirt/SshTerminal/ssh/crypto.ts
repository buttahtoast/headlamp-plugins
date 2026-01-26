/**
 * SSH Crypto utilities using Web Crypto API
 */

import { concatBuffers, randomBytes, SSHBuffer } from './buffer';

/**
 * Generate Diffie-Hellman key pair for key exchange
 * We use ECDH with P-256 curve (ecdh-sha2-nistp256)
 */
export async function generateECDHKeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveBits']
  );

  // Export public key in uncompressed format (0x04 || x || y)
  const rawPublic = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return {
    publicKey: new Uint8Array(rawPublic),
    privateKey: keyPair.privateKey,
  };
}

/**
 * Derive shared secret from ECDH key exchange
 */
export async function deriveECDHSecret(
  privateKey: CryptoKey,
  serverPublicKeyBytes: Uint8Array
): Promise<Uint8Array> {
  // Import the server's public key
  const serverPublicKey = await crypto.subtle.importKey(
    'raw',
    serverPublicKeyBytes,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false,
    []
  );

  // Derive the shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: serverPublicKey,
    },
    privateKey,
    256 // 32 bytes for P-256
  );

  return new Uint8Array(sharedBits);
}

/**
 * Compute SHA-256 hash
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

/**
 * Compute SHA-1 hash
 */
export async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-1', data);
  return new Uint8Array(hash);
}

/**
 * Derive SSH keys from shared secret and exchange hash
 * Based on RFC 4253 Section 7.2
 */
export async function deriveKeys(
  sharedSecret: Uint8Array,
  exchangeHash: Uint8Array,
  sessionId: Uint8Array,
  keyLengths: { iv: number; key: number; mac: number }
): Promise<{
  ivClientToServer: Uint8Array;
  ivServerToClient: Uint8Array;
  keyClientToServer: Uint8Array;
  keyServerToClient: Uint8Array;
  macKeyClientToServer: Uint8Array;
  macKeyServerToClient: Uint8Array;
}> {
  // Format shared secret as mpint
  const kBuf = new SSHBuffer(sharedSecret.length + 10);
  kBuf.writeMPInt(sharedSecret);
  const K = kBuf.getData();

  async function deriveKey(letter: string, length: number): Promise<Uint8Array> {
    const letterByte = new TextEncoder().encode(letter);
    const input = concatBuffers(K, exchangeHash, letterByte, sessionId);
    let key = await sha256(input);

    // Extend key if needed
    while (key.length < length) {
      const extended = await sha256(concatBuffers(K, exchangeHash, key));
      key = concatBuffers(key, extended);
    }

    return key.slice(0, length);
  }

  return {
    ivClientToServer: await deriveKey('A', keyLengths.iv),
    ivServerToClient: await deriveKey('B', keyLengths.iv),
    keyClientToServer: await deriveKey('C', keyLengths.key),
    keyServerToClient: await deriveKey('D', keyLengths.key),
    macKeyClientToServer: await deriveKey('E', keyLengths.mac),
    macKeyServerToClient: await deriveKey('F', keyLengths.mac),
  };
}

/**
 * AES-256-CTR encryption/decryption context
 */
export class AESCTRCipher {
  private key: CryptoKey | null = null;
  private counter: Uint8Array;

  constructor() {
    this.counter = new Uint8Array(16);
  }

  async init(key: Uint8Array, iv: Uint8Array): Promise<void> {
    this.key = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CTR' },
      false,
      ['encrypt', 'decrypt']
    );
    this.counter = iv.slice(0, 16);
  }

  async encrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.key) throw new Error('Cipher not initialized');

    const result = await crypto.subtle.encrypt(
      {
        name: 'AES-CTR',
        counter: this.counter,
        length: 128,
      },
      this.key,
      data
    );

    // Increment counter
    this.incrementCounter(Math.ceil(data.length / 16));

    return new Uint8Array(result);
  }

  async decrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.key) throw new Error('Cipher not initialized');

    const result = await crypto.subtle.decrypt(
      {
        name: 'AES-CTR',
        counter: this.counter,
        length: 128,
      },
      this.key,
      data
    );

    // Increment counter
    this.incrementCounter(Math.ceil(data.length / 16));

    return new Uint8Array(result);
  }

  private incrementCounter(blocks: number): void {
    for (let b = 0; b < blocks; b++) {
      // Increment 128-bit counter (big-endian)
      for (let i = 15; i >= 0; i--) {
        this.counter[i]++;
        if (this.counter[i] !== 0) break;
      }
    }
  }
}

/**
 * HMAC-SHA256 for packet authentication
 */
export class HMACSHA256 {
  private key: CryptoKey | null = null;

  async init(key: Uint8Array): Promise<void> {
    this.key = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  async compute(data: Uint8Array): Promise<Uint8Array> {
    if (!this.key) throw new Error('HMAC not initialized');
    const signature = await crypto.subtle.sign('HMAC', this.key, data);
    return new Uint8Array(signature);
  }

  async verify(data: Uint8Array, mac: Uint8Array): Promise<boolean> {
    if (!this.key) throw new Error('HMAC not initialized');
    return await crypto.subtle.verify('HMAC', this.key, mac, data);
  }
}

/**
 * Generate 16 random bytes for SSH cookie
 */
export function generateCookie(): Uint8Array {
  return randomBytes(16);
}

/**
 * Parse an ECDSA signature from SSH format
 */
export function parseECDSASignature(signature: Uint8Array): Uint8Array {
  const buf = SSHBuffer.from(signature);
  const r = buf.readMPInt();
  const s = buf.readMPInt();

  // Convert to fixed-length format for Web Crypto (P-256 uses 32 bytes each)
  const rPadded = padTo32Bytes(r);
  const sPadded = padTo32Bytes(s);

  return concatBuffers(rPadded, sPadded);
}

function padTo32Bytes(data: Uint8Array): Uint8Array {
  if (data.length === 32) return data;
  if (data.length > 32) return data.slice(data.length - 32);
  const padded = new Uint8Array(32);
  padded.set(data, 32 - data.length);
  return padded;
}

/**
 * Verify an ECDSA signature
 */
export async function verifyECDSASignature(
  publicKeyBlob: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
  curve: string = 'P-256'
): Promise<boolean> {
  try {
    // Parse the public key blob (SSH format)
    const keyBuf = SSHBuffer.from(publicKeyBlob);
    keyBuf.readStringAsString(); // keyType - not used but must be read
    keyBuf.readStringAsString(); // curveName - not used but must be read
    const publicPoint = keyBuf.readString();

    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      'raw',
      publicPoint,
      {
        name: 'ECDSA',
        namedCurve: curve,
      },
      false,
      ['verify']
    );

    // Convert signature from SSH format
    const rawSig = parseECDSASignature(signature);

    // Verify
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      rawSig,
      data
    );
  } catch (e) {
    console.error('ECDSA verification error:', e);
    return false;
  }
}
