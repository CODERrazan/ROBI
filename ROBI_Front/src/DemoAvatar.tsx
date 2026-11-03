import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

function dispose(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(material => {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    });
  });
}

type DemoMode = 'idle' | 'walk' | 'pose';
export default function DemoAvatar({ mode, turntable, resetKey }: { mode: DemoMode; turntable: boolean; resetKey: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const turnRef = useRef(turntable); turnRef.current = turntable;
  useEffect(() => { if (resetKey > 0) controlsRef.current?.reset(); }, [resetKey]);
  useEffect(() => { if (controlsRef.current) controlsRef.current.autoRotate = turntable; }, [turntable]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let model: THREE.Group | undefined;
    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.up.set(0, 1, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xc5b3ff, 1.15);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(3, 6, 5);
    key.castShadow = true;
    scene.add(key);
    const blush = new THREE.PointLight(0xff91bd, 0.7, 20);
    blush.position.set(-4, 2, 3);
    scene.add(blush);

    const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.62 });
    const skin = material('#FFD9C2');
    const hair = material('#FF91BD');
    const top = material('#FF91BD');
    const bottom = material('#FF91BD');
    const shoe = material('#f4f0fa');
    const dark = material('#191923');
    const pink = material('#FF91BD');
    const gold = material('#FFD65C');
    const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };

    model = new THREE.Group();
    scene.add(model);
    model.add(box(1.2, 1.3, 0.65, top, 0, 1.85));
    const head = new THREE.Group();
    head.position.y = 3.05;
    model.add(head);
    head.add(box(1.05, 1, 0.95, skin));
    [-0.23, 0.23].forEach(x => head.add(box(0.13, 0.2, 0.05, dark, x, 0.05, 0.49)));
    head.add(box(0.28, 0.06, 0.05, dark, 0, -0.22, 0.49));
    [-0.36, 0.36].forEach(x => head.add(box(0.2, 0.1, 0.04, pink, x, -0.12, 0.49)));
    head.add(box(1.12, 0.3, 1.02, hair, 0, 0.55));
    head.add(box(1.12, 0.22, 0.1, hair, 0, 0.38, 0.48));
    head.add(box(0.1, 0.5, 0.9, hair, -0.54, 0.2));
    head.add(box(0.1, 0.5, 0.9, hair, 0.54, 0.2));
    head.add(box(1.12, 1.5, 0.25, hair, 0, -0.25, -0.5));

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 2.45, 0);
      pivot.add(box(0.42, 0.9, 0.45, top, 0, -0.45));
      pivot.add(box(0.42, 0.35, 0.45, skin, 0, -1.07));
      model?.add(pivot);
      return pivot;
    };
    const leftArm = arm(-0.82);
    const rightArm = arm(0.82);
    const leg = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.2, 0);
      pivot.add(box(0.54, 1, 0.55, bottom, 0, -0.5));
      pivot.add(box(0.54, 0.2, 0.65, shoe, 0, -1.1, 0.05));
      model?.add(pivot);
      return pivot;
    };
    const leftLeg = leg(-0.29);
    const rightLeg = leg(0.29);

    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.98, 0.8, 16), bottom);
    skirt.position.y = 1.15;
    skirt.castShadow = true;
    model.add(skirt);

    const bow = new THREE.Group();
    bow.position.set(0.42, 0.62, 0.3);
    const bowLeft = box(0.3, 0.2, 0.1, pink, -0.18);
    const bowRight = box(0.3, 0.2, 0.1, pink, 0.18);
    bowLeft.rotation.z = 0.4;
    bowRight.rotation.z = -0.4;
    bow.add(bowLeft, bowRight, box(0.12, 0.12, 0.12, shoe));
    head.add(bow);


    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), new THREE.MeshStandardMaterial({ color: '#C5B3FF', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.3, 48), new THREE.MeshBasicMaterial({ color: '#FF91BD', transparent: true, opacity: 0.7 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.02;
    scene.add(ring);

    const sparkles = Array.from({ length: 7 }, (_, i) => {
      const sparkle = box(0.28, 0.28, 0.28, material(i % 2 ? '#FF91BD' : '#9275FF'));
      sparkle.userData = { angle: i * 0.9, radius: 2.8 + (i % 3) * 0.5, height: 0.8 + (i % 3) * 0.45 };
      scene.add(sparkle);
      return sparkle;
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 15;
    controls.autoRotate = turnRef.current;
    controls.autoRotateSpeed = 1.1;
    controls.addEventListener('change', render);

    function render() {
      if (!disposed) renderer.render(scene, camera);
    }
    function resize() {
      const width = Math.max(host!.clientWidth, 1);
      const height = Math.max(host!.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    controls.target.set(0, 1.9, 0);
    camera.position.set(0, 2.5, camera.aspect < 0.85 ? 11.5 : 8.6);
    controls.update();
    controls.saveState();

    const clock = new THREE.Clock();
    const animate = () => {
      if (disposed) return;
      frame = window.requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      const mode = modeRef.current;
      const gait = mode === 'walk' ? Math.sin(time * 6) * 0.48 : 0;
      model!.rotation.y = 0.5 + Math.sin(time * 0.35) * 0.035;
      model!.position.y = mode === 'walk' ? Math.abs(Math.sin(time * 6)) * 0.09 : Math.sin(time * 1.6) * 0.025;
      head.rotation.z = mode === 'pose' ? Math.sin(time * 3) * 0.06 : Math.sin(time * 0.9) * 0.035;
      leftArm.rotation.x = mode === 'pose' ? -0.75 + Math.sin(time * 5) * 0.25 : gait;
      rightArm.rotation.x = mode === 'pose' ? 0 : -gait;
      leftLeg.rotation.x = gait;
      rightLeg.rotation.x = -gait;
      sparkles.forEach(sparkle => {
        const item = sparkle.userData as { angle: number; radius: number; height: number };
        sparkle.position.set(Math.cos(time * 0.4 + item.angle) * item.radius, item.height + Math.sin(time + item.angle) * 0.15, Math.sin(time * 0.4 + item.angle) * item.radius * 0.4 - 0.5);
        sparkle.rotation.set(time * 0.5 + item.angle, time * 0.6, 0);
      });
      controls.update();
      renderer.render(scene, camera);
    };
    frame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      controlsRef.current = null;
      if (model) { scene.remove(model); dispose(model); }
      scene.remove(floor, ring, ...sparkles);
      dispose(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="demo-avatar-canvas" ref={hostRef} aria-label="ROBI sample demo avatar"/>;
}
