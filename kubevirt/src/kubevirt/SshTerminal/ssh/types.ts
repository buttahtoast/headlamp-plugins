/**
 * SSH Protocol Types
 */

export interface SSHClientOptions {
  username: string;
  password?: string;
  privateKey?: string;
  onData: (data: string) => void;
  onError: (error: string) => void;
  onReady: () => void;
  onClose: () => void;
}

export interface SSHTransport {
  connect: () => void;
  disconnect: () => void;
  send: (data: Uint8Array) => void;
  isConnected: () => boolean;
}

// SSH Message Types
export const SSH_MSG = {
  DISCONNECT: 1,
  IGNORE: 2,
  UNIMPLEMENTED: 3,
  DEBUG: 4,
  SERVICE_REQUEST: 5,
  SERVICE_ACCEPT: 6,
  KEXINIT: 20,
  NEWKEYS: 21,
  KEXDH_INIT: 30,
  KEXDH_REPLY: 31,
  USERAUTH_REQUEST: 50,
  USERAUTH_FAILURE: 51,
  USERAUTH_SUCCESS: 52,
  USERAUTH_BANNER: 53,
  GLOBAL_REQUEST: 80,
  REQUEST_SUCCESS: 81,
  REQUEST_FAILURE: 82,
  CHANNEL_OPEN: 90,
  CHANNEL_OPEN_CONFIRMATION: 91,
  CHANNEL_OPEN_FAILURE: 92,
  CHANNEL_WINDOW_ADJUST: 93,
  CHANNEL_DATA: 94,
  CHANNEL_EXTENDED_DATA: 95,
  CHANNEL_EOF: 96,
  CHANNEL_CLOSE: 97,
  CHANNEL_REQUEST: 98,
  CHANNEL_SUCCESS: 99,
  CHANNEL_FAILURE: 100,
} as const;

// Key exchange algorithms we support (only NIST curves via Web Crypto API)
export const KEX_ALGORITHMS = [
  'ecdh-sha2-nistp256', // Primary - uses P-256 curve
  // Note: curve25519 and DH groups are not supported by Web Crypto API
];

// Host key algorithms (we accept all common types, verification is basic)
export const HOST_KEY_ALGORITHMS = [
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-256',
  'rsa-sha2-512',
  'ssh-rsa',
  'ssh-ed25519',
];

// Encryption algorithms (only AES-CTR supported via Web Crypto API)
export const ENCRYPTION_ALGORITHMS = [
  'aes256-ctr',
  'aes128-ctr',
];

// MAC algorithms (HMAC-SHA2-256 via Web Crypto API)
export const MAC_ALGORITHMS = [
  'hmac-sha2-256',
];

// Compression algorithms
export const COMPRESSION_ALGORITHMS = [
  'none',
  'zlib@openssh.com',
];
