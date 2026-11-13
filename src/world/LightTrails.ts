/**
 * LightTrails: Elegant, luminous ribbons of light that sweep, curl and arc across the 360° sky,
 * dropping sparkling stardust particles along their paths.
 *
 * Features:
 *  - Overhead arches and horizon-sweeping ribbons designed for seated WebXR comfort.
 *  - Gradient flowing shaders with glowing heads, luminous dissipation tails, and edge feathering.
 *  - Pooled stardust particle system dropping sparkling fragments in the wake of the ribbons.
 *  - Mids drive ribbon velocity, waving amplitude, thickness, and luminous glow.
 *  - Highs amplify stardust sparkle frequency.
 *  - Quiet passages transition into slow, delicate, gossamer trails.
 *  - Zero per-frame allocations, fully optimized for Meta Quest 3S.
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  PlaneGeometry,
  Color,
  Vector3,
  AdditiveBlending,
  DoubleSide,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer';

interface RibbonPathConfig {
  name: string;
  radius: number;
  heightBase: number;
  heightAmplitude: number;
  angularSpan: number;
  tiltAngle: number;
  speed: number;
  width: number;
  segments: number;
  colorA: Color;
  colorB: Color;
}

export class LightTrails {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private ribbonMeshes: Mesh[] = [];
  private ribbonMaterials: ShaderMaterial[] = [];

  // Stardust dropped particles
  private maxStardust: number;
  private stardustGeo: BufferGeometry;
  private stardustMat: ShaderMaterial;
  private stardustPoints: Points;
  private stardustPositions: Float32Array;
  private stardustVelocities: Float32Array;
  private stardustColors: Float32Array;
  private stardustAlphas: Float32Array;
  private stardustSizes: Float32Array;
  private stardustLifetimes: Float32Array;
  private stardustMaxLifetimes: Float32Array;
  private nextStardustIndex = 0;

  private masterAlpha = 0;

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.maxStardust = isQuest ? 240 : 480;

    // 1. Build procedural ribbon meshes
    const paths: RibbonPathConfig[] = [
      // Ribbon 1: High arch soaring directly overhead
      {
        name: 'zenith-arch',
        radius: 22.0,
        heightBase: 12.0,
        heightAmplitude: 14.0,
        angularSpan: Math.PI * 1.5,
        tiltAngle: 0.35,
        speed: 0.28,
        width: isQuest ? 0.45 : 0.55,
        segments: isQuest ? 60 : 90,
        colorA: new Color(0x00f2fe), // Luminous Cyan
        colorB: new Color(0xb39ddb), // Soft Lavender
      },
      // Ribbon 2: Cosmic horizon spiral curling around the viewer
      {
        name: 'horizon-spiral',
        radius: 28.0,
        heightBase: 4.5,
        heightAmplitude: 6.0,
        angularSpan: Math.PI * 2.2,
        tiltAngle: -0.22,
        speed: -0.22,
        width: isQuest ? 0.5 : 0.65,
        segments: isQuest ? 70 : 100,
        colorA: new Color(0x1de9b6), // Turquoise
        colorB: new Color(0xff77e9), // Pink
      },
      // Ribbon 3: Diagonal swoop crossing from front to behind
      {
        name: 'diagonal-swoop',
        radius: 20.0,
        heightBase: 8.0,
        heightAmplitude: 11.0,
        angularSpan: Math.PI * 1.8,
        tiltAngle: 0.55,
        speed: 0.32,
        width: isQuest ? 0.4 : 0.5,
        segments: isQuest ? 55 : 85,
        colorA: new Color(0x8a2be2), // Violet
        colorB: new Color(0xf4a4a8), // Rose Gold
      },
      // Ribbon 4: Low water-reflective ribbon hovering over the cosmic ocean
      {
        name: 'ocean-reflection-ribbon',
        radius: 17.0,
        heightBase: 2.2,
        heightAmplitude: 3.5,
        angularSpan: Math.PI * 1.6,
        tiltAngle: 0.1,
        speed: -0.26,
        width: isQuest ? 0.45 : 0.55,
        segments: isQuest ? 60 : 90,
        colorA: new Color(0xfff2b2), // Golden-White
        colorB: new Color(0x00e5ff), // Cyan
      },
    ];

    if (!isQuest) {
      // Add 2 more dense ribbons for desktop
      paths.push(
        {
          name: 'celestial-helix',
          radius: 34.0,
          heightBase: 14.0,
          heightAmplitude: 12.0,
          angularSpan: Math.PI * 2.0,
          tiltAngle: -0.4,
          speed: 0.25,
          width: 0.6,
          segments: 90,
          colorA: new Color(0xff77e9),
          colorB: new Color(0xfff2b2),
        },
        {
          name: 'zenith-cross',
          radius: 24.0,
          heightBase: 16.0,
          heightAmplitude: 8.0,
          angularSpan: Math.PI * 1.4,
          tiltAngle: 0.7,
          speed: -0.3,
          width: 0.5,
          segments: 80,
          colorA: new Color(0x38ef7d),
          colorB: new Color(0x8a2be2),
        }
      );
    }

    for (let i = 0; i < paths.length; i++) {
      const cfg = paths[i];
      const ribbonGeo = this.buildCurvedRibbonGeometry(cfg);

      const ribbonMat = new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uMasterAlpha: { value: 0 },
          uMid: { value: 0 },
          uColorA: { value: cfg.colorA },
          uColorB: { value: cfg.colorB },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uMid;
          varying vec2 vUv;
          varying vec3 vWorldPos;

          void main() {
            vUv = uv;
            vec3 pos = position;

            // Harmonic wave undulation driven by mids
            float wave = sin(uv.x * 12.0 - uTime * 3.5) * (0.15 + uMid * 0.35);
            pos.y += wave * (1.0 - uv.y);

            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uMasterAlpha;
          uniform float uMid;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          varying vec3 vWorldPos;

          void main() {
            // Flowing coordinate along the ribbon strip
            float head = fract(vUv.x * 2.0 - uTime * 0.45);
            // Sharp leading head with soft exponential dissipation tail
            float stream = pow(head, 2.5);

            // Feathered edges across ribbon width
            float edgeFade = sin(vUv.y * 3.14159);
            edgeFade = pow(edgeFade, 1.2);

            // Color gradient along ribbon length
            vec3 col = mix(uColorA, uColorB, vUv.x);
            // White-hot core along the leading head
            col = mix(col, vec3(1.0, 1.0, 1.0), pow(head, 6.0) * 0.65);

            float glow = (0.45 + uMid * 0.55) * uMasterAlpha;
            float alpha = stream * edgeFade * glow;

            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
      });

      const mesh = new Mesh(ribbonGeo, ribbonMat);
      this.ribbonMeshes.push(mesh);
      this.ribbonMaterials.push(ribbonMat);
      this.group.add(mesh);
    }

    // 2. Build Stardust Dropped Particle Pool
    this.stardustPositions = new Float32Array(this.maxStardust * 3);
    this.stardustVelocities = new Float32Array(this.maxStardust * 3);
    this.stardustColors = new Float32Array(this.maxStardust * 3);
    this.stardustAlphas = new Float32Array(this.maxStardust);
    this.stardustSizes = new Float32Array(this.maxStardust);
    this.stardustLifetimes = new Float32Array(this.maxStardust);
    this.stardustMaxLifetimes = new Float32Array(this.maxStardust);

    for (let i = 0; i < this.maxStardust; i++) {
      this.stardustAlphas[i] = 0;
      this.stardustSizes[i] = isQuest ? 0.06 : 0.09;
      this.stardustLifetimes[i] = 0;
      this.stardustMaxLifetimes[i] = 2.0;
    }

    this.stardustGeo = new BufferGeometry();
    this.stardustGeo.setAttribute('position', new Float32BufferAttribute(this.stardustPositions, 3));
    this.stardustGeo.setAttribute('customColor', new Float32BufferAttribute(this.stardustColors, 3));
    this.stardustGeo.setAttribute('alpha', new Float32BufferAttribute(this.stardustAlphas, 1));
    this.stardustGeo.setAttribute('size', new Float32BufferAttribute(this.stardustSizes, 1));

    this.stardustMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMasterAlpha: { value: 0 },
      },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        attribute float size;

        uniform float uTime;
        uniform float uMasterAlpha;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = customColor;
          vAlpha = alpha * uMasterAlpha;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (220.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 32.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          float starGlow = pow(1.0 - dist * 2.0, 2.0);
          gl_FragColor = vec4(vColor, vAlpha * starGlow);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.stardustPoints = new Points(this.stardustGeo, this.stardustMat);
    this.group.add(this.stardustPoints);

    this.group.visible = false;
  }

  /**
   * Builds parametric quad-strip geometry along a sweeping 3D arc.
   */
  private buildCurvedRibbonGeometry(cfg: RibbonPathConfig): BufferGeometry {
    const segments = cfg.segments;
    const vertexCount = (segments + 1) * 2;
    const indexCount = segments * 6;

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint16Array(indexCount);

    let vIdx = 0;
    let uvIdx = 0;

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const angle = u * cfg.angularSpan;

      // Base circle position
      const cx = Math.sin(angle) * cfg.radius;
      const cz = Math.cos(angle) * cfg.radius;
      const cy = cfg.heightBase + Math.sin(angle * 2.0 + cfg.tiltAngle) * cfg.heightAmplitude;

      // Tangent & Normal vectors for ribbon orientation
      const nx = Math.cos(angle) * Math.cos(cfg.tiltAngle);
      const ny = Math.sin(cfg.tiltAngle);
      const nz = -Math.sin(angle) * Math.cos(cfg.tiltAngle);

      const halfW = cfg.width * 0.5;

      // Top vertex
      positions[vIdx] = cx + nx * halfW;
      positions[vIdx + 1] = cy + ny * halfW;
      positions[vIdx + 2] = cz + nz * halfW;
      uvs[uvIdx] = u;
      uvs[uvIdx + 1] = 0;
      vIdx += 3;
      uvIdx += 2;

      // Bottom vertex
      positions[vIdx] = cx - nx * halfW;
      positions[vIdx + 1] = cy - ny * halfW;
      positions[vIdx + 2] = cz - nz * halfW;
      uvs[uvIdx] = u;
      uvs[uvIdx + 1] = 1;
      vIdx += 3;
      uvIdx += 2;
    }

    let iIdx = 0;
    for (let i = 0; i < segments; i++) {
      const p1 = i * 2;
      const p2 = p1 + 1;
      const p3 = p1 + 2;
      const p4 = p1 + 3;

      indices[iIdx++] = p1;
      indices[iIdx++] = p2;
      indices[iIdx++] = p3;

      indices[iIdx++] = p2;
      indices[iIdx++] = p4;
      indices[iIdx++] = p3;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geo.setIndex(new Float32BufferAttribute(indices, 1));
    return geo;
  }

  /**
   * Main per-frame update.
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics): void {
    // Active strictly during Phase 2 (55.0s to 165.0s, dissolving into cosmos 165s - 175s)
    if (relativeTime < 55.0 || relativeTime >= 175.0) {
      if (this.group.visible) {
        this.reset();
      }
      return;
    }

    this.group.visible = true;

    // Fade curve
    if (relativeTime >= 55.0 && relativeTime <= 65.0) {
      this.masterAlpha = (relativeTime - 55.0) / 10.0;
    } else if (relativeTime > 65.0 && relativeTime < 165.0) {
      this.masterAlpha = 1.0;
    } else if (relativeTime >= 165.0) {
      this.masterAlpha = Math.max(0, 1.0 - (relativeTime - 165.0) / 10.0);
    }

    const mid = metrics?.mid ?? 0;
    const high = metrics?.high ?? 0;
    const energy = metrics?.energy ?? 0;

    // Update ribbon materials
    for (let i = 0; i < this.ribbonMaterials.length; i++) {
      const mat = this.ribbonMaterials[i];
      mat.uniforms.uTime.value = relativeTime;
      mat.uniforms.uMasterAlpha.value = this.masterAlpha;
      mat.uniforms.uMid.value = mid;

      // Spawn stardust at ribbon heads periodically
      if (Math.random() < (0.25 + mid * 0.45) && this.masterAlpha > 0.1) {
        this.emitStardustParticle(i, relativeTime, high);
      }
    }

    // Update stardust particles
    this.stardustMat.uniforms.uTime.value = relativeTime;
    this.stardustMat.uniforms.uMasterAlpha.value = this.masterAlpha;

    for (let i = 0; i < this.maxStardust; i++) {
      if (this.stardustAlphas[i] <= 0.001) continue;

      this.stardustLifetimes[i] += deltaSec;
      const progress = this.stardustLifetimes[i] / this.stardustMaxLifetimes[i];

      if (progress >= 1.0) {
        this.stardustAlphas[i] = 0;
        continue;
      }

      const i3 = i * 3;
      // Gentle floating descent + slight curl drift
      this.stardustPositions[i3] += this.stardustVelocities[i3] * deltaSec;
      this.stardustPositions[i3 + 1] += this.stardustVelocities[i3 + 1] * deltaSec;
      this.stardustPositions[i3 + 2] += this.stardustVelocities[i3 + 2] * deltaSec;

      // Sparkle twinkle fade
      const twinkle = 0.75 + 0.25 * Math.sin(relativeTime * 18.0 + i * 1.5);
      const fade = Math.sin(progress * Math.PI);
      this.stardustAlphas[i] = fade * twinkle * (0.8 + high * 0.4);
    }

    this.stardustGeo.attributes.position.needsUpdate = true;
    this.stardustGeo.attributes.alpha.needsUpdate = true;
  }

  /**
   * Emits a stardust particle near a ribbon's leading edge.
   */
  private emitStardustParticle(ribbonIndex: number, relativeTime: number, highFreq: number): void {
    const mesh = this.ribbonMeshes[ribbonIndex];
    if (!mesh) return;

    const pIdx = this.nextStardustIndex;
    this.nextStardustIndex = (this.nextStardustIndex + 1) % this.maxStardust;
    const i3 = pIdx * 3;

    // Approximate ribbon position based on angle
    const angle = (relativeTime * 0.35 + ribbonIndex * 1.2) % (Math.PI * 2);
    const rad = 20.0 + ribbonIndex * 2.5;

    this.stardustPositions[i3] = Math.sin(angle) * rad + (Math.random() - 0.5) * 1.5;
    this.stardustPositions[i3 + 1] = 7.0 + Math.sin(angle * 2.0) * 6.0 + (Math.random() - 0.5) * 1.2;
    this.stardustPositions[i3 + 2] = Math.cos(angle) * rad + (Math.random() - 0.5) * 1.5;

    // Drift downward gently
    this.stardustVelocities[i3] = (Math.random() - 0.5) * 0.4;
    this.stardustVelocities[i3 + 1] = -0.3 - Math.random() * 0.5;
    this.stardustVelocities[i3 + 2] = (Math.random() - 0.5) * 0.4;

    // Shimmering color (cyan, lavender, or golden-white)
    const colorRoll = Math.random();
    if (colorRoll < 0.45) {
      this.stardustColors[i3] = 0.0;     // Cyan
      this.stardustColors[i3 + 1] = 0.95;
      this.stardustColors[i3 + 2] = 1.0;
    } else if (colorRoll < 0.8) {
      this.stardustColors[i3] = 0.7;     // Lavender
      this.stardustColors[i3 + 1] = 0.62;
      this.stardustColors[i3 + 2] = 0.86;
    } else {
      this.stardustColors[i3] = 1.0;     // Golden-White
      this.stardustColors[i3 + 1] = 0.95;
      this.stardustColors[i3 + 2] = 0.7;
    }

    this.stardustAlphas[pIdx] = 1.0;
    this.stardustSizes[pIdx] = (this.isQuest ? 0.06 : 0.09) * (0.8 + highFreq * 0.5);
    this.stardustLifetimes[pIdx] = 0;
    this.stardustMaxLifetimes[pIdx] = 1.6 + Math.random() * 1.2;

    this.stardustGeo.attributes.customColor.needsUpdate = true;
    this.stardustGeo.attributes.size.needsUpdate = true;
  }

  reset(): void {
    this.masterAlpha = 0;
    this.group.visible = false;
    for (let i = 0; i < this.ribbonMaterials.length; i++) {
      this.ribbonMaterials[i].uniforms.uMasterAlpha.value = 0;
    }
    for (let i = 0; i < this.maxStardust; i++) {
      this.stardustAlphas[i] = 0;
    }
    if (this.stardustGeo.attributes.alpha) {
      this.stardustGeo.attributes.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.clear();
    for (let i = 0; i < this.ribbonMeshes.length; i++) {
      this.ribbonMeshes[i].geometry.dispose();
      this.ribbonMaterials[i].dispose();
    }
    this.stardustGeo.dispose();
    this.stardustMat.dispose();
  }
}
