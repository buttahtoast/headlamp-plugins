/**
 * SSH Client for browser-based SSH over WebSocket
 *
 * Implements SSH-2 protocol with:
 * - ecdh-sha2-nistp256 key exchange
 * - aes256-ctr encryption
 * - hmac-sha2-256 MAC
 * - password authentication
 */

import { concatBuffers, randomBytes, SSHBuffer } from './buffer';
import {
  AESCTRCipher,
  deriveECDHSecret,
  deriveKeys,
  generateCookie,
  generateECDHKeyPair,
  HMACSHA256,
  sha256,
} from './crypto';
import {
  COMPRESSION_ALGORITHMS,
  ENCRYPTION_ALGORITHMS,
  HOST_KEY_ALGORITHMS,
  KEX_ALGORITHMS,
  MAC_ALGORITHMS,
  SSH_MSG,
  SSHClientOptions,
} from './types';

const SSH_VERSION = 'SSH-2.0-WebSSHClient_1.0';

enum SSHState {
  INIT,
  VERSION_EXCHANGED,
  KEX_INIT_SENT,
  KEX_DH_SENT,
  NEWKEYS_SENT,
  AUTHENTICATED,
  CHANNEL_OPEN,
  READY,
  CLOSED,
}

export class SSHClient {
  private options: SSHClientOptions;
  private state: SSHState = SSHState.INIT;
  private socket: WebSocket | null = null;

  // Version exchange
  private clientVersion: string = SSH_VERSION;
  private serverVersion: string = '';

  // Key exchange state
  private clientKexPayload: Uint8Array = new Uint8Array(0);
  private serverKexPayload: Uint8Array = new Uint8Array(0);
  private ecdhPrivateKey: CryptoKey | null = null;
  private ecdhPublicKey: Uint8Array = new Uint8Array(0);
  private serverHostKey: Uint8Array = new Uint8Array(0);
  private serverECDHPublicKey: Uint8Array = new Uint8Array(0);
  private sharedSecret: Uint8Array = new Uint8Array(0);
  private exchangeHash: Uint8Array = new Uint8Array(0);
  private sessionId: Uint8Array = new Uint8Array(0);

  // Encryption state
  private encryptCipher: AESCTRCipher | null = null;
  private decryptCipher: AESCTRCipher | null = null;
  private encryptMAC: HMACSHA256 | null = null;
  private decryptMAC: HMACSHA256 | null = null;
  private encryptEnabled: boolean = false;
  private decryptEnabled: boolean = false;

  // Negotiated algorithms
  private negotiatedEncryption: string = 'aes256-ctr';
  private encryptionKeySize: number = 32; // Default for AES-256

  // Packet sequence numbers
  private sendSeq: number = 0;
  private recvSeq: number = 0;

  // Receive buffer for partial packets
  private recvBuffer: Uint8Array = new Uint8Array(0);
  private versionReceived: boolean = false;

  // Channel state
  private channelId: number = 0;
  private remoteChannelId: number = 0;
  private windowSize: number = 2097152; // 2MB
  private maxPacketSize: number = 32768;

  constructor(options: SSHClientOptions) {
    this.options = options;
  }

  /**
   * Connect to SSH server via WebSocket
   * The WebSocket can be either already open or will open shortly
   */
  connect(socket: WebSocket): void {
    this.socket = socket;
    this.socket.binaryType = 'arraybuffer';

    this.socket.onmessage = (event) => {
      this.handleData(new Uint8Array(event.data));
    };

    this.socket.onerror = (event) => {
      console.error('[SSH] WebSocket error:', event);
      this.options.onError('WebSocket connection error');
    };

    this.socket.onclose = () => {
      console.log('[SSH] WebSocket closed');
      this.state = SSHState.CLOSED;
      this.options.onClose();
    };

    // If socket is already open, start the SSH handshake immediately
    if (socket.readyState === WebSocket.OPEN) {
      console.log('[SSH] WebSocket already connected');
      this.sendVersion();
    } else {
      // Otherwise wait for it to open
      this.socket.onopen = () => {
        console.log('[SSH] WebSocket connected');
        this.sendVersion();
      };
    }
  }

  /**
   * Send data to the server (for terminal input)
   */
  sendData(data: string): void {
    if (this.state !== SSHState.READY || this.channelId === 0) {
      console.warn('[SSH] Cannot send data - not ready');
      return;
    }

    const dataBytes = new TextEncoder().encode(data);
    const buf = new SSHBuffer(dataBytes.length + 20);
    buf.writeByte(SSH_MSG.CHANNEL_DATA);
    buf.writeUInt32(this.remoteChannelId);
    buf.writeString(dataBytes);
    this.sendPacket(buf.getData());
  }

  /**
   * Resize terminal
   */
  resizeTerminal(cols: number, rows: number): void {
    if (this.state !== SSHState.READY || this.channelId === 0) return;

    const buf = new SSHBuffer(50);
    buf.writeByte(SSH_MSG.CHANNEL_REQUEST);
    buf.writeUInt32(this.remoteChannelId);
    buf.writeString('window-change');
    buf.writeBoolean(false); // don't want reply
    buf.writeUInt32(cols);
    buf.writeUInt32(rows);
    buf.writeUInt32(0); // pixel width
    buf.writeUInt32(0); // pixel height
    this.sendPacket(buf.getData());
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Send disconnect message
      const buf = new SSHBuffer(20);
      buf.writeByte(SSH_MSG.DISCONNECT);
      buf.writeUInt32(11); // SSH_DISCONNECT_BY_APPLICATION
      buf.writeString('User disconnect');
      buf.writeString(''); // language tag
      this.sendPacket(buf.getData());
      this.socket.close();
    }
    this.state = SSHState.CLOSED;
  }

  // ============ Protocol Implementation ============

  private sendVersion(): void {
    console.log('[SSH] Sending version:', this.clientVersion);
    const versionLine = this.clientVersion + '\r\n';
    this.sendRaw(new TextEncoder().encode(versionLine));
    this.state = SSHState.VERSION_EXCHANGED;
  }

  private handleData(data: Uint8Array): void {
    // Append to receive buffer
    this.recvBuffer = concatBuffers(this.recvBuffer, data);

    // First, handle version exchange
    if (!this.versionReceived) {
      this.handleVersionExchange();
      return;
    }

    // Process complete packets
    this.processPackets();
  }

  private async processPackets(): Promise<void> {
    while (await this.processPacket()) {
      // Continue processing
    }
  }

  private handleVersionExchange(): void {
    // Look for version line ending with \r\n or \n
    const decoder = new TextDecoder();
    const text = decoder.decode(this.recvBuffer);
    const lineEnd = text.indexOf('\n');

    if (lineEnd === -1) return; // Wait for more data

    // Extract version line
    let version = text.substring(0, lineEnd);
    if (version.endsWith('\r')) {
      version = version.substring(0, version.length - 1);
    }

    // Remove version line from buffer
    this.recvBuffer = this.recvBuffer.slice(lineEnd + 1);

    // Check if it's an SSH version
    if (version.startsWith('SSH-')) {
      this.serverVersion = version;
      this.versionReceived = true;
      console.log('[SSH] Server version:', this.serverVersion);

      // Start key exchange
      this.sendKexInit();
    } else {
      // Could be a banner line before SSH version
      console.log('[SSH] Pre-version banner:', version);
      // Try to find more lines
      this.handleVersionExchange();
    }
  }

  private async processPacket(): Promise<boolean> {
    if (this.recvBuffer.length < 5) return false;

    let packetData: Uint8Array;
    let payloadStart: number;
    let payloadLength: number;

    if (this.decryptEnabled && this.decryptCipher) {
      // Encrypted packet
      // First decrypt the length field
      // We need to decrypt incrementally to get the length
      // For now, we'll read the minimum packet size and check MAC

      // Minimum packet: 4 (length) + 1 (padding length) + 4 (min padding) = 9 bytes
      // Plus MAC (32 bytes for hmac-sha2-256)
      const minSize = 4 + 16 + 32; // block + MAC
      if (this.recvBuffer.length < minSize) return false;

      // We need to handle encrypted packets differently
      // The length is encrypted in the first block
      return await this.processEncryptedPacket();
    } else {
      // Unencrypted packet
      const view = new DataView(
        this.recvBuffer.buffer,
        this.recvBuffer.byteOffset,
        this.recvBuffer.byteLength
      );
      const packetLength = view.getUint32(0, false);

      // Total packet size = 4 (length field) + packet_length
      const totalLength = 4 + packetLength;
      if (this.recvBuffer.length < totalLength) return false;

      packetData = this.recvBuffer.slice(0, totalLength);
      this.recvBuffer = this.recvBuffer.slice(totalLength);

      const paddingLength = packetData[4];
      payloadStart = 5;
      payloadLength = packetLength - paddingLength - 1;
    }

    // Extract payload
    const payload = packetData.slice(payloadStart, payloadStart + payloadLength);

    // Update sequence number
    this.recvSeq++;

    // Handle the packet
    this.handlePacket(payload);
    return true;
  }

  // State for encrypted packet processing - we need to preserve the decrypted first block
  // when we don't have the full packet yet
  private pendingFirstBlock: Uint8Array | null = null;
  private pendingPacketLength: number = 0;

  private async processEncryptedPacket(): Promise<boolean> {
    if (!this.decryptCipher || !this.decryptMAC) return false;

    const blockSize = 16;
    const macLength = 32; // HMAC-SHA256

    // If we haven't decrypted the first block yet, do it now
    if (this.pendingFirstBlock === null) {
      if (this.recvBuffer.length < blockSize) return false;

      // Decrypt first block to get length
      const firstBlock = this.recvBuffer.slice(0, blockSize);
      this.pendingFirstBlock = await this.decryptCipher.decrypt(firstBlock);

      const view = new DataView(
        this.pendingFirstBlock.buffer,
        this.pendingFirstBlock.byteOffset,
        this.pendingFirstBlock.byteLength
      );
      this.pendingPacketLength = view.getUint32(0, false);
    }

    const totalEncryptedLength = 4 + this.pendingPacketLength;
    // Round up to block size
    const roundedLength = Math.ceil(totalEncryptedLength / blockSize) * blockSize;
    const totalWithMac = roundedLength + macLength;

    if (this.recvBuffer.length < totalWithMac) {
      // Wait for more data - we've already decrypted and saved the first block
      return false;
    }

    // We have the full packet - decrypt the rest
    const encryptedPacket = this.recvBuffer.slice(0, roundedLength);
    const mac = this.recvBuffer.slice(roundedLength, roundedLength + macLength);

    // Decrypt remaining blocks (first block is already decrypted)
    let fullDecrypted: Uint8Array;
    if (roundedLength > blockSize) {
      const decryptedRest = await this.decryptCipher.decrypt(encryptedPacket.slice(blockSize));
      fullDecrypted = concatBuffers(this.pendingFirstBlock, decryptedRest);
    } else {
      fullDecrypted = this.pendingFirstBlock;
    }

    // Verify MAC (computed over sequence number + decrypted packet data)
    const seqBuf = new SSHBuffer(4);
    seqBuf.writeUInt32(this.recvSeq);

    const macInput = concatBuffers(seqBuf.getData(), fullDecrypted.slice(0, totalEncryptedLength));
    const computedMac = await this.decryptMAC.compute(macInput);

    // Compare MACs (constant-time comparison)
    let macValid = true;
    for (let i = 0; i < macLength; i++) {
      if (mac[i] !== computedMac[i]) {
        macValid = false;
        // Don't break early - constant time comparison
      }
    }

    if (!macValid) {
      console.error('[SSH] MAC verification failed');
      this.options.onError('MAC verification failed - connection may be compromised');
      this.disconnect();
      // Clear pending state
      this.pendingFirstBlock = null;
      this.pendingPacketLength = 0;
      return false;
    }

    // Remove packet from buffer
    this.recvBuffer = this.recvBuffer.slice(totalWithMac);

    // Extract payload before clearing pending state
    const paddingLength = fullDecrypted[4];
    const packetLen = this.pendingPacketLength;
    const payloadLength = packetLen - paddingLength - 1;
    const payload = fullDecrypted.slice(5, 5 + payloadLength);

    // Clear pending state for next packet
    this.pendingFirstBlock = null;
    this.pendingPacketLength = 0;

    // Update sequence number
    this.recvSeq++;

    // Handle the packet
    this.handlePacket(payload);
    return true;
  }

  private handlePacket(payload: Uint8Array): void {
    if (payload.length === 0) return;

    const msgType = payload[0];
    const data = payload.slice(1);

    console.log('[SSH] Received message type:', msgType);

    switch (msgType) {
      case SSH_MSG.KEXINIT:
        this.handleKexInit(data);
        break;
      case SSH_MSG.KEXDH_REPLY:
        this.handleKexDHReply(data);
        break;
      case SSH_MSG.NEWKEYS:
        this.handleNewKeys();
        break;
      case SSH_MSG.SERVICE_ACCEPT:
        this.handleServiceAccept(data);
        break;
      case SSH_MSG.USERAUTH_SUCCESS:
        this.handleAuthSuccess();
        break;
      case SSH_MSG.USERAUTH_FAILURE:
        this.handleAuthFailure(data);
        break;
      case SSH_MSG.USERAUTH_BANNER:
        this.handleAuthBanner(data);
        break;
      case SSH_MSG.CHANNEL_OPEN_CONFIRMATION:
        this.handleChannelOpenConfirmation(data);
        break;
      case SSH_MSG.CHANNEL_OPEN_FAILURE:
        this.handleChannelOpenFailure(data);
        break;
      case SSH_MSG.CHANNEL_DATA:
        this.handleChannelData(data);
        break;
      case SSH_MSG.CHANNEL_EXTENDED_DATA:
        this.handleChannelExtendedData(data);
        break;
      case SSH_MSG.CHANNEL_WINDOW_ADJUST:
        this.handleWindowAdjust(data);
        break;
      case SSH_MSG.CHANNEL_REQUEST:
        this.handleChannelRequest(data);
        break;
      case SSH_MSG.CHANNEL_SUCCESS:
        this.handleChannelSuccess();
        break;
      case SSH_MSG.CHANNEL_FAILURE:
        this.handleChannelFailure();
        break;
      case SSH_MSG.CHANNEL_EOF:
        this.handleChannelEOF();
        break;
      case SSH_MSG.CHANNEL_CLOSE:
        this.handleChannelClose();
        break;
      case SSH_MSG.DISCONNECT:
        this.handleDisconnect(data);
        break;
      case SSH_MSG.DEBUG:
        // Ignore debug messages
        break;
      case SSH_MSG.IGNORE:
        // Ignore
        break;
      default:
        console.warn('[SSH] Unhandled message type:', msgType);
    }
  }

  private sendKexInit(): void {
    console.log('[SSH] Sending KEXINIT');

    const buf = new SSHBuffer(1024);
    buf.writeByte(SSH_MSG.KEXINIT);
    buf.writeBytes(generateCookie());
    buf.writeNameList(KEX_ALGORITHMS);
    buf.writeNameList(HOST_KEY_ALGORITHMS);
    buf.writeNameList(ENCRYPTION_ALGORITHMS);
    buf.writeNameList(ENCRYPTION_ALGORITHMS);
    buf.writeNameList(MAC_ALGORITHMS);
    buf.writeNameList(MAC_ALGORITHMS);
    buf.writeNameList(COMPRESSION_ALGORITHMS);
    buf.writeNameList(COMPRESSION_ALGORITHMS);
    buf.writeNameList([]); // languages client->server
    buf.writeNameList([]); // languages server->client
    buf.writeBoolean(false); // first_kex_packet_follows
    buf.writeUInt32(0); // reserved

    this.clientKexPayload = buf.getData();
    this.sendPacket(this.clientKexPayload);
    this.state = SSHState.KEX_INIT_SENT;
  }

  private handleKexInit(data: Uint8Array): void {
    console.log('[SSH] Received KEXINIT');

    // Store server's KEXINIT payload (including message type byte)
    this.serverKexPayload = concatBuffers(new Uint8Array([SSH_MSG.KEXINIT]), data);

    // Parse server's algorithms
    const buf = SSHBuffer.from(data);
    buf.readBytes(16); // Skip cookie

    const serverKexAlgs = buf.readNameList();
    buf.readNameList(); // serverHostKeyAlgs - not used but must be read
    const serverEncAlgsCS = buf.readNameList();
    buf.readNameList(); // serverEncAlgsSC - not used but must be read
    const serverMacAlgsCS = buf.readNameList();
    buf.readNameList(); // serverMacAlgsSC - not used but must be read

    console.log('[SSH] Server KEX algorithms:', serverKexAlgs);
    console.log('[SSH] Server encryption algorithms:', serverEncAlgsCS);

    // Check for required KEX algorithm
    if (!serverKexAlgs.includes('ecdh-sha2-nistp256')) {
      this.options.onError('Server does not support ecdh-sha2-nistp256 key exchange');
      this.disconnect();
      return;
    }

    // Negotiate encryption algorithm (client preference)
    const clientEncAlgs = ENCRYPTION_ALGORITHMS;
    for (const alg of clientEncAlgs) {
      if (serverEncAlgsCS.includes(alg)) {
        this.negotiatedEncryption = alg;
        break;
      }
    }

    // Set key size based on negotiated algorithm
    if (this.negotiatedEncryption === 'aes128-ctr') {
      this.encryptionKeySize = 16;
    } else {
      this.encryptionKeySize = 32; // Default for aes256-ctr
    }

    console.log('[SSH] Negotiated encryption:', this.negotiatedEncryption, 'key size:', this.encryptionKeySize);

    // Check MAC algorithm
    if (!serverMacAlgsCS.includes('hmac-sha2-256')) {
      this.options.onError('Server does not support hmac-sha2-256 MAC');
      this.disconnect();
      return;
    }

    // Start ECDH key exchange
    this.startECDHKeyExchange();
  }

  private async startECDHKeyExchange(): Promise<void> {
    console.log('[SSH] Starting ECDH key exchange');

    // Generate ECDH key pair
    const { publicKey, privateKey } = await generateECDHKeyPair();
    this.ecdhPublicKey = publicKey;
    this.ecdhPrivateKey = privateKey;

    // Send KEX_ECDH_INIT (message type 30)
    const buf = new SSHBuffer(publicKey.length + 10);
    buf.writeByte(SSH_MSG.KEXDH_INIT); // KEX_ECDH_INIT uses the same code as KEXDH_INIT
    buf.writeString(publicKey); // Q_C (client's ephemeral public key)

    this.sendPacket(buf.getData());
    this.state = SSHState.KEX_DH_SENT;
  }

  private async handleKexDHReply(data: Uint8Array): Promise<void> {
    console.log('[SSH] Received KEX_ECDH_REPLY');

    const buf = SSHBuffer.from(data);

    // Parse reply
    this.serverHostKey = buf.readString(); // K_S (server's public host key)
    this.serverECDHPublicKey = buf.readString(); // Q_S (server's ephemeral public key)
    buf.readString(); // Signature of H - not verified (host key verification not implemented)

    console.log('[SSH] Server host key length:', this.serverHostKey.length);
    console.log('[SSH] Server ECDH public key length:', this.serverECDHPublicKey.length);

    // Derive shared secret
    try {
      this.sharedSecret = await deriveECDHSecret(this.ecdhPrivateKey!, this.serverECDHPublicKey);
      console.log('[SSH] Shared secret derived, length:', this.sharedSecret.length);
    } catch (e) {
      console.error('[SSH] Failed to derive shared secret:', e);
      this.options.onError('Key exchange failed');
      this.disconnect();
      return;
    }

    // Compute exchange hash H
    this.exchangeHash = await this.computeExchangeHash();
    console.log('[SSH] Exchange hash computed');

    // The first exchange hash becomes the session ID
    if (this.sessionId.length === 0) {
      this.sessionId = this.exchangeHash;
    }

    // TODO: Verify host key signature
    // For now, we'll skip verification (accept any host key)
    console.log('[SSH] Host key verification skipped (not implemented)');

    // Send NEWKEYS
    this.sendNewKeys();
  }

  private async computeExchangeHash(): Promise<Uint8Array> {
    // H = hash(V_C || V_S || I_C || I_S || K_S || Q_C || Q_S || K)
    const buf = new SSHBuffer(4096);

    // V_C: client version string (without CR LF)
    buf.writeString(this.clientVersion);

    // V_S: server version string (without CR LF)
    buf.writeString(this.serverVersion);

    // I_C: client's KEXINIT payload
    buf.writeString(this.clientKexPayload);

    // I_S: server's KEXINIT payload
    buf.writeString(this.serverKexPayload);

    // K_S: server's public host key
    buf.writeString(this.serverHostKey);

    // Q_C: client's ephemeral public key
    buf.writeString(this.ecdhPublicKey);

    // Q_S: server's ephemeral public key
    buf.writeString(this.serverECDHPublicKey);

    // K: shared secret (as mpint)
    buf.writeMPInt(this.sharedSecret);

    return await sha256(buf.getData());
  }

  private sendNewKeys(): void {
    console.log('[SSH] Sending NEWKEYS');
    const buf = new SSHBuffer(1);
    buf.writeByte(SSH_MSG.NEWKEYS);
    this.sendPacket(buf.getData());
    this.state = SSHState.NEWKEYS_SENT;
  }

  private async handleNewKeys(): Promise<void> {
    console.log('[SSH] Received NEWKEYS');

    // Enable encryption
    try {
      const keys = await deriveKeys(this.sharedSecret, this.exchangeHash, this.sessionId, {
        iv: 16, // AES block size
        key: this.encryptionKeySize, // Based on negotiated algorithm
        mac: 32, // HMAC-SHA256
      });

      // Initialize encryption
      this.encryptCipher = new AESCTRCipher();
      await this.encryptCipher.init(keys.keyClientToServer, keys.ivClientToServer);

      this.decryptCipher = new AESCTRCipher();
      await this.decryptCipher.init(keys.keyServerToClient, keys.ivServerToClient);

      this.encryptMAC = new HMACSHA256();
      await this.encryptMAC.init(keys.macKeyClientToServer);

      this.decryptMAC = new HMACSHA256();
      await this.decryptMAC.init(keys.macKeyServerToClient);

      this.encryptEnabled = true;
      this.decryptEnabled = true;

      console.log('[SSH] Encryption enabled');

      // Request authentication service
      this.requestAuthService();
    } catch (e) {
      console.error('[SSH] Failed to initialize encryption:', e);
      this.options.onError('Encryption initialization failed');
      this.disconnect();
    }
  }

  private requestAuthService(): void {
    console.log('[SSH] Requesting ssh-userauth service');
    const buf = new SSHBuffer(50);
    buf.writeByte(SSH_MSG.SERVICE_REQUEST);
    buf.writeString('ssh-userauth');
    this.sendPacket(buf.getData());
  }

  private handleServiceAccept(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    const serviceName = buf.readStringAsString();
    console.log('[SSH] Service accepted:', serviceName);

    if (serviceName === 'ssh-userauth') {
      // Send authentication request
      this.sendAuthRequest();
    }
  }

  private sendAuthRequest(): void {
    console.log('[SSH] Sending password authentication');

    const buf = new SSHBuffer(200);
    buf.writeByte(SSH_MSG.USERAUTH_REQUEST);
    buf.writeString(this.options.username);
    buf.writeString('ssh-connection');
    buf.writeString('password');
    buf.writeBoolean(false); // not changing password
    buf.writeString(this.options.password || '');

    this.sendPacket(buf.getData());
  }

  private handleAuthSuccess(): void {
    console.log('[SSH] Authentication successful');
    this.state = SSHState.AUTHENTICATED;

    // Open a session channel
    this.openSessionChannel();
  }

  private handleAuthFailure(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    const methods = buf.readNameList();
    buf.readBoolean(); // partialSuccess - not used

    console.log('[SSH] Authentication failed. Available methods:', methods);
    this.options.onError(`Authentication failed. Available methods: ${methods.join(', ')}`);
  }

  private handleAuthBanner(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    const message = buf.readStringAsString();
    console.log('[SSH] Auth banner:', message);
    this.options.onData(message);
  }

  private openSessionChannel(): void {
    console.log('[SSH] Opening session channel');

    this.channelId = 0; // Our local channel ID

    const buf = new SSHBuffer(100);
    buf.writeByte(SSH_MSG.CHANNEL_OPEN);
    buf.writeString('session');
    buf.writeUInt32(this.channelId); // sender channel
    buf.writeUInt32(this.windowSize); // initial window size
    buf.writeUInt32(this.maxPacketSize); // maximum packet size

    this.sendPacket(buf.getData());
    this.state = SSHState.CHANNEL_OPEN;
  }

  private handleChannelOpenConfirmation(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    buf.readUInt32(); // recipientChannel - not used
    this.remoteChannelId = buf.readUInt32();
    buf.readUInt32(); // windowSize - not used (could be used for flow control)
    buf.readUInt32(); // maxPacketSize - not used

    console.log('[SSH] Channel opened. Remote channel:', this.remoteChannelId);

    // Request PTY
    this.requestPTY();
  }

  private handleChannelOpenFailure(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    buf.readUInt32(); // recipientChannel - not used
    const reasonCode = buf.readUInt32();
    const description = buf.readStringAsString();

    console.error('[SSH] Channel open failed:', reasonCode, description);
    this.options.onError(`Failed to open channel: ${description}`);
  }

  private requestPTY(): void {
    console.log('[SSH] Requesting PTY');

    const buf = new SSHBuffer(100);
    buf.writeByte(SSH_MSG.CHANNEL_REQUEST);
    buf.writeUInt32(this.remoteChannelId);
    buf.writeString('pty-req');
    buf.writeBoolean(true); // want reply
    buf.writeString('xterm-256color');
    buf.writeUInt32(80); // columns
    buf.writeUInt32(24); // rows
    buf.writeUInt32(0); // pixel width
    buf.writeUInt32(0); // pixel height
    buf.writeString(''); // terminal modes (empty)

    this.sendPacket(buf.getData());
  }

  private requestShell(): void {
    console.log('[SSH] Requesting shell');

    const buf = new SSHBuffer(50);
    buf.writeByte(SSH_MSG.CHANNEL_REQUEST);
    buf.writeUInt32(this.remoteChannelId);
    buf.writeString('shell');
    buf.writeBoolean(true); // want reply

    this.sendPacket(buf.getData());
  }

  private handleChannelSuccess(): void {
    console.log('[SSH] Channel request succeeded');

    if (this.state === SSHState.CHANNEL_OPEN) {
      // PTY request succeeded, now request shell
      this.requestShell();
    } else {
      // Shell request succeeded
      this.state = SSHState.READY;
      console.log('[SSH] Shell ready');
      this.options.onReady();
    }
  }

  private handleChannelFailure(): void {
    console.error('[SSH] Channel request failed');
    this.options.onError('Channel request failed');
  }

  private handleChannelData(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    buf.readUInt32(); // recipientChannel - not used
    const channelData = buf.readString();

    // Decode and pass to callback
    const text = new TextDecoder().decode(channelData);
    this.options.onData(text);

    // Send window adjust if needed
    if (channelData.length > this.windowSize / 2) {
      this.sendWindowAdjust(channelData.length);
    }
  }

  private handleChannelExtendedData(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    buf.readUInt32(); // recipientChannel - not used
    buf.readUInt32(); // dataTypeCode - not used (usually 1 for stderr)
    const channelData = buf.readString();

    // Usually stderr (type 1)
    const text = new TextDecoder().decode(channelData);
    this.options.onData(text);
  }

  private handleWindowAdjust(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    buf.readUInt32(); // recipientChannel - not used
    buf.readUInt32(); // bytesToAdd - not used (should track send window)

    // Update our send window (currently not tracked)
  }

  private sendWindowAdjust(bytes: number): void {
    const buf = new SSHBuffer(20);
    buf.writeByte(SSH_MSG.CHANNEL_WINDOW_ADJUST);
    buf.writeUInt32(this.remoteChannelId);
    buf.writeUInt32(bytes);
    this.sendPacket(buf.getData());
  }

  private handleChannelRequest(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    const recipientChannel = buf.readUInt32();
    const requestType = buf.readStringAsString();
    const wantReply = buf.readBoolean();

    console.log('[SSH] Channel request:', requestType);

    if (wantReply) {
      // Send failure (we don't handle server-initiated requests)
      const reply = new SSHBuffer(5);
      reply.writeByte(SSH_MSG.CHANNEL_FAILURE);
      reply.writeUInt32(recipientChannel);
      this.sendPacket(reply.getData());
    }
  }

  private handleChannelEOF(): void {
    console.log('[SSH] Channel EOF');
  }

  private handleChannelClose(): void {
    console.log('[SSH] Channel closed by server');
    this.state = SSHState.CLOSED;
    this.options.onClose();
  }

  private handleDisconnect(data: Uint8Array): void {
    const buf = SSHBuffer.from(data);
    const reasonCode = buf.readUInt32();
    const description = buf.readStringAsString();

    console.log('[SSH] Disconnected:', reasonCode, description);
    this.state = SSHState.CLOSED;
    this.options.onError(`Disconnected: ${description}`);
    this.options.onClose();
  }

  // ============ Packet Handling ============

  private sendRaw(data: Uint8Array): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  private async sendPacket(payload: Uint8Array): Promise<void> {
    // Minimum padding is 4 bytes, must pad to 8 bytes (or cipher block size)
    const blockSize = this.encryptEnabled ? 16 : 8;
    const minPadding = 4;

    // Calculate padding needed
    // Packet format: uint32 length + byte padding_length + payload + padding
    const baseLength = 1 + payload.length; // padding_length + payload
    let paddingLength = blockSize - ((4 + baseLength) % blockSize);
    if (paddingLength < minPadding) {
      paddingLength += blockSize;
    }

    const packetLength = baseLength + paddingLength;

    // Build packet
    const packet = new SSHBuffer(4 + packetLength);
    packet.writeUInt32(packetLength);
    packet.writeByte(paddingLength);
    packet.writeBytes(payload);
    packet.writeBytes(randomBytes(paddingLength));

    const packetData = packet.getData();

    if (this.encryptEnabled && this.encryptCipher && this.encryptMAC) {
      // Compute MAC before encryption (encrypt-and-mac)
      // Actually SSH uses encrypt-then-MAC for hmac-sha2-256
      // MAC = HMAC(key, sequence_number || unencrypted_packet)

      const seqBuf = new SSHBuffer(4);
      seqBuf.writeUInt32(this.sendSeq);

      const macInput = concatBuffers(seqBuf.getData(), packetData);
      const mac = await this.encryptMAC.compute(macInput);

      // Encrypt packet
      const encrypted = await this.encryptCipher.encrypt(packetData);

      // Send encrypted packet + MAC
      this.sendRaw(concatBuffers(encrypted, mac));
    } else {
      this.sendRaw(packetData);
    }

    this.sendSeq++;
  }
}
