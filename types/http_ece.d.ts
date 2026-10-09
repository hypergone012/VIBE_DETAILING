// Minimal types for the reference RFC 8188 implementation used in tests only.
declare module 'http_ece' {
  import type { ECDH } from 'node:crypto';
  interface Params {
    version?: 'aes128gcm' | 'aesgcm';
    privateKey?: ECDH;
    authSecret?: Buffer;
    dh?: Buffer;
    keyid?: string | Buffer;
    salt?: Buffer;
    rs?: number;
  }
  const ece: {
    decrypt(buffer: Buffer, params: Params): Buffer;
    encrypt(buffer: Buffer, params: Params): Buffer;
  };
  export default ece;
}
