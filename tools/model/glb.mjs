/**
 * Minimal glTF 2.0 / GLB writer. No dependencies on purpose: `pnpm model` has to work
 * from a bare clone, and pulling a whole 3D engine in just to serialise a few hundred
 * triangles would be the wrong trade.
 *
 * Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_FLOAT = 5126;
const COMPONENT_UINT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

/** A chunk of geometry destined for one material. */
export class MeshBuilder {
  constructor(name, material) {
    this.name = name;
    this.material = material;
    this.positions = [];
    this.normals = [];
    this.indices = [];
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  /** Add one flat quad, wound counter-clockwise when seen from the normal side. */
  quad(a, b, c, d) {
    const n = faceNormal(a, b, c);
    const base = this.vertexCount;
    for (const v of [a, b, c, d]) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  tri(a, b, c) {
    const n = faceNormal(a, b, c);
    const base = this.vertexCount;
    for (const v of [a, b, c]) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
    this.indices.push(base, base + 1, base + 2);
    return this;
  }
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function faceNormal(a, b, c) {
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Apply a 3x4-ish transform: scale, then rotate about Y/X, then translate. */
export function xform(p, { t = [0, 0, 0], s = [1, 1, 1], rx = 0, ry = 0, rz = 0 } = {}) {
  let [x, y, z] = [p[0] * s[0], p[1] * s[1], p[2] * s[2]];
  if (rz) {
    const c = Math.cos(rz), si = Math.sin(rz);
    [x, y] = [x * c - y * si, x * si + y * c];
  }
  if (rx) {
    const c = Math.cos(rx), si = Math.sin(rx);
    [y, z] = [y * c - z * si, y * si + z * c];
  }
  if (ry) {
    const c = Math.cos(ry), si = Math.sin(ry);
    [x, z] = [x * c + z * si, -x * si + z * c];
  }
  return [x + t[0], y + t[1], z + t[2]];
}

/** Axis-aligned box centred on the origin, then transformed. */
export function box(mesh, w, h, d, tf = {}) {
  const [X, Y, Z] = [w / 2, h / 2, d / 2];
  const v = [
    [-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z], // front
    [-X, -Y, -Z], [X, -Y, -Z], [X, Y, -Z], [-X, Y, -Z], // back
  ].map((p) => xform(p, tf));

  mesh.quad(v[0], v[1], v[2], v[3]); // +Z
  mesh.quad(v[5], v[4], v[7], v[6]); // -Z
  mesh.quad(v[1], v[5], v[6], v[2]); // +X
  mesh.quad(v[4], v[0], v[3], v[7]); // -X
  mesh.quad(v[3], v[2], v[6], v[7]); // +Y
  mesh.quad(v[4], v[5], v[1], v[0]); // -Y
  return mesh;
}

/**
 * Box with its top face inset — a chamfered slab. Reads as machined metal rather than
 * a primitive, which is most of the difference between "3D model" and "grey cube".
 */
export function chamferBox(mesh, w, h, d, bevel, tf = {}) {
  const [X, Y, Z] = [w / 2, h / 2, d / 2];
  const bx = X - bevel;
  const bz = Z - bevel;

  const bot = [[-X, -Y, Z], [X, -Y, Z], [X, -Y, -Z], [-X, -Y, -Z]].map((p) => xform(p, tf));
  const rim = [[-X, Y - bevel, Z], [X, Y - bevel, Z], [X, Y - bevel, -Z], [-X, Y - bevel, -Z]].map((p) => xform(p, tf));
  const top = [[-bx, Y, bz], [bx, Y, bz], [bx, Y, -bz], [-bx, Y, -bz]].map((p) => xform(p, tf));

  mesh.quad(bot[3], bot[2], bot[1], bot[0]); // underside
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    mesh.quad(bot[i], bot[j], rim[j], rim[i]); // walls
    mesh.quad(rim[i], rim[j], top[j], top[i]); // bevel
  }
  mesh.quad(top[0], top[1], top[2], top[3]); // top
  return mesh;
}

/** Cylinder along +Y, centred on the origin. */
export function cylinder(mesh, radius, height, segments = 24, tf = {}) {
  const Y = height / 2;
  const ring = (y) =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      return xform([Math.cos(a) * radius, y, Math.sin(a) * radius], tf);
    });
  const top = ring(Y);
  const bot = ring(-Y);
  const cTop = xform([0, Y, 0], tf);
  const cBot = xform([0, -Y, 0], tf);

  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    mesh.quad(bot[i], bot[j], top[j], top[i]);
    mesh.tri(cTop, top[i], top[j]);
    mesh.tri(cBot, bot[j], bot[i]);
  }
  return mesh;
}

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

/**
 * Serialise meshes into a GLB. Each MeshBuilder becomes one primitive on one node.
 * @param {MeshBuilder[]} meshes
 * @param {object[]} materials glTF material objects
 */
export function writeGlb(meshes, materials, { name = "scene" } = {}) {
  const bufferViews = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;

  const pushView = (buf, target) => {
    const padding = pad4(offset);
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    chunks.push(buf);
    const idx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    offset += buf.length;
    return idx;
  };

  const gltfMeshes = meshes.map((m) => {
    const pos = Float32Array.from(m.positions);
    const nrm = Float32Array.from(m.normals);
    const idx = Uint32Array.from(m.indices);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    }

    const posView = pushView(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength), TARGET_ARRAY_BUFFER);
    const nrmView = pushView(Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength), TARGET_ARRAY_BUFFER);
    const idxView = pushView(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength), TARGET_ELEMENT_ARRAY_BUFFER);

    const posAcc = accessors.length;
    accessors.push({ bufferView: posView, componentType: COMPONENT_FLOAT, count: pos.length / 3, type: "VEC3", min, max });
    const nrmAcc = accessors.length;
    accessors.push({ bufferView: nrmView, componentType: COMPONENT_FLOAT, count: nrm.length / 3, type: "VEC3" });
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxView, componentType: COMPONENT_UINT, count: idx.length, type: "SCALAR" });

    return {
      name: m.name,
      primitives: [
        { attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, material: m.material },
      ],
    };
  });

  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "xorr-model-builder" },
    scene: 0,
    scenes: [{ name, nodes: gltfMeshes.map((_, i) => i) }],
    nodes: gltfMeshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length), 0x20); // spaces
  const binPad = Buffer.alloc(pad4(bin.length), 0);

  const jsonChunk = Buffer.concat([jsonBuf, jsonPad]);
  const binChunk = Buffer.concat([bin, binPad]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}
