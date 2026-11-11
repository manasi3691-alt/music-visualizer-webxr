/**
 * CosmicAwakening: Phase 3 Cinematic Finale — "THE COSMIC AWAKENING" (161s – 266.92s).
 *
 * Visual & Musical Design:
 *  - Gradual Formation (161s – 182s): Elements from Phase 1 & Phase 2 (city lights,
 *    crystal lotus energy/petals, cosmic ocean water, aurora ribbons, firework remnants,
 *    and sparkling bubbles) rise and spiral together across 360° into a colossal,
 *    translucent, gender-neutral cosmic human silhouette with outstretched arms and
 *    a slightly lifted head.
 *  - Musical Illumination & Peak (182s – 250s): Volumetric nebula body pulses with music;
 *    golden-white chest light radiates; multi-ring concentric golden halo counter-rotates
 *    and expands behind the lifted head; 360° energy ribbons wrap around the seated user.
 *  - Quiet Passage & Peaceful Ending (250s – 266.92s): Silhouette dissolves back into
 *    delicate drifting stardust that floats into the deep cosmic distance as the
 *    environment gently settles into darkness.
 *
 * Optimized for Meta Quest 3S & Desktop (pooled GPU shaders, zero per-frame allocations).
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  PlaneGeometry,
  CatmullRomCurve3,
  Color,
  Vector3,
  Quaternion,
  AdditiveBlending,
  DoubleSide,
  FrontSide,
  Camera,
  World,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';
import type { FireworkFlash } from '../world/CosmicFireworks.js';

export const AWAKENING_TIMELINE = {
  tGatherStart: 161.0,    // Convergence of Phase 1 & Phase 2 elements begins
  tBodyStart: 166.5,      // Translucent nebula silhouette begins condensing (bottom-up)
  tFullAwakening: 180.0,  // Complete figure, halo, chest burst, and 360° ribbons active
  tDissolveStart: 250.0,  // Final quieter passage: figure dissolves into drifting stardust
  tFadeEnd: 266.92,       // Peaceful drift into darkness
};

interface SamplePoint {
  x: number;
  y: number;
  z: number;
  regionProgress: number; // 0 = base/water, 0.5 = chest/arms, 1.0 = head/crown
}

export class CosmicAwakening {
  readonly group: Group = new Group();
  private figureRoot: Group = new Group();

  private isQuest: boolean;
  private isRevealed = false;
  private hasAnchored = false;

  // Seated forward anchor
  private anchorPosition = new Vector3(0, 0.0, 0);
  private anchorForward = new Vector3(0, 0, -1);

  // Volumetric Figure Meshes & Shared Ethereal Nebula Material
  private bodyMaterial: ShaderMaterial;
  private figureMeshes: Mesh[] = [];
  private bodyGeometries: BufferGeometry[] = [];

  // Golden-White Chest Starburst Heart
  private chestGroup: Group = new Group();
  private chestCoreMesh!: Mesh;
  private chestAuraMesh!: Mesh;
  private chestRaysMesh!: Mesh;
  private chestRaysMat!: ShaderMaterial;

  // Concentric Golden Halo behind lifted head
  private haloGroup: Group = new Group();
  private haloRings: { mesh: Mesh; mat: ShaderMaterial; baseScale: number; speed: number }[] = [];
  private haloParticlesMat!: ShaderMaterial;
  private haloParticlesGeo!: BufferGeometry;

  // 360° Swirling Energy Ribbons
  private ribbonMeshes: { mesh: Mesh; mat: ShaderMaterial; baseOpacity: number }[] = [];

  // Unified Phase-Element Convergence + Volumetric Figure Stardust Particle Cloud
  private particleCount: number;
  private particleGeo!: BufferGeometry;
  private particleMat!: ShaderMaterial;
  private particlePoints!: Points;

  // Ocean reflection flashes (feeds OceanOfLight during Phase 3)
  private activeFlashes: FireworkFlash[] = [
    { position: new Vector3(0, 6.0, -13.0), color: new Color(0xfff1c4), intensity: 0 },   // Chest golden-white
    { position: new Vector3(-7.5, 6.2, -10.5), color: new Color(0x00f2fe), intensity: 0 }, // Left hand cyan
    { position: new Vector3(7.5, 6.2, -10.5), color: new Color(0xff77e9), intensity: 0 },  // Right hand pink-violet
    { position: new Vector3(0, 9.5, -13.5), color: new Color(0xffd166), intensity: 0 },    // Crown golden halo
  ];

  // Key anatomical anchors in figureRoot local space (figure stands at z = -13.5m facing +Z toward user)
  private readonly figZ = -13.5;
  private readonly chestCenter = new Vector3(0, 5.45, -12.95);
  private readonly haloCenter = new Vector3(0, 8.25, -14.15);

  // Reusable scratch objects (zero per-frame allocations)
  private scratchHeadPos = new Vector3();
  private scratchHeadQuat = new Quaternion();
  private scratchWorldPos = new Vector3();
  private scratchCamVec = new Vector3();

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.particleCount = isQuest ? 1650 : 3800;

    this.group.name = 'CosmicAwakening';
    this.group.add(this.figureRoot);

    this.bodyMaterial = this.createBodyMaterial();

    // Build colossal 3D figure anatomy & collect surface samples for volumetric stardust
    const silhouetteSamples: SamplePoint[] = [];
    this.buildTorso(silhouetteSamples);
    this.buildHeadAndNeck(silhouetteSamples);
    this.buildArmsAndHands(silhouetteSamples);
    this.buildFlowingHairAndWaterStreams(silhouetteSamples);

    // Build chest radiant heart starburst
    this.buildChestStarburst();

    // Build concentric golden halo behind lifted head
    this.buildGoldenHalo();

    // Build 360° cosmic energy ribbons wrapping around both figure and seated user
    this.buildCosmicRibbons();

    // Build unified convergence + volumetric figure + outro dissolution particles
    this.buildUnifiedParticles(silhouetteSamples);

    this.group.visible = false;
  }

  // ─── 1. Procedural Volumetric Ethereal Body Material ────────────────────────

  private createBodyMaterial(): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFormProgress: { value: 0 },     // 0 -> 1 bottom-up materialization
        uDissolveProgress: { value: 0 }, // 0 -> 1 peaceful outro fade
        uEnergy: { value: 0 },
        uMid: { value: 0 },
        uHigh: { value: 0 },
        uLow: { value: 0 },
        uMasterAlpha: { value: 0 },
        uChestPos: { value: this.chestCenter.clone() },
      },
      vertexShader: `
        attribute float aBodyHeight;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;
        varying vec2 vUv;
        varying float vBodyHeight;

        uniform float uTime;
        uniform float uEnergy;
        uniform float uLow;

        void main() {
          vUv = uv;
          vBodyHeight = aBodyHeight;

          // Gentle ethereal breathing & cosmic current undulation
          vec3 pos = position;
          float breathe = sin(uTime * 1.4 + pos.y * 0.55) * (0.045 + uLow * 0.055);
          float ripple = sin(pos.y * 1.6 - uTime * 2.2 + pos.x * 0.7) * (0.035 + uEnergy * 0.04);
          pos += normal * (breathe + ripple * smoothstep(0.0, 0.35, aBodyHeight));

          vLocalPos = pos;
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFormProgress;
        uniform float uDissolveProgress;
        uniform float uEnergy;
        uniform float uMid;
        uniform float uHigh;
        uniform float uMasterAlpha;
        uniform vec3 uChestPos;

        varying vec3 vNormalView;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;
        varying vec2 vUv;
        varying float vBodyHeight;

        void main() {
          if (uMasterAlpha <= 0.005) discard;

          // Bottom-up organic emergence wave + gentle top-down/radial outro dissolve
          float noiseWave = sin(vLocalPos.x * 1.3 + uTime * 1.6) * cos(vLocalPos.z * 1.5 - uTime * 1.1) * 0.08;
          float emergeEdge = uFormProgress * 1.18 - 0.05;
          float emergeAlpha = smoothstep(vBodyHeight - 0.20, vBodyHeight + 0.06, emergeEdge + noiseWave);
          float dissolveAlpha = 1.0 - smoothstep(0.0, 0.95, uDissolveProgress + (1.0 - vBodyHeight) * 0.25);
          float visibility = emergeAlpha * dissolveAlpha;
          if (visibility <= 0.004) discard;

          // Translucent ethereal Fresnel silhouette (never solid skin!)
          float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
          float fresnel = pow(1.0 - ndv, 1.85);
          float innerMist = 0.09 + 0.08 * sin(vLocalPos.y * 2.0 - uTime * 2.4 + vLocalPos.x * 1.1);

          // Flowing internal nebula ribbons (cyan, turquoise, lavender, violet, pink, gold)
          float flow1 = sin(vLocalPos.y * 1.8 - uTime * 1.7 + vLocalPos.x * 0.9 + sin(vLocalPos.z * 1.3 + uTime) * 0.7) * 0.5 + 0.5;
          float flow2 = cos(vLocalPos.x * 1.4 + uTime * 1.3 - vLocalPos.y * 1.1) * 0.5 + 0.5;
          float sparkle = pow(max(0.0, sin(vLocalPos.x * 9.0 + uTime * 3.0) * cos(vLocalPos.y * 11.0 - uTime * 2.5)), 6.0);

          vec3 colCyan = vec3(0.04, 0.92, 1.00);
          vec3 colTurq = vec3(0.12, 0.90, 0.72);
          vec3 colLavender = vec3(0.68, 0.58, 0.96);
          vec3 colVioletPink = mix(vec3(0.54, 0.18, 0.89), vec3(1.00, 0.45, 0.88), flow2);
          vec3 colGold = vec3(1.00, 0.88, 0.55);

          vec3 nebCol = mix(colCyan, colTurq, flow1 * 0.5);
          nebCol = mix(nebCol, colVioletPink, smoothstep(0.25, 0.85, flow2) * 0.72);
          nebCol = mix(nebCol, colLavender, fresnel * 0.45);

          // Chest heart warmth radiating delicately across torso & inner arms
          float distChest = length(vLocalPos - uChestPos);
          float chestWarmth = exp(-distChest * 0.62) * (0.55 + uEnergy * 0.38);
          nebCol = mix(nebCol, colGold, clamp(chestWarmth * 0.58, 0.0, 0.62));
          nebCol += colGold * sparkle * (0.35 + uHigh * 0.45);

          // Soft feathering at lower ocean base (dissolves cleanly into water)
          float baseFeather = smoothstep(0.0, 0.16, vBodyHeight);
          float alpha = (fresnel * 0.50 + innerMist * 0.42 + chestWarmth * 0.16) * baseFeather * visibility * uMasterAlpha;
          alpha *= (0.80 + uMid * 0.22 + uEnergy * 0.18);

          gl_FragColor = vec4(nebCol, clamp(alpha, 0.0, 0.72));
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
  }

  private addBodyHeightAttribute(geo: BufferGeometry, heightFn: (x: number, y: number, z: number) => number): void {
    const pos = geo.attributes.position as BufferAttribute;
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      heights[i] = Math.max(0, Math.min(1, heightFn(pos.getX(i), pos.getY(i), pos.getZ(i))));
    }
    geo.setAttribute('aBodyHeight', new BufferAttribute(heights, 1));
  }

  // ─── 2. Sculpted Colossal 3D Torso, Head, Arms, Hands & Cosmic Hair ────────

  private buildTorso(samples: SamplePoint[]): void {
    const rings = 30;
    const segs = this.isQuest ? 22 : 32;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Profile table from ocean base (y=0) up to collar/neck base (y=6.8)
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const y = t * 6.85;

      // Graceful gender-neutral organic width & depth profile
      let rx = 1.2;
      let rz = 0.72;
      if (t < 0.28) {
        // Flowing misty ocean base flaring out gracefully
        const k = 1.0 - t / 0.28;
        rx = 1.12 + k * k * 1.45;
        rz = 0.68 + k * k * 0.95;
      } else if (t < 0.78) {
        // Slender waist expanding smoothly into chest/ribcage & shoulders
        const k = (t - 0.28) / 0.50;
        const s = k * k * (3 - 2 * k);
        rx = 1.12 + s * 1.05;
        rz = 0.68 + Math.sin(k * Math.PI * 0.75) * 0.34;
      } else {
        // Shoulder slope tapering cleanly into neck base
        const k = (t - 0.78) / 0.22;
        const s = k * k * (3 - 2 * k);
        rx = 2.17 * (1.0 - s) + 0.44 * s;
        rz = 0.85 * (1.0 - s) + 0.42 * s;
      }

      // Gentle upward-heart spinal arch
      const zCenter = this.figZ + Math.sin(t * Math.PI) * 0.42 + (t > 0.65 ? (t - 0.65) * -0.8 : 0);

      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const theta = u * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // Subtle organic ribcage / spine contour
        const backCurve = sinT < 0 ? 0.88 : 1.0;
        const x = cosT * rx;
        const z = zCenter + sinT * rz * backCurve;

        positions.push(x, y, z);
        uvs.push(u, t);

        if (j < segs && Math.random() < 0.82) {
          samples.push({
            x: x + (Math.random() - 0.5) * 0.35,
            y: y + (Math.random() - 0.5) * 0.25,
            z: z + (Math.random() - 0.5) * 0.35,
            regionProgress: t * 0.68,
          });
        }
      }
    }

    const rowStride = segs + 1;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * rowStride + j;
        const b = (i + 1) * rowStride + j;
        const c = (i + 1) * rowStride + (j + 1);
        const d = i * rowStride + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.addBodyHeightAttribute(geo, (_x, y) => y / 9.2);

    const mesh = new Mesh(geo, this.bodyMaterial);
    mesh.name = 'awakening-torso';
    this.figureRoot.add(mesh);
    this.figureMeshes.push(mesh);
    this.bodyGeometries.push(geo);
  }

  private buildHeadAndNeck(samples: SamplePoint[]): void {
    // Smooth lofted neck & slightly lifted serene cranium (y = 6.55 -> 9.05)
    const rings = 24;
    const segs = this.isQuest ? 20 : 28;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const y = 6.55 + t * 2.55;

      let rx = 0.42;
      let rz = 0.42;
      let zBias = 0;
      if (t < 0.28) {
        // Neck column tilting slightly back as head lifts
        const k = t / 0.28;
        rx = 0.44 - k * 0.05;
        rz = 0.44 - k * 0.05;
        zBias = -k * 0.14;
      } else {
        // Sculpted ovoid head (chin lifted ~22° skyward)
        const hT = (t - 0.28) / 0.72; // 0 = chin/jaw, 1 = crown
        const profile = Math.sin(Math.pow(hT, 0.72) * Math.PI);
        rx = 0.14 + profile * 0.56;
        rz = 0.16 + profile * 0.68;
        // Chin projects slightly forward, crown tilts gently backward
        zBias = -0.14 + Math.sin(hT * Math.PI) * 0.26 - hT * 0.35;
      }

      const zCenter = this.figZ - 0.18 + zBias;

      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const theta = u * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // Subtle face plane vs rounded back of head
        const faceShape = sinT > 0 ? (0.95 + 0.08 * Math.cos(cosT * 1.4)) : 1.05;
        const x = cosT * rx;
        const z = zCenter + sinT * rz * faceShape;

        positions.push(x, y, z);
        uvs.push(u, t);

        if (j < segs && Math.random() < 0.72) {
          samples.push({
            x: x + (Math.random() - 0.5) * 0.2,
            y: y + (Math.random() - 0.5) * 0.18,
            z: z + (Math.random() - 0.5) * 0.2,
            regionProgress: 0.72 + t * 0.28,
          });
        }
      }
    }

    const rowStride = segs + 1;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * rowStride + j;
        const b = (i + 1) * rowStride + j;
        const c = (i + 1) * rowStride + (j + 1);
        const d = i * rowStride + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.addBodyHeightAttribute(geo, (_x, y) => y / 9.2);

    const mesh = new Mesh(geo, this.bodyMaterial);
    mesh.name = 'awakening-head';
    this.figureRoot.add(mesh);
    this.figureMeshes.push(mesh);
    this.bodyGeometries.push(geo);
  }

  private buildArmsAndHands(samples: SamplePoint[]): void {
    const sides = [-1, 1];
    const curveSegs = this.isQuest ? 24 : 34;
    const radSegs = this.isQuest ? 12 : 16;

    for (const side of sides) {
      // Graceful outstretched welcoming arm curving wide & slightly forward toward viewer
      const armCurve = new CatmullRomCurve3([
        new Vector3(side * 1.65, 6.05, this.figZ - 0.05),  // Shoulder blend inside torso
        new Vector3(side * 3.35, 5.65, this.figZ + 0.55),  // Upper arm sweeping out
        new Vector3(side * 5.65, 5.75, this.figZ + 1.45),  // Elbow gentle dip & lift
        new Vector3(side * 7.85, 6.40, this.figZ + 2.35),  // Forearm ascending
        new Vector3(side * 8.65, 6.75, this.figZ + 2.70),  // Open palm base
      ]);

      const frames = armCurve.computeFrenetFrames(curveSegs, false);
      const pts = armCurve.getPoints(curveSegs);

      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i <= curveSegs; i++) {
        const t = i / curveSegs;
        const p = pts[i];
        const N = frames.normals[i];
        const B = frames.binormals[i];

        // Taper organically from shoulder (0.58m) -> elbow (0.38m) -> wrist (0.22m) -> palm (0.28m)
        let r = 0.58 * (1 - t) + 0.23 * t;
        if (t > 0.86) {
          const palmT = (t - 0.86) / 0.14;
          r = 0.23 + Math.sin(palmT * Math.PI) * 0.10;
        }

        for (let j = 0; j <= radSegs; j++) {
          const v = j / radSegs;
          const ang = v * Math.PI * 2;
          const cosA = Math.cos(ang);
          const sinA = Math.sin(ang);

          // Slightly flatten palm near tip
          const flatScale = t > 0.88 ? 0.65 : 1.0;
          const vx = p.x + (N.x * cosA + B.x * sinA * flatScale) * r;
          const vy = p.y + (N.y * cosA + B.y * sinA * flatScale) * r;
          const vz = p.z + (N.z * cosA + B.z * sinA * flatScale) * r;

          positions.push(vx, vy, vz);
          uvs.push(t, v);

          if (j < radSegs && Math.random() < 0.78) {
            samples.push({
              x: vx + (Math.random() - 0.5) * 0.25,
              y: vy + (Math.random() - 0.5) * 0.22,
              z: vz + (Math.random() - 0.5) * 0.25,
              regionProgress: 0.42 + t * 0.46,
            });
          }
        }
      }

      const rowStride = radSegs + 1;
      for (let i = 0; i < curveSegs; i++) {
        for (let j = 0; j < radSegs; j++) {
          const a = i * rowStride + j;
          const b = (i + 1) * rowStride + j;
          const c = (i + 1) * rowStride + (j + 1);
          const d = i * rowStride + (j + 1);
          indices.push(a, b, d, b, c, d);
        }
      }

      const armGeo = new BufferGeometry();
      armGeo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      armGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
      armGeo.setIndex(indices);
      armGeo.computeVertexNormals();
      // Arms reveal smoothly after chest builds (`0.42 -> 0.88`)
      this.addBodyHeightAttribute(armGeo, (x) => 0.42 + Math.min(0.48, (Math.abs(x) - 1.4) / 14.5));

      const armMesh = new Mesh(armGeo, this.bodyMaterial);
      armMesh.name = side < 0 ? 'awakening-arm-left' : 'awakening-arm-right';
      this.figureRoot.add(armMesh);
      this.figureMeshes.push(armMesh);
      this.bodyGeometries.push(armGeo);

      // 5 graceful splayed open cosmic fingers extending upward from each palm
      const wristPos = pts[pts.length - 1];
      for (let f = 0; f < 5; f++) {
        const fan = (f - 2) * 0.26;
        const len = f === 2 ? 0.72 : (f === 0 ? 0.48 : 0.62);
        const fCurve = new CatmullRomCurve3([
          wristPos.clone(),
          new Vector3(
            wristPos.x + side * len * 0.55,
            wristPos.y + 0.14 + Math.abs(fan) * 0.08,
            wristPos.z + fan * 0.45 + 0.12
          ),
          new Vector3(
            wristPos.x + side * len,
            wristPos.y + 0.36 + (2 - Math.abs(f - 2)) * 0.05,
            wristPos.z + fan * 0.85 + 0.24
          ),
        ]);
        const fingerGeo = new TubeGeometry(fCurve, 8, 0.042, 6, false);
        this.addBodyHeightAttribute(fingerGeo, () => 0.86);
        const fingerMesh = new Mesh(fingerGeo, this.bodyMaterial);
        this.figureRoot.add(fingerMesh);
        this.figureMeshes.push(fingerMesh);
        this.bodyGeometries.push(fingerGeo);

        // Add tip stardust samples on fingertips
        const tip = fCurve.getPoint(1.0);
        for (let s = 0; s < 6; s++) {
          samples.push({
            x: tip.x + (Math.random() - 0.5) * 0.25,
            y: tip.y + (Math.random() - 0.5) * 0.25,
            z: tip.z + (Math.random() - 0.5) * 0.25,
            regionProgress: 0.88,
          });
        }
      }
    }
  }

  private buildFlowingHairAndWaterStreams(samples: SamplePoint[]): void {
    // 7 sweeping aurora hair tendrils flowing backward & left/right from crown into space
    const strandCount = 7;
    for (let s = 0; s < strandCount; s++) {
      const sideBias = ((s / (strandCount - 1)) - 0.5) * 2.0; // -1 .. +1
      const curve = new CatmullRomCurve3([
        new Vector3(sideBias * 0.35, 8.65 - Math.abs(sideBias) * 0.3, this.figZ - 0.55),
        new Vector3(sideBias * 1.45, 8.15 - Math.abs(sideBias) * 0.4, this.figZ - 1.65),
        new Vector3(sideBias * 3.10, 7.25 + (s % 2 === 0 ? 0.55 : -0.35), this.figZ - 2.60),
        new Vector3(sideBias * 4.85, 6.20 + Math.sin(s * 1.5) * 0.7, this.figZ - 2.20),
      ]);
      const geo = new TubeGeometry(curve, this.isQuest ? 14 : 22, 0.14 - Math.abs(sideBias) * 0.03, 7, false);
      this.addBodyHeightAttribute(geo, () => 0.84);
      const mesh = new Mesh(geo, this.bodyMaterial);
      this.figureRoot.add(mesh);
      this.figureMeshes.push(mesh);
      this.bodyGeometries.push(geo);

      for (let k = 0; k < 22; k++) {
        const pt = curve.getPoint(Math.random());
        samples.push({
          x: pt.x + (Math.random() - 0.5) * 0.35,
          y: pt.y + (Math.random() - 0.5) * 0.35,
          z: pt.z + (Math.random() - 0.5) * 0.35,
          regionProgress: 0.85,
        });
      }
    }
  }

  // ─── 3. Golden-White Chest Starburst Light ─────────────────────────────────

  private buildChestStarburst(): void {
    this.chestGroup.position.copy(this.chestCenter);
    this.figureRoot.add(this.chestGroup);

    const coreGeo = new SphereGeometry(0.20, 20, 20);
    const coreMat = new MeshBasicMaterial({
      color: 0xfff8dc,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.chestCoreMesh = new Mesh(coreGeo, coreMat);
    this.chestGroup.add(this.chestCoreMesh);

    const auraGeo = new SphereGeometry(0.92, 20, 20);
    const auraMat = new MeshBasicMaterial({
      color: 0xffd27d,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.chestAuraMesh = new Mesh(auraGeo, auraMat);
    this.chestGroup.add(this.chestAuraMesh);

    // Radiant golden-white starburst diffraction flare plane
    const rayGeo = new PlaneGeometry(4.4, 4.4);
    this.chestRaysMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uPulse: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform float uPulse;
        varying vec2 vUv;

        void main() {
          if (uAlpha <= 0.004) discard;
          vec2 p = vUv - vec2(0.5);
          float d = length(p);
          if (d > 0.5) discard;

          float ang = atan(p.y, p.x);
          float rays6 = pow(abs(cos(ang * 3.0 + uTime * 0.25)), 24.0);
          float rays4 = pow(abs(cos(ang * 2.0 - uTime * 0.15)), 32.0);
          float flare = exp(-d * 17.0) * 1.15 + (rays6 * 0.45 + rays4 * 0.60) * exp(-d * 5.8);
          float softHalo = pow(max(0.0, 1.0 - d * 2.0), 3.4) * 0.26;

          vec3 col = mix(vec3(1.0, 0.84, 0.45), vec3(1.0, 0.99, 0.94), clamp(exp(-d * 18.0), 0.0, 1.0));
          float a = clamp((flare + softHalo) * uPulse * uAlpha, 0.0, 0.72);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    this.chestRaysMesh = new Mesh(rayGeo, this.chestRaysMat);
    this.chestGroup.add(this.chestRaysMesh);
  }

  // ─── 4. Magnificent Concentric Golden Halo Behind Head ─────────────────────

  private buildGoldenHalo(): void {
    this.haloGroup.position.copy(this.haloCenter);
    // Tilt subtly to match the head's skyward gaze toward the user
    this.haloGroup.rotation.set(-0.24, 0, 0);
    this.figureRoot.add(this.haloGroup);

    const ringSpecs = [
      { radius: 2.35, tube: 0.085, color: 0xffe599, speed: 0.18, segments: 72, freq: 6.0 },
      { radius: 3.15, tube: 0.055, color: 0xffc857, speed: -0.24, segments: 80, freq: 12.0 },
      { radius: 4.10, tube: 0.042, color: 0xfff0c2, speed: 0.14, segments: 84, freq: 18.0 },
      { radius: 5.20, tube: 0.032, color: 0xe6b85c, speed: -0.10, segments: 96, freq: 24.0 },
    ];

    for (let i = 0; i < ringSpecs.length; i++) {
      const spec = ringSpecs[i];
      const geo = new TorusGeometry(spec.radius, spec.tube, 10, this.isQuest ? 48 : spec.segments);
      const mat = new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(spec.color) },
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uFreq: { value: spec.freq },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTime;
          uniform float uAlpha;
          uniform float uFreq;
          varying vec2 vUv;

          void main() {
            if (uAlpha <= 0.004) discard;
            float shimmer = 0.65 + 0.35 * sin(vUv.x * 6.28318 * uFreq + uTime * 2.8);
            float coreBeam = sin(vUv.y * 3.14159);
            float a = shimmer * pow(max(0.0, coreBeam), 0.7) * uAlpha;
            vec3 col = mix(uColor, vec3(1.0, 0.99, 0.93), shimmer * 0.4);
            gl_FragColor = vec4(col, a);
          }
        `,
        transparent: true,
        blending: AdditiveBlending,
        side: FrontSide,
        depthWrite: false,
      });

      const mesh = new Mesh(geo, mat);
      this.haloGroup.add(mesh);
      this.haloRings.push({ mesh, mat, baseScale: 1.0, speed: spec.speed });
    }

    // Sparkling golden star beads orbiting along the halo arcs
    const beadCount = this.isQuest ? 120 : 240;
    const pos = new Float32Array(beadCount * 3);
    const phases = new Float32Array(beadCount);
    const sizes = new Float32Array(beadCount);

    for (let i = 0; i < beadCount; i++) {
      const ringIdx = i % ringSpecs.length;
      const r = ringSpecs[ringIdx].radius + (Math.random() - 0.5) * 0.38;
      const theta = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.sin(theta) * r;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
      phases[i] = Math.random() * Math.PI * 2;
      sizes[i] = (0.14 + Math.random() * 0.22) * (ringIdx === 0 ? 1.25 : 1.0);
    }

    this.haloParticlesGeo = new BufferGeometry();
    this.haloParticlesGeo.setAttribute('position', new BufferAttribute(pos, 3));
    this.haloParticlesGeo.setAttribute('aPhase', new BufferAttribute(phases, 1));
    this.haloParticlesGeo.setAttribute('aSize', new BufferAttribute(sizes, 1));

    this.haloParticlesMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
      },
      vertexShader: `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        uniform float uAlpha;
        varying float vAlpha;
        void main() {
          float tw = 0.5 + 0.5 * sin(uTime * 5.0 + aPhase);
          vAlpha = tw * uAlpha;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (850.0 / max(1.0, -mvPos.z)), 2.0, 38.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.005) discard;
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float sx = max(0.0, 1.0 - abs(c.x) * 4.8) * max(0.0, 1.0 - abs(c.y) * 1.8);
          float sy = max(0.0, 1.0 - abs(c.y) * 4.8) * max(0.0, 1.0 - abs(c.x) * 1.8);
          float core = exp(-d * 12.0) * 1.4;
          float a = clamp(max(sx, sy) + core, 0.0, 1.0) * vAlpha;
          gl_FragColor = vec4(1.0, 0.94, 0.72, a);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    const haloPts = new Points(this.haloParticlesGeo, this.haloParticlesMat);
    this.haloGroup.add(haloPts);
  }

  // ─── 5. 360° Cosmic Energy Ribbons ─────────────────────────────────────────

  private buildCosmicRibbons(): void {
    const ribbonSpecs: { pts: Vector3[]; colA: number; colB: number; radius: number; opacity: number }[] = [
      // 1-2: Hero sweeping golden-cyan arcs extending from outstretched hands around seated user
      {
        pts: [
          new Vector3(-8.6, 6.7, this.figZ + 2.7),
          new Vector3(-11.5, 4.8, -5.0),
          new Vector3(-9.5, 3.2, 6.0),
          new Vector3(0.0, 4.2, 13.5),
          new Vector3(10.0, 5.2, 4.5),
          new Vector3(8.6, 6.7, this.figZ + 2.7),
        ],
        colA: 0xffd27d, colB: 0x00f2fe, radius: 0.14, opacity: 0.72,
      },
      // 3-4: Violet-pink spiral crossing chest & curling over left/right horizons
      {
        pts: [
          new Vector3(-12.5, 2.2, -16.0),
          new Vector3(-5.2, 4.4, this.figZ + 1.4),
          new Vector3(0.0, 5.5, this.figZ + 0.9),
          new Vector3(5.6, 7.2, this.figZ + 0.6),
          new Vector3(12.2, 4.8, -4.0),
          new Vector3(6.0, 2.5, 11.0),
        ],
        colA: 0xff77e9, colB: 0x8a2be2, radius: 0.12, opacity: 0.68,
      },
      // 5: Turquoise-lavender overhead canopy ribbon arching over user's head
      {
        pts: [
          new Vector3(-11.0, 4.0, 4.0),
          new Vector3(-6.5, 9.8, -4.0),
          new Vector3(0.0, 12.2, -7.5),
          new Vector3(6.8, 9.6, -3.5),
          new Vector3(11.5, 3.8, 5.5),
        ],
        colA: 0x1de9b6, colB: 0xb39ddb, radius: 0.13, opacity: 0.62,
      },
      // 6: Golden-rose waist-to-ocean current ribbon wrapping 360° near horizon
      {
        pts: [
          new Vector3(0.0, 1.2, this.figZ + 2.0),
          new Vector3(8.5, 2.8, -7.0),
          new Vector3(10.5, 2.4, 5.5),
          new Vector3(0.0, 1.9, 12.0),
          new Vector3(-10.5, 2.6, 5.0),
          new Vector3(-8.2, 3.2, -7.5),
          new Vector3(0.0, 1.2, this.figZ + 2.0),
        ],
        colA: 0xffe599, colB: 0xff77e9, radius: 0.10, opacity: 0.58,
      },
      // 7: High cyan-gold aurora streamer behind head halo
      {
        pts: [
          new Vector3(-13.0, 8.8, -16.5),
          new Vector3(-5.0, 10.6, -15.2),
          new Vector3(0.0, 11.4, -14.8),
          new Vector3(5.5, 10.2, -15.2),
          new Vector3(13.0, 8.5, -16.8),
        ],
        colA: 0x00f2fe, colB: 0xffd166, radius: 0.15, opacity: 0.66,
      },
    ];

    const segs = this.isQuest ? 48 : 80;
    for (let i = 0; i < ribbonSpecs.length; i++) {
      const spec = ribbonSpecs[i];
      const curve = new CatmullRomCurve3(spec.pts);
      const geo = new TubeGeometry(curve, segs, spec.radius, 6, false);

      const mat = new ShaderMaterial({
        uniforms: {
          uColorA: { value: new Color(spec.colA) },
          uColorB: { value: new Color(spec.colB) },
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uSpeed: { value: 0.22 + i * 0.04 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormalView;
          varying vec3 vViewDir;
          void main() {
            vUv = uv;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormalView = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSpeed;
          varying vec2 vUv;
          varying vec3 vNormalView;
          varying vec3 vViewDir;

          void main() {
            if (uAlpha <= 0.004) discard;
            // Feather tube silhouette edges for weightless silky aurora trail appearance
            float centerCore = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 2.1);
            float strands = 0.62 + 0.38 * sin(vUv.y * 12.566 + vUv.x * 18.0 - uTime * 3.0);
            float wave = sin(vUv.x * 18.849 - uTime * (3.2 + uSpeed * 4.0)) * 0.5 + 0.5;
            float pulse = pow(wave, 1.6);
            float ends = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
            vec3 col = mix(uColorA, uColorB, sin(vUv.x * 6.283 + uTime * 0.8) * 0.5 + 0.5);
            col = mix(col, vec3(1.0, 0.98, 0.90), pulse * 0.42);
            float a = (0.30 + pulse * 0.70) * centerCore * strands * ends * uAlpha;
            gl_FragColor = vec4(col, a);
          }
        `,
        transparent: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
      });

      const mesh = new Mesh(geo, mat);
      this.figureRoot.add(mesh);
      this.ribbonMeshes.push({ mesh, mat, baseOpacity: spec.opacity });
    }
  }

  // ─── 6. Unified Phase-Element Gathering + Volumetric Figure Stardust ───────

  private buildUnifiedParticles(samples: SamplePoint[]): void {
    // Shuffle silhouette samples so Quest & Desktop budgets cover torso, head, and BOTH arms symmetrically
    for (let s = samples.length - 1; s > 0; s--) {
      const r = Math.floor(Math.random() * (s + 1));
      const tmp = samples[s];
      samples[s] = samples[r];
      samples[r] = tmp;
    }

    const count = this.particleCount;
    const silhouetteCount = Math.floor(count * 0.72);
    const sourcePos = new Float32Array(count * 3);
    const targetPos = new Float32Array(count * 3);
    const disperseDir = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const delays = new Float32Array(count);
    const phases = new Float32Array(count);

    const palette = [
      new Color(0x00f2fe), // Cyan
      new Color(0x1de9b6), // Turquoise
      new Color(0xb39ddb), // Lavender
      new Color(0x8a2be2), // Violet
      new Color(0xff77e9), // Pink
      new Color(0xffe599), // Restrained Gold
      new Color(0xfff8e6), // Golden-White
    ];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const isSilhouette = i < silhouetteCount && samples.length > 0;

      // Target position: either on the colossal silhouette or 360° surrounding cosmic stream
      let tx = 0;
      let ty = 4.0;
      let tz = this.figZ;
      let regionProg = 0.5;

      if (isSilhouette) {
        const spIdx = Math.floor((i / silhouetteCount) * samples.length) % samples.length;
        const sp = samples[spIdx];
        tx = sp.x + (Math.random() - 0.5) * 0.45;
        ty = sp.y + (Math.random() - 0.5) * 0.40;
        tz = sp.z + (Math.random() - 0.5) * 0.45;
        regionProg = sp.regionProgress;
      } else {
        // 360° surrounding volumetric nebula/stardust streams around the seated user
        const az = Math.random() * Math.PI * 2;
        const dist = 7.0 + Math.random() * 18.0;
        tx = Math.sin(az) * dist;
        ty = 0.8 + Math.random() * 12.5;
        tz = -Math.cos(az) * dist;
        regionProg = 0.25 + Math.random() * 0.70;
      }

      targetPos[i3] = tx;
      targetPos[i3 + 1] = ty;
      targetPos[i3 + 2] = tz;

      // Source position from the 4 prior-phase origins
      const originType = i % 4;
      let sx = 0;
      let sy = 1.0;
      let sz = -6.0;
      let col = palette[i % palette.length];

      if (originType === 0) {
        // City lights & building particles around horizon
        const az = Math.random() * Math.PI * 2;
        const r = 8.0 + Math.random() * 14.0;
        sx = Math.sin(az) * r;
        sy = 0.4 + Math.random() * 6.5;
        sz = -Math.cos(az) * r;
        col = Math.random() < 0.5 ? palette[5] : palette[0]; // Gold & cyan city embers
      } else if (originType === 1) {
        // Crystal lotus energy & petals rising from lotus core (0, 1.3, -3.5)
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 2.2;
        sx = Math.cos(ang) * r;
        sy = 1.0 + Math.random() * 1.4;
        sz = -3.5 + Math.sin(ang) * r;
        col = Math.random() < 0.5 ? palette[4] : palette[2]; // Pink & lavender crystal energy
      } else if (originType === 2) {
        // Cosmic ocean water & aurora currents lifting from water surface
        const az = Math.random() * Math.PI * 2;
        const r = 3.5 + Math.random() * 22.0;
        sx = Math.sin(az) * r;
        sy = 0.1 + Math.random() * 0.8;
        sz = -Math.cos(az) * r;
        col = Math.random() < 0.5 ? palette[1] : palette[0]; // Turquoise & cyan ocean
      } else {
        // Firework remnants & sparkling bubble glitter in 360° sky
        const az = Math.random() * Math.PI * 2;
        const r = 4.0 + Math.random() * 20.0;
        sx = Math.sin(az) * r;
        sy = 2.0 + Math.random() * 11.0;
        sz = -Math.cos(az) * r;
        col = palette[Math.floor(Math.random() * palette.length)];
      }

      sourcePos[i3] = sx;
      sourcePos[i3 + 1] = sy;
      sourcePos[i3 + 2] = sz;

      // Peaceful dispersion outward & upward into the distant cosmos during outro
      const dLen = Math.hypot(tx, tz) || 1;
      disperseDir[i3] = (tx / dLen) * (4.0 + Math.random() * 8.0) + (Math.random() - 0.5) * 4.0;
      disperseDir[i3 + 1] = 3.5 + Math.random() * 7.5;
      disperseDir[i3 + 2] = (tz / dLen) * (4.0 + Math.random() * 8.0) + (Math.random() - 0.5) * 4.0;

      // Golden-white chest highlight bias for particles near chest
      const chestDist = Math.hypot(tx - this.chestCenter.x, ty - this.chestCenter.y, tz - this.chestCenter.z);
      if (chestDist < 1.8 && Math.random() < 0.65) {
        col = palette[6];
      }

      colors[i3] = col.r;
      colors[i3 + 1] = col.g;
      colors[i3 + 2] = col.b;

      sizes[i] = isSilhouette ? (0.14 + Math.random() * 0.24) : (0.11 + Math.random() * 0.18);
      delays[i] = Math.max(0, Math.min(0.45, regionProg * 0.38 + Math.random() * 0.08));
      phases[i] = Math.random() * Math.PI * 2;
    }

    this.particleGeo = new BufferGeometry();
    this.particleGeo.setAttribute('position', new BufferAttribute(targetPos, 3));
    this.particleGeo.setAttribute('aSourcePos', new BufferAttribute(sourcePos, 3));
    this.particleGeo.setAttribute('aDisperseDir', new BufferAttribute(disperseDir, 3));
    this.particleGeo.setAttribute('aColor', new BufferAttribute(colors, 3));
    this.particleGeo.setAttribute('aSize', new BufferAttribute(sizes, 1));
    this.particleGeo.setAttribute('aDelay', new BufferAttribute(delays, 1));
    this.particleGeo.setAttribute('aPhase', new BufferAttribute(phases, 1));

    this.particleMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGatherProgress: { value: 0 },   // 0 (at source) -> 1 (formed)
        uDissolveProgress: { value: 0 }, // 0 -> 1 drifting into distance
        uMasterAlpha: { value: 0 },
        uEnergy: { value: 0 },
        uHigh: { value: 0 },
      },
      vertexShader: `
        attribute vec3 aSourcePos;
        attribute vec3 aDisperseDir;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aDelay;
        attribute float aPhase;

        uniform float uTime;
        uniform float uGatherProgress;
        uniform float uDissolveProgress;
        uniform float uMasterAlpha;
        uniform float uEnergy;
        uniform float uHigh;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = aColor;

          // Smooth spiral convergence from previous phases into silhouette target
          float localT = clamp((uGatherProgress - aDelay) / max(0.25, 1.0 - aDelay), 0.0, 1.0);
          float ease = localT * localT * (3.0 - 2.0 * localT);
          vec3 pos = mix(aSourcePos, position, ease);

          // Helical swirl in mid-flight while gathering
          float swirlAmp = sin(ease * 3.14159) * 2.2;
          float swirlAng = aPhase + uTime * 1.4 + ease * 4.0;
          pos.x += cos(swirlAng) * swirlAmp;
          pos.z += sin(swirlAng) * swirlAmp;
          pos.y += sin(ease * 3.14159) * 1.1;

          // Living subtle shimmer drift once formed
          float driftAmp = ease * (1.0 - uDissolveProgress) * (0.10 + uEnergy * 0.14);
          pos.x += sin(uTime * 1.6 + aPhase) * driftAmp;
          pos.y += cos(uTime * 1.3 + aPhase * 1.7) * driftAmp;
          pos.z += sin(uTime * 1.1 + aPhase * 0.6) * driftAmp;

          // Final quieter passage dissolution: particles drift into cosmic distance
          float dispEase = uDissolveProgress * uDissolveProgress;
          pos += aDisperseDir * dispEase;

          float twinkle = 0.6 + 0.4 * sin(uTime * 6.0 + aPhase);
          float outroFade = 1.0 - smoothstep(0.55, 1.0, uDissolveProgress);
          vAlpha = uMasterAlpha * twinkle * outroFade * (0.72 + uHigh * 0.28);

          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          float pSize = aSize * (1.0 + uHigh * 0.25) * (950.0 / max(1.5, -mvPos.z));
          gl_PointSize = clamp(pSize, 2.0, 32.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          if (vAlpha <= 0.005) discard;
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;

          float starH = max(0.0, 1.0 - abs(c.x) * 4.6) * max(0.0, 1.0 - abs(c.y) * 1.8);
          float starV = max(0.0, 1.0 - abs(c.y) * 4.6) * max(0.0, 1.0 - abs(c.x) * 1.8);
          float core = exp(-d * 11.0) * 1.35;
          float glow = pow(max(0.0, 1.0 - d * 2.0), 2.0) * 0.55;
          float a = clamp(max(starH, starV) * 0.9 + core + glow, 0.0, 1.0) * vAlpha;

          vec3 col = mix(vColor, vec3(1.0, 0.98, 0.94), clamp(core * 0.65, 0.0, 1.0));
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.particlePoints = new Points(this.particleGeo, this.particleMat);
    this.particlePoints.frustumCulled = false;
    this.figureRoot.add(this.particlePoints);
  }

  // ─── 7. Anchoring & Per-Frame Music-Synced Animation ──────────────────────

  private anchorToSeatedUser(world?: World, camera?: Camera): void {
    if (this.hasAnchored) return;
    this.hasAnchored = true;

    if (!camera) return;

    if (world?.renderer?.xr?.isPresenting) {
      const xrCam = world.renderer.xr.getCamera();
      xrCam.getWorldPosition(this.scratchHeadPos);
      xrCam.getWorldQuaternion(this.scratchHeadQuat);
    } else {
      camera.getWorldPosition(this.scratchHeadPos);
      camera.getWorldQuaternion(this.scratchHeadQuat);
    }

    this.anchorForward.set(0, 0, -1).applyQuaternion(this.scratchHeadQuat);
    this.anchorForward.y = 0;
    if (this.anchorForward.lengthSq() < 0.001) {
      this.anchorForward.set(0, 0, -1);
    } else {
      this.anchorForward.normalize();
    }

    // Align figureRoot horizontally around seated origin facing the user's entry direction
    this.anchorPosition.set(this.scratchHeadPos.x, 0, this.scratchHeadPos.z);
    this.figureRoot.position.copy(this.anchorPosition);
    const yaw = Math.atan2(-this.anchorForward.x, -this.anchorForward.z);
    this.figureRoot.rotation.set(0, yaw, 0);
  }

  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics, world?: World, camera?: Camera): void {
    // Inactive before Phase 2->3 ascent (161.0s)
    if (relativeTime < AWAKENING_TIMELINE.tGatherStart) {
      if (this.group.visible) {
        this.group.visible = false;
      }
      if (relativeTime < 155.0 && (this.isRevealed || this.hasAnchored)) {
        this.isRevealed = false;
        this.hasAnchored = false;
      }
      for (let f = 0; f < this.activeFlashes.length; f++) {
        this.activeFlashes[f].intensity = 0;
      }
      return;
    }

    if (!this.group.visible) {
      this.group.visible = true;
    }
    this.group.scale.set(1, 1, 1);

    if (!this.isRevealed) {
      this.isRevealed = true;
      this.anchorToSeatedUser(world, camera);
      console.log(`[CosmicAwakening] Phase 3 formation started at ${relativeTime.toFixed(2)}s`);
    }

    const low = metrics?.low ?? 0;
    const mid = metrics?.mid ?? 0;
    const high = metrics?.high ?? 0;
    const energy = metrics?.energy ?? 0;
    const beat = metrics?.beat ?? 0;

    // 1. Timeline Progression Curves
    // Gathering (161s -> 178s)
    const gatherT = Math.max(0, Math.min(1,
      (relativeTime - AWAKENING_TIMELINE.tGatherStart) /
      (AWAKENING_TIMELINE.tFullAwakening - AWAKENING_TIMELINE.tGatherStart)
    ));
    // Body silhouette forms gradually bottom-up (166.5s -> 182.0s)
    const formT = Math.max(0, Math.min(1,
      (relativeTime - AWAKENING_TIMELINE.tBodyStart) / 15.5
    ));
    const formEased = formT * formT * (3 - 2 * formT);

    // Final quieter passage dissolution (250.0s -> 266.92s)
    const dissolveT = relativeTime >= AWAKENING_TIMELINE.tDissolveStart
      ? Math.max(0, Math.min(1,
          (relativeTime - AWAKENING_TIMELINE.tDissolveStart) /
          (AWAKENING_TIMELINE.tFadeEnd - AWAKENING_TIMELINE.tDissolveStart)
        ))
      : 0;

    // Master fade in (161s -> 165s) and peaceful fade out at very end (259s -> 266.92s)
    const introAlpha = Math.max(0, Math.min(1, (relativeTime - AWAKENING_TIMELINE.tGatherStart) / 4.0));
    const endFade = relativeTime >= 258.5
      ? Math.max(0, 1.0 - (relativeTime - 258.5) / (AWAKENING_TIMELINE.tFadeEnd - 258.5))
      : 1.0;
    const masterAlpha = introAlpha * endFade;

    // 2. Body Material Uniforms
    const bodyU = this.bodyMaterial.uniforms;
    bodyU.uTime.value = relativeTime;
    bodyU.uFormProgress.value = formEased;
    bodyU.uDissolveProgress.value = Math.min(1, dissolveT * 1.45);
    bodyU.uEnergy.value = energy;
    bodyU.uMid.value = mid;
    bodyU.uHigh.value = high;
    bodyU.uLow.value = low;
    bodyU.uMasterAlpha.value = masterAlpha * (0.78 + energy * 0.28);

    // 3. Chest Golden-White Heart Burst (ignites as chest condenses around 170s+)
    const chestBuild = Math.max(0, Math.min(1, (formEased - 0.35) / 0.50));
    const chestFade = 1.0 - Math.min(1, dissolveT * 1.35);
    const chestAlpha = chestBuild * chestFade * endFade;
    const chestPulse = 1.0 + low * 0.25 + beat * 0.22 + energy * 0.14;

    this.chestGroup.visible = chestAlpha > 0.01;
    if (this.chestGroup.visible) {
      this.chestCoreMesh.scale.setScalar(chestPulse * (0.75 + chestBuild * 0.35));
      (this.chestCoreMesh.material as MeshBasicMaterial).opacity = chestAlpha * (0.65 + beat * 0.22);

      this.chestAuraMesh.scale.setScalar(chestPulse * (0.85 + energy * 0.25));
      (this.chestAuraMesh.material as MeshBasicMaterial).opacity = chestAlpha * (0.14 + energy * 0.12);

      this.chestRaysMat.uniforms.uTime.value = relativeTime;
      this.chestRaysMat.uniforms.uAlpha.value = chestAlpha * (0.72 + beat * 0.22);
      this.chestRaysMat.uniforms.uPulse.value = chestPulse;

      if (camera) {
        camera.getWorldPosition(this.scratchCamVec);
        this.chestRaysMesh.lookAt(this.scratchCamVec);
      }
    }

    // 4. Concentric Golden Halo (ignites behind head 173s+, expands & rotates with musical peak)
    const haloBuild = Math.max(0, Math.min(1, (formEased - 0.52) / 0.45));
    const haloFade = 1.0 - Math.min(1, dissolveT * 1.25);
    const haloAlpha = haloBuild * haloFade * endFade;
    const haloExpand = 0.85 + haloBuild * 0.15 + energy * 0.14 + beat * 0.08;

    this.haloGroup.visible = haloAlpha > 0.01;
    if (this.haloGroup.visible) {
      this.haloGroup.scale.setScalar(haloExpand);
      for (let i = 0; i < this.haloRings.length; i++) {
        const ring = this.haloRings[i];
        ring.mesh.rotation.z += ring.speed * (1.0 + energy * 0.8) * deltaSec;
        ring.mat.uniforms.uTime.value = relativeTime;
        ring.mat.uniforms.uAlpha.value = haloAlpha * (0.85 - i * 0.12 + high * 0.22);
      }
      this.haloParticlesMat.uniforms.uTime.value = relativeTime;
      this.haloParticlesMat.uniforms.uAlpha.value = haloAlpha * (0.9 + high * 0.25);
    }

    // 5. 360° Swirling Energy Ribbons (weave continuously around figure & user)
    const ribbonFade = 1.0 - Math.min(1, dissolveT * 1.3);
    const ribbonVis = Math.max(0, Math.min(1, (relativeTime - 165.0) / 10.0)) * ribbonFade * endFade;
    for (let i = 0; i < this.ribbonMeshes.length; i++) {
      const r = this.ribbonMeshes[i];
      r.mesh.visible = ribbonVis > 0.01;
      if (r.mesh.visible) {
        r.mat.uniforms.uTime.value = relativeTime;
        r.mat.uniforms.uAlpha.value = ribbonVis * r.baseOpacity * (0.72 + energy * 0.35 + mid * 0.20);
      }
    }

    // 6. Unified Converging & Dissolving Stardust Particles
    const pU = this.particleMat.uniforms;
    pU.uTime.value = relativeTime;
    pU.uGatherProgress.value = gatherT;
    pU.uDissolveProgress.value = dissolveT;
    pU.uMasterAlpha.value = masterAlpha;
    pU.uEnergy.value = energy;
    pU.uHigh.value = high;

    // 7. Update Ocean Reflection Flashes in world coordinates
    this.activeFlashes[0].position.copy(this.chestCenter).applyMatrix4(this.figureRoot.matrixWorld);
    this.activeFlashes[0].intensity = chestAlpha * (1.1 + energy * 0.5);

    this.scratchWorldPos.set(-8.2, 6.4, this.figZ + 2.5).applyMatrix4(this.figureRoot.matrixWorld);
    this.activeFlashes[1].position.copy(this.scratchWorldPos);
    this.activeFlashes[1].intensity = formEased * (1.0 - dissolveT) * endFade * (0.75 + mid * 0.35);

    this.scratchWorldPos.set(8.2, 6.4, this.figZ + 2.5).applyMatrix4(this.figureRoot.matrixWorld);
    this.activeFlashes[2].position.copy(this.scratchWorldPos);
    this.activeFlashes[2].intensity = formEased * (1.0 - dissolveT) * endFade * (0.75 + mid * 0.35);

    this.activeFlashes[3].position.copy(this.haloCenter).applyMatrix4(this.figureRoot.matrixWorld);
    this.activeFlashes[3].intensity = haloAlpha * (0.95 + high * 0.4);
  }

  getActiveFlashes(): FireworkFlash[] {
    return this.activeFlashes;
  }

  reset(): void {
    this.group.visible = false;
    this.group.scale.set(1, 1, 1);
    this.isRevealed = false;
    this.hasAnchored = false;
    this.figureRoot.position.set(0, 0, 0);
    this.figureRoot.rotation.set(0, 0, 0);
    this.bodyMaterial.uniforms.uMasterAlpha.value = 0;
    this.particleMat.uniforms.uMasterAlpha.value = 0;
    this.particleMat.uniforms.uGatherProgress.value = 0;
    this.particleMat.uniforms.uDissolveProgress.value = 0;
    for (let f = 0; f < this.activeFlashes.length; f++) {
      this.activeFlashes[f].intensity = 0;
    }
    console.log('[CosmicAwakening] Reset cleanly to pristine state');
  }

  dispose(): void {
    this.reset();
    this.bodyMaterial.dispose();
    for (let i = 0; i < this.bodyGeometries.length; i++) {
      this.bodyGeometries[i].dispose();
    }
    this.bodyGeometries.length = 0;
    this.figureMeshes.length = 0;

    this.chestCoreMesh.geometry.dispose();
    (this.chestCoreMesh.material as MeshBasicMaterial).dispose();
    this.chestAuraMesh.geometry.dispose();
    (this.chestAuraMesh.material as MeshBasicMaterial).dispose();
    this.chestRaysMesh.geometry.dispose();
    this.chestRaysMat.dispose();

    for (let i = 0; i < this.haloRings.length; i++) {
      this.haloRings[i].mesh.geometry.dispose();
      this.haloRings[i].mat.dispose();
    }
    this.haloRings.length = 0;
    this.haloParticlesGeo.dispose();
    this.haloParticlesMat.dispose();

    for (let i = 0; i < this.ribbonMeshes.length; i++) {
      this.ribbonMeshes[i].mesh.geometry.dispose();
      this.ribbonMeshes[i].mat.dispose();
    }
    this.ribbonMeshes.length = 0;

    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.group.clear();
  }
}

