import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ClassicDresser, type DressingResult } from './classicClothing';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type PreviewItem = { assetId: number; name: string; slot: string; assetType?:number };
type PreviewProps = { items: PreviewItem[]; onReady?: () => void; onError?: () => void; autoRotate?: boolean; resetKey?: number; bodyColors:Record<string,string>; onDressing:(result:DressingResult)=>void };

const MODEL_URL = '/ROBI_Classic_R15.gltf';

function disposeModel(root: THREE.Object3D, retainedTextures?: Set<THREE.Texture>) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(material => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !retainedTextures?.has(value)) value.dispose();
      }
      material.dispose();
    });
  });
}

export default function Preview({ items, onReady, onError, autoRotate = false, resetKey = 0, bodyColors, onDressing }: PreviewProps) {
  const dresserRef=useRef<ClassicDresser|null>(null);
  const latest=useRef({items,bodyColors,onDressing});latest.current={items,bodyColors,onDressing};
  useEffect(()=>{void dresserRef.current?.apply(items,bodyColors);},[items,bodyColors]);
  const hostRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => undefined);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [status, setStatus] = useState('Loading R15 avatar...');
  useEffect(() => { if (controlsRef.current) controlsRef.current.autoRotate = autoRotate; }, [autoRotate]);
  useEffect(() => { if (resetKey > 0) resetRef.current(); }, [resetKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let model: THREE.Object3D | undefined;
    let frameId = 0;
    let frameDistance = 1;
    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
    camera.up.set(0, 1, 0);
    let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}
    catch {
      setStatus('WebGL is unavailable. Enable hardware acceleration or retry in another browser.');
      latest.current.onDressing({state:'failed',appliedIds:[],unsupportedIds:[],errors:['WebGL initialization failed.']});
      onError?.();return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa5b5, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xded8ff, 0.65);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.autoRotate = autoRotate;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI - 0.15;
    controls.addEventListener('change', render);

    function render() {
      if (!disposed) renderer.render(scene, camera);
    }

    function fit(reset: boolean) {
      if (!model) return;
      const bounds = new THREE.Box3().setFromObject(model);
      if (bounds.isEmpty()) return;
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.1);
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.12;
      const previousDistance = controls.target.distanceTo(camera.position);
      const zoomRatio = reset || !frameDistance ? 1 : previousDistance / frameDistance;
      const direction = reset ? new THREE.Vector3(0.08, 0.02, -1).normalize() : camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(direction, distance * zoomRatio);
      camera.near = Math.max(radius / 1000, 0.01);
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      frameDistance = distance;
      controls.minDistance = radius * 0.75;
      controls.maxDistance = radius * 5;
      controls.update();
      if (reset) controls.saveState();
      render();
    }

    resetRef.current = () => {
      const damping=controls.enableDamping;
      controls.enableDamping=false;
      controls.update(); // Flush pending orbit deltas before setting the home camera.
      fit(true);
      controls.enableDamping=damping;
    };

    function resize() {
      if (disposed) return;
      const width = Math.max(host!.clientWidth, 1);
      const height = Math.max(host!.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (model) fit(false);
      else render();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      gltf => {
        if (disposed) {
          disposeModel(gltf.scene);
          return;
        }
        model = gltf.scene;
        const environmentNodes: THREE.Object3D[] = [];
        model.traverse(object => {
          if (object.name === 'Baseplate' || object.name === 'SpawnLocation') environmentNodes.push(object);
        });
        environmentNodes.forEach(object => object.parent?.remove(object));
        const retainedTextures = new Set<THREE.Texture>();
        model.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach(material => Object.values(material).forEach(value => {
            if (value instanceof THREE.Texture) retainedTextures.add(value);
          }));
        });
        environmentNodes.forEach(object => disposeModel(object, retainedTextures));
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty() || !Number.isFinite(bounds.getBoundingSphere(new THREE.Sphere()).radius)) {
          setStatus('The R15 model has no renderable geometry.');
          onError?.();
          disposeModel(model);
          model = undefined;
          return;
        }
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.sub(center);
        scene.add(model);
        dresserRef.current=new ClassicDresser(model,result=>latest.current.onDressing(result));
        void dresserRef.current.apply(latest.current.items,latest.current.bodyColors);
        fit(true);
        setStatus('R15 avatar loaded');
        onReady?.();
      },
      undefined,
      () => {
        if (!disposed) {
          setStatus('Could not load the R15 model. Check the GLTF request in the browser.');
          onError?.();
        }
      }
    );

    let lastFrame = 0;
    const animate = (time: number) => {
      if (disposed) return;
      frameId = window.requestAnimationFrame(animate);
      if (time - lastFrame < 1000 / 30) return;
      lastFrame = time;
      controls.update();
      renderer.render(scene, camera);
    };
    frameId = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      dresserRef.current?.dispose();dresserRef.current=null;
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      controlsRef.current = null;
      if (model) {
        scene.remove(model);
        disposeModel(model);
      }
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={hostRef} />

      <small className="viewer-status sr-only" role="status">{status}</small>
      <small className="viewer-items sr-only">
        {items.length === 0
          ? 'Base R15 model'
          : `${items.length} catalog item${items.length === 1 ? '' : 's'} selected; see visible dressing status`}
      </small>
    </div>
  );
}
