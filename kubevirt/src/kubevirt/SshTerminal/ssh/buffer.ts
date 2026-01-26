/**
 * SSH Buffer utilities for reading and writing SSH protocol data
 */

export class SSHBuffer {
  private data: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(data?: Uint8Array | number) {
    if (typeof data === 'number') {
      this.data = new Uint8Array(data);
    } else if (data) {
      this.data = data;
    } else {
      this.data = new Uint8Array(1024);
    }
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    this.offset = 0;
  }

  getOffset(): number {
    return this.offset;
  }

  remaining(): number {
    return this.data.length - this.offset;
  }

  getData(): Uint8Array {
    return this.data.slice(0, this.offset);
  }

  getFullData(): Uint8Array {
    return this.data;
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  // Ensure we have enough space to write more data
  private ensureSpace(bytes: number): void {
    if (this.offset + bytes > this.data.length) {
      const newSize = Math.max(this.data.length * 2, this.offset + bytes);
      const newData = new Uint8Array(newSize);
      newData.set(this.data);
      this.data = newData;
      this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    }
  }

  // Read methods
  readByte(): number {
    if (this.offset >= this.data.length) throw new Error('Buffer underflow');
    return this.data[this.offset++];
  }

  readUInt32(): number {
    if (this.offset + 4 > this.data.length) throw new Error('Buffer underflow');
    const value = this.view.getUint32(this.offset, false); // big-endian
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Uint8Array {
    if (this.offset + length > this.data.length) throw new Error('Buffer underflow');
    const result = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  readString(): Uint8Array {
    const length = this.readUInt32();
    return this.readBytes(length);
  }

  readStringAsString(): string {
    const bytes = this.readString();
    return new TextDecoder().decode(bytes);
  }

  readMPInt(): Uint8Array {
    const length = this.readUInt32();
    if (length === 0) return new Uint8Array(0);
    return this.readBytes(length);
  }

  readNameList(): string[] {
    const str = this.readStringAsString();
    if (str.length === 0) return [];
    return str.split(',');
  }

  readBoolean(): boolean {
    return this.readByte() !== 0;
  }

  // Write methods
  writeByte(value: number): this {
    this.ensureSpace(1);
    this.data[this.offset++] = value & 0xff;
    return this;
  }

  writeUInt32(value: number): this {
    this.ensureSpace(4);
    this.view.setUint32(this.offset, value >>> 0, false); // big-endian
    this.offset += 4;
    return this;
  }

  writeBytes(bytes: Uint8Array): this {
    this.ensureSpace(bytes.length);
    this.data.set(bytes, this.offset);
    this.offset += bytes.length;
    return this;
  }

  writeString(data: Uint8Array | string): this {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.writeUInt32(bytes.length);
    this.writeBytes(bytes);
    return this;
  }

  writeMPInt(value: Uint8Array): this {
    // SSH mpint format: prepend 0x00 if high bit is set (to indicate positive)
    if (value.length === 0) {
      this.writeUInt32(0);
      return this;
    }

    let start = 0;
    // Skip leading zeros
    while (start < value.length - 1 && value[start] === 0) {
      start++;
    }

    // If high bit is set, prepend 0x00
    if (value[start] & 0x80) {
      this.writeUInt32(value.length - start + 1);
      this.writeByte(0);
      this.writeBytes(value.slice(start));
    } else {
      this.writeUInt32(value.length - start);
      this.writeBytes(value.slice(start));
    }
    return this;
  }

  writeNameList(names: string[]): this {
    this.writeString(names.join(','));
    return this;
  }

  writeBoolean(value: boolean): this {
    this.writeByte(value ? 1 : 0);
    return this;
  }

  // Utility to create a new buffer from existing data
  static from(data: Uint8Array): SSHBuffer {
    return new SSHBuffer(data);
  }
}

// Helper to concatenate Uint8Arrays
export function concatBuffers(...buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.length;
  }
  return result;
}

// Generate random bytes
export function randomBytes(length: number): Uint8Array {
  const result = new Uint8Array(length);
  crypto.getRandomValues(result);
  return result;
}
