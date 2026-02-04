// Module: X25519 (RFC 7748)
// Description: Standalone X25519 scalar multiplication using Montgomery ladder.
// File: core/libs/x25519.js

const P = (1n << 255n) - 19n;
const A24 = 121665n;

// ----- Field arithmetic -----

function mod(a) {
  const r = a % P;
  return r >= 0n ? r : r + P;
}

function add(a, b) { return mod(a + b); }
function sub(a, b) { return mod(a - b); }
function mul(a, b) { return mod(a * b); }

function inv(a) {
  let r = 1n;
  let x = mod(a);
  let e = P - 2n;
  while (e > 0n) {
    if (e & 1n) r = mul(r, x);
    x = mul(x, x);
    e >>= 1n;
  }
  return r;
}

// ----- Montgomery ladder (RFC 7748) -----

function montgomeryLadder(k, u) {
  let x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254; t >= 0; t--) {
    const kt = (k >> BigInt(t)) & 1n;
    swap ^= kt;

    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }

    const A = add(x2, z2);
    const AA = mul(A, A);
    const B = sub(x2, z2);
    const BB = mul(B, B);
    const E = sub(AA, BB);
    const C = add(x3, z3);
    const D = sub(x3, z3);
    const DA = mul(D, A);
    const CB = mul(C, B);

    const X3 = mul(add(DA, CB), add(DA, CB));
    const Z3 = mul(x1, mul(sub(DA, CB), sub(DA, CB)));
    const X2 = mul(AA, BB);
    const Z2 = mul(E, add(AA, mul(A24, E)));

    x3 = X3;
    z3 = Z3;
    x2 = X2;
    z2 = Z2;

    swap = kt;
  }

  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  return mul(x2, inv(z2));
}

// ----- Encoding / decoding (little-endian) -----

function bytesToBigIntLE(bytes) {
  let r = 0n;
  for (let i = 0; i < bytes.length; i++) {
    r |= BigInt(bytes[i]) << (8n * BigInt(i));
  }
  return r;
}

function bigIntToBytesLE(x, size = 32) {
  const out = new Uint8Array(size);
  let v = x;
  for (let i = 0; i < size; i++) {
    out[i] = Number(v & 0xFFn);
    v >>= 8n;
  }
  return out;
}

// ----- Scalar clamping and u-coordinate masking -----

function clampScalarBytes(kBytes) {
  if (kBytes.length !== 32) {
    throw new Error('X25519 scalar must be 32 bytes');
  }
  const k = new Uint8Array(kBytes);
  k[0] &= 248;
  k[31] &= 127;
  k[31] |= 64;
  return bytesToBigIntLE(k);
}

function decodeUCoordinateBytes(uBytes) {
  if (uBytes.length !== 32) {
    throw new Error('X25519 u-coordinate must be 32 bytes');
  }
  const u = new Uint8Array(uBytes);
  u[31] &= 0x7F;
  return bytesToBigIntLE(u);
}

// ----- Public API -----

export function x25519(scalarBytes, uBytes) {
  const k = clampScalarBytes(scalarBytes);
  const u = decodeUCoordinateBytes(uBytes);
  const r = montgomeryLadder(k, u);
  return bigIntToBytesLE(r, 32);
}

export function x25519Base(scalarBytes) {
  const k = clampScalarBytes(scalarBytes);
  const r = montgomeryLadder(k, 9n);
  return bigIntToBytesLE(r, 32);
}