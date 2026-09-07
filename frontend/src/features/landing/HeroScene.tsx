import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { chartTokens } from "../../charts/theme";
import type { ResolvedTheme } from "../../design/theme";
import "./HeroScene.css";

/**
 * The hero's sculpture: three panes of glass, a rising curve, six bars and a
 * few coins, lit in the application's own two accents.
 *
 * Abstract on purpose. The flat preview it replaces carries fabricated figures
 * and says so in French; this one carries no figure at all, so there is
 * nothing here a visitor could mistake for their own account. It is a shape,
 * not a screenshot.
 *
 * Everything is built in one effect and disposed in its cleanup — three.js
 * holds GPU memory the garbage collector cannot reach, so a geometry or a
 * material left undisposed on a theme change is a leak that grows for as long
 * as the page is open.
 *
 * The whole module is loaded lazily by LandingPage: three.js is the largest
 * dependency in the project and nothing else uses it, so it must not sit in
 * the chunk every authenticated screen pays for.
 */

interface HeroSceneProps {
  resolved: ResolvedTheme;
  /**
   * One frame, no loop, no pointer parallax. The sculpture is still worth
   * showing when motion is off — what is not worth showing is a permanent
   * animation to a reader who asked for none.
   */
  still: boolean;
  /**
   * This machine cannot render it at all — no WebGL, or a context the driver
   * refused. The page falls back to the flat preview. Never a silent empty
   * box: the hero has to hold something.
   */
  onUnavailable: () => void;
}

/** The signature easing, as a scalar. Its CSS twin is `--yd-ease`. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** How tall each bar stands, and how far along the accent ramp it is tinted. */
const BARS = [0.34, 0.52, 0.42, 0.74, 0.58, 0.96];

/** Where the curve passes, left to right, in the front pane's own space. */
const CURVE_POINTS: [number, number][] = [
  [-0.95, -0.18],
  [-0.6, 0.02],
  [-0.25, -0.1],
  [0.1, 0.2],
  [0.45, 0.14],
  [0.78, 0.38],
  [0.98, 0.3],
];

export default function HeroScene({ resolved, still, onUnavailable }: HeroSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // React runs effects twice in development's StrictMode, and a refused
  // context must be reported once — not once per mount attempt.
  const reportedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const tones = chartTokens(resolved);
    const canvas = document.createElement("canvas");
    canvas.className = "yd-hero3d__canvas";

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      if (!reportedRef.current) {
        reportedRef.current = true;
        onUnavailable();
      }
      return;
    }

    host.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = resolved === "dark" ? 1.15 : 1.35;

    const scene = new THREE.Scene();

    // Reflections with no file to fetch. This app loads nothing from a CDN —
    // not a font, and not an HDR environment map either — so the panes take
    // their highlights from a procedural room rendered once into a cube map.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    // Enough for the panes to catch a highlight — glass with nothing to
    // reflect is a dark rectangle with an outline — and no more: past ~0.6 the
    // room's own grey washes the accents out of everything in front of it.
    scene.environmentIntensity = resolved === "dark" ? 0.45 : 0.75;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.12, 5.7);
    camera.lookAt(0, 0, 0);

    // Everything disposable, in one list: the cleanup below walks it rather
    // than trying to remember each mesh by name.
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const accent = new THREE.Color(tones.accent);
    const accentStrong = new THREE.Color(tones.accentStrong);
    const positive = new THREE.Color(tones.positive);
    const info = new THREE.Color(tones.info);

    scene.add(new THREE.AmbientLight(0xffffff, resolved === "dark" ? 0.45 : 1.1));

    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3.2, 4.1, 5);
    scene.add(key);

    const accentLight = new THREE.PointLight(accent, 26, 16, 2);
    accentLight.position.set(-3.3, 1.5, 2.3);
    scene.add(accentLight);

    const positiveLight = new THREE.PointLight(positive, 18, 16, 2);
    positiveLight.position.set(3.1, -1.7, -1.3);
    scene.add(positiveLight);

    // The rig: one group for the whole sculpture, so the pointer moves the
    // object rather than the camera — a moving camera makes the page itself
    // feel unstable.
    const rig = new THREE.Group();
    // Nudged off centre: the sculpture leans toward the copy it belongs to
    // rather than sitting square in its own column.
    rig.position.x = -0.12;
    scene.add(rig);

    // -- The three panes ----------------------------------------------------
    const paneGeometry = track(new RoundedBoxGeometry(2.42, 1.56, 0.05, 4, 0.09));
    const paneSpecs = [
      { pos: [-0.62, 0.46, -0.62], rotY: 0.34, opacity: 0.34 },
      { pos: [-0.2, 0.14, -0.24], rotY: 0.3, opacity: 0.5 },
      { pos: [0.22, -0.2, 0.16], rotY: 0.26, opacity: 0.72 },
    ] as const;

    const panes = paneSpecs.map((spec) => {
      const material = track(
        new THREE.MeshPhysicalMaterial({
          // Tinted by the accent rather than by the card surface: at
          // --yd-surface-strong alone the panes read as three black rectangles
          // with an outline, which is a wireframe, not a sculpture.
          //
          // No `transmission`. Real refraction was tried and rejected in the
          // browser: frosted glass desaturates everything behind it, and what
          // is behind these panes is the coloured bars that carry the whole
          // image. Alpha plus a hard clearcoat gives the same depth and keeps
          // the accents.
          color: new THREE.Color(tones.surfaceStrong).lerp(
            new THREE.Color(tones.accent),
            0.34,
          ),
          metalness: 0.2,
          roughness: 0.1,
          envMapIntensity: 1.7,
          transparent: true,
          opacity: spec.opacity,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
        }),
      );
      const mesh = new THREE.Mesh(paneGeometry, material);
      mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      mesh.rotation.set(-0.05, spec.rotY, 0.02);
      rig.add(mesh);
      return { mesh, material, opacity: spec.opacity };
    });

    const front = panes[2].mesh;

    // -- The curve, drawn on the front pane ---------------------------------
    const curve = new THREE.CatmullRomCurve3(
      CURVE_POINTS.map(([x, y]) => new THREE.Vector3(x, y + 0.3, 0.05)),
    );
    const curveGeometry = track(new THREE.TubeGeometry(curve, 96, 0.026, 10, false));
    const curveMaterial = track(
      new THREE.MeshStandardMaterial({
        // The one line in the image that has to read as the app's own colour
        // at a glance. Lit almost entirely by its own emission: under the key
        // light alone it came out white, which is every other product's line
        // chart.
        color: accent,
        emissive: accent,
        // Under ACES tone mapping an emissive indigo above ~0.8 clips to
        // white, which is every other product's line chart.
        emissiveIntensity: 0.6,
        roughness: 0.45,
        metalness: 0,
      }),
    );
    front.add(new THREE.Mesh(curveGeometry, curveMaterial));

    const headGeometry = track(new THREE.SphereGeometry(0.055, 24, 24));
    const headMaterial = track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: accentStrong,
        emissiveIntensity: 0.9,
        roughness: 0.2,
      }),
    );
    const head = new THREE.Mesh(headGeometry, headMaterial);
    const last = CURVE_POINTS[CURVE_POINTS.length - 1];
    head.position.set(last[0], last[1] + 0.3, 0.05);
    front.add(head);

    // -- The bars -----------------------------------------------------------
    const barGeometry = track(new RoundedBoxGeometry(0.15, 1, 0.15, 3, 0.035));
    const bars = BARS.map((height, index) => {
      const ramp = index / (BARS.length - 1);
      const color = info.clone().lerp(accent, Math.min(ramp * 1.6, 1));
      if (index === BARS.length - 1) color.copy(positive);
      const material = track(
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.3,
          roughness: 0.22,
          metalness: 0.35,
        }),
      );
      const mesh = new THREE.Mesh(barGeometry, material);
      mesh.position.set(-0.66 + index * 0.264, 0, 0.06);
      front.add(mesh);
      return { mesh, height };
    });

    // -- The coins ----------------------------------------------------------
    const coinGeometry = track(new THREE.CylinderGeometry(0.19, 0.19, 0.035, 44));
    const coinSpecs = [
      { pos: [-1.85, 0.98, 0.9], color: accent, spin: 0.5 },
      { pos: [1.72, 0.62, 0.5], color: positive, spin: -0.36 },
      { pos: [-1.42, -1.02, 1.2], color: accentStrong, spin: 0.42 },
      { pos: [1.5, -1.18, -0.3], color: info, spin: -0.28 },
    ] as const;

    const coins = coinSpecs.map((spec, index) => {
      const material = track(
        new THREE.MeshStandardMaterial({
          color: spec.color,
          // Metal, but not a mirror: past ~0.8 the coins reflect the grey room
          // instead of carrying their own colour, and four white discs is not
          // a palette.
          metalness: 0.6,
          roughness: 0.22,
          envMapIntensity: 1.2,
        }),
      );
      const mesh = new THREE.Mesh(coinGeometry, material);
      mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      mesh.rotation.set(1.2, 0.4 * index, 0.3);
      rig.add(mesh);
      return { mesh, spin: spec.spin, baseY: spec.pos[1], phase: index * 1.4 };
    });

    // -- The orbit ----------------------------------------------------------
    const ringGeometry = track(new THREE.TorusGeometry(2.05, 0.011, 10, 160));
    const ringMaterial = track(
      new THREE.MeshStandardMaterial({
        color: accentStrong,
        emissive: accent,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.55,
        roughness: 0.4,
      }),
    );
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.set(1.15, 0.3, 0);
    rig.add(ring);

    // -- Layout -------------------------------------------------------------
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // -- Motion -------------------------------------------------------------
    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };

    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    const onPointerLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };

    const clock = new THREE.Clock();
    let frame = 0;

    /**
     * Whether the stage is anywhere near the viewport.
     *
     * Read from the element's own box on each frame rather than kept as a flag
     * an observer flips. An IntersectionObserver was tried and rejected: in a
     * background or occluded tab its first callback reports "not intersecting"
     * and never fires again, which leaves the flag stuck off and the sculpture
     * blank for the whole life of the page. A hidden TAB needs no handling at
     * all — the browser already stops firing requestAnimationFrame.
     */
    const onScreen = (): boolean => {
      const rect = host.getBoundingClientRect();
      return rect.bottom > -200 && rect.top < window.innerHeight + 200;
    };

    /** 0 on the first frame, 1 once the sculpture has finished arriving. */
    const entry = (elapsed: number): number => easeOut(Math.min(elapsed / 1.1, 1));

    const draw = (progress: number, time: number) => {
      rig.scale.setScalar(0.88 + 0.12 * progress);
      panes.forEach(({ material, opacity }) => {
        material.opacity = opacity * progress;
      });
      ringMaterial.opacity = 0.55 * progress;
      bars.forEach(({ mesh, height }) => {
        const grown = Math.max(height * progress, 0.0001);
        mesh.scale.y = grown;
        // A box grows from its centre, so its foot has to be pushed back down
        // to the baseline as it rises.
        mesh.position.y = -0.52 + grown / 2;
      });

      if (!still) {
        eased.x += (pointer.x - eased.x) * 0.045;
        eased.y += (pointer.y - eased.y) * 0.045;
        rig.rotation.y = eased.x * 0.3 + Math.sin(time * 0.24) * 0.055;
        rig.rotation.x = -eased.y * 0.17 + Math.sin(time * 0.31) * 0.032;
        rig.position.y = Math.sin(time * 0.5) * 0.045;
        ring.rotation.z = time * 0.06;
        coins.forEach((coin) => {
          coin.mesh.rotation.y = time * coin.spin;
          coin.mesh.position.y = coin.baseY + Math.sin(time * 0.6 + coin.phase) * 0.09;
        });
      }

      renderer.render(scene, camera);
    };

    if (still) {
      draw(1, 0);
    } else {
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (!onScreen()) return;
        const time = clock.getElapsedTime();
        draw(entry(time), time);
      };
      frame = requestAnimationFrame(loop);
      host.addEventListener("pointermove", onPointerMove);
      host.addEventListener("pointerleave", onPointerLeave);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      disposables.forEach((item) => item.dispose());
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [resolved, still, onUnavailable]);

  // Decorative: the hero's meaning is entirely in the headline beside it.
  return <div className="yd-hero3d" ref={hostRef} aria-hidden="true" />;
}
