import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight,
  MeshStandardMaterial, Group, Box3, Vector3, Sphere, Spherical, MathUtils,
  SRGBColorSpace, ACESFilmicToneMapping, PMREMGenerator, LoadingManager, DoubleSide, TextureLoader, Loader, BufferAttribute
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createModelRecolorer } from './recolor.js';

function disposeObject(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set(), skeletons = new Set();
  for (const root of (Array.isArray(object) ? object : [object])) root.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.skeleton) skeletons.add(child.skeleton);
    for (const material of (Array.isArray(child.material) ? child.material : [child.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value && value.isTexture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  skeletons.forEach(value => value.dispose());
  textures.forEach(value => {
    if (value.source && value.source.data) images.add(value.source.data);
    value.dispose();
  });
  materials.forEach(value => value.dispose());
  images.forEach(value => { if (typeof value.close === 'function') value.close(); });
}

function validateGLB(bytes, maxVertices) {
  if (bytes.byteLength < 20) throw new Error('Файл GLB повреждён.');
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Нужен корректный файл GLB 2.0.');
  const length = view.getUint32(12, true);
  if (length > 4194304 || length + 20 > bytes.byteLength) throw new Error('Структура GLB повреждена.');
  let json;
  try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))); }
  catch (error) { throw new Error('Не удалось прочитать структуру GLB.'); }
  if (!json.asset || json.asset.version !== '2.0') throw new Error('Модель должна соответствовать glTF 2.0.');
  const inspect = node => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uri' && (typeof value !== 'string' || !/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp|ktx2));base64,[A-Za-z0-9+/=\r\n]+$/.test(value))) throw new Error('Экспортируйте GLB со встроенными текстурами и геометрией.');
      if (value && typeof value === 'object') inspect(value);
    }
  };
  inspect(json);
  let vertices = 0;
  for (const mesh of (json.meshes || [])) for (const primitive of (mesh.primitives || [])) {
    vertices += (json.accessors || [])[primitive.attributes?.POSITION]?.count || 0;
  }
  if (!vertices || vertices > maxVertices) throw new Error('Модель не содержит геометрии или превышает лимит сложности.');
  for (const accessor of (json.accessors || [])) if (!Number.isSafeInteger(accessor.count) || accessor.count < 0 || accessor.count > maxVertices * 3) throw new Error('Модель превышает лимит сложности.');
  return json;
}

const FBX_BINARY = 'Kaydara FBX Binary  \0';
const TEXTURE_SLOTS = ['map', 'emissiveMap', 'normalMap', 'bumpMap', 'displacementMap', 'alphaMap', 'aoMap', 'lightMap', 'specularMap', 'envMap'];

function checkFBX(bytes) {
  const start = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 65536)));
  if (start.startsWith(FBX_BINARY)) {
    if (bytes.byteLength < 27) throw new Error('Файл FBX повреждён.');
    const version = new DataView(bytes).getUint32(23, true);
    if (version < 7000) throw new Error('Версия FBX ' + version + ' не поддерживается. Экспортируйте FBX 2011 или новее (7.x).');
    return;
  }
  if (start.includes('\0') || /<\?|<\/?(?:html|script|svg)\b/i.test(start)) throw new Error('Файл FBX содержит неподдерживаемые данные.');
  const version = /FBXVersion: (\d+)/.exec(start);
  if (version && Number(version[1]) < 7000) throw new Error('Версия FBX ' + version[1] + ' не поддерживается. Экспортируйте FBX 2011 или новее (7.x).');
}

/** FBX textures may only come from the file itself; external paths never reach the network. */
function fbxLoadingManager() {
  const manager = new LoadingManager();
  const created = new Set();
  let active = 0, wake = null;
  const itemStart = manager.itemStart, itemEnd = manager.itemEnd;
  manager.itemStart = url => { active++; itemStart(url); };
  manager.itemEnd = url => { itemEnd(url); if (--active <= 0 && wake) wake(); };
  manager.setURLModifier(url => (url.startsWith('data:') || created.has(url)) ? url : 'data:,');
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  return {
    manager,
    parse(loader, bytes) {
      // FBXLoader turns embedded images into blob URLs synchronously during parse() and never revokes them.
      const createObjectURL = URL.createObjectURL;
      URL.createObjectURL = function (value) { const url = createObjectURL.call(URL, value); created.add(url); return url; };
      try { return loader.parse(bytes, ''); } finally { URL.createObjectURL = createObjectURL; }
    },
    idle(ms) {
      if (active <= 0) return Promise.resolve();
      return new Promise(resolve => { const timer = setTimeout(() => { wake = null; resolve(); }, ms); wake = () => { wake = null; clearTimeout(timer); resolve(); }; });
    },
    release() { created.forEach(url => URL.revokeObjectURL(url)); created.clear(); }
  };
}

function loadedTexture(texture) {
  const image = texture && texture.image;
  if (!image) return false;
  return texture.isDataTexture ? !!image.data : image.width > 0 && image.height > 0;
}

/**
 * FBXLoader turns 1- and 2-vertex polygons (loose edges and points) into triangles with NaN corners,
 * which break the bounding box of the whole model. Drop those triangles from every attribute and group.
 */
function dropDegenerateTriangles(geometry) {
  const position = geometry.getAttribute('position');
  if (!position || geometry.index || !position.array.some(value => !Number.isFinite(value))) return;
  const triangles = Math.floor(position.count / 3), stride = position.itemSize * 3, keep = new Uint8Array(triangles), before = new Uint32Array(triangles + 1);
  for (let t = 0; t < triangles; t++) {
    keep[t] = 1;
    for (let k = t * stride; k < (t + 1) * stride; k++) if (!Number.isFinite(position.array[k])) { keep[t] = 0; break; }
    before[t + 1] = before[t] + keep[t];
  }
  const compact = attribute => {
    const size = attribute.itemSize, target = new attribute.array.constructor(before[triangles] * 3 * size);
    for (let t = 0, offset = 0; t < triangles; t++) if (keep[t]) { target.set(attribute.array.subarray(t * 3 * size, (t + 1) * 3 * size), offset); offset += 3 * size; }
    const result = new BufferAttribute(target, size, attribute.normalized); result.name = attribute.name; return result;
  };
  for (const name of Object.keys(geometry.attributes)) geometry.setAttribute(name, compact(geometry.attributes[name]));
  for (const name of Object.keys(geometry.morphAttributes)) geometry.morphAttributes[name] = geometry.morphAttributes[name].map(compact);
  // Material groups address vertices of the non-indexed geometry; map them onto the kept triangles.
  geometry.groups = geometry.groups.map(group => {
    const first = Math.min(Math.floor(group.start / 3), triangles), last = Math.min(Math.floor((group.start + group.count) / 3), triangles);
    return {start: before[first] * 3, count: (before[last] - before[first]) * 3, materialIndex: group.materialIndex};
  }).filter(group => group.count > 0);
  geometry.boundingBox = null; geometry.boundingSphere = null;
}

/** Brings FBX scenes in line with the GLB pipeline: studio lighting, PBR materials and no placeholder textures. */
function prepareFBX(model, fallbackColor) {
  model.updateMatrixWorld(true);
  const extras = [];
  model.traverse(child => { if (child !== model && (child.isLight || child.isCamera || child.isLine || child.isPoints)) extras.push(child); });
  for (const child of extras) {
    const parent = child.parent;
    if (!parent) continue;
    for (const nested of [...child.children]) parent.attach(nested);
    parent.remove(child);
    if (child.geometry) child.geometry.dispose();
    for (const material of (Array.isArray(child.material) ? child.material : [child.material])) if (material) material.dispose();
    if (typeof child.dispose === 'function') child.dispose();
  }
  const converted = new Map(), geometries = new Set(), dropped = new Set();
  const convert = material => {
    if (!material) return material;
    if (converted.has(material)) return converted.get(material);
    // A texture that failed to load (external path, PSD, TIFF) would sample as black.
    for (const slot of TEXTURE_SLOTS) if (material[slot] && !loadedTexture(material[slot])) { dropped.add(material[slot]); material[slot] = null; }
    let result = material;
    if (material.isMeshPhongMaterial || material.isMeshLambertMaterial) {
      // Blender writes ShininessExponent = ((1 - roughness) * 10)^2 and reads it back the same way.
      let roughness = material.isMeshLambertMaterial ? 0.9 : MathUtils.clamp(1 - Math.sqrt(Math.max(Number(material.shininess) || 0, 0)) / 10, 0.25, 1);
      if (material.specular && Math.max(material.specular.r, material.specular.g, material.specular.b) < 0.02) roughness = Math.max(roughness, 0.9);
      const parameters = {name: material.name, color: material.color, roughness, metalness: 0, side: DoubleSide};
      for (const key of ['map', 'emissive', 'emissiveMap', 'emissiveIntensity', 'normalMap', 'normalMapType', 'normalScale', 'bumpMap', 'bumpScale', 'displacementMap', 'displacementScale', 'displacementBias', 'alphaMap', 'aoMap', 'aoMapIntensity', 'lightMap', 'lightMapIntensity', 'opacity', 'transparent', 'alphaTest', 'vertexColors', 'flatShading']) {
        if (material[key] !== undefined && material[key] !== null) parameters[key] = material[key];
      }
      result = new MeshStandardMaterial(parameters);
      if (material.name === Loader.DEFAULT_MATERIAL_NAME) result.color.set(fallbackColor || '#9aa7b7');
      material.dispose();
    }
    converted.set(material, result);
    return result;
  };
  model.traverse(child => {
    if (!child.isMesh) return;
    child.material = Array.isArray(child.material) ? child.material.map(convert) : convert(child.material);
    geometries.add(child.geometry);
  });
  for (const geometry of geometries) {
    dropDegenerateTriangles(geometry);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    // Some exporters write an empty (all black) color layer; it would hide every material.
    const colors = geometry.getAttribute('color');
    if (colors && colors.array && colors.itemSize >= 3) {
      let visible = false;
      for (let i = 0; i < colors.array.length && !visible; i += colors.itemSize) visible = colors.array[i] > 0.004 || colors.array[i + 1] > 0.004 || colors.array[i + 2] > 0.004;
      if (!visible) { colors.array.fill(1); colors.needsUpdate = true; }
    }
  }
  dropped.forEach(texture => texture.dispose());
}

export function mount(host, options, config, callbacks) {
  let renderer, controls, model, resources, environment, scene, camera, pivot;
  let recolorer;
  let draco, ktx2, resizeObserver, frameId = 0, lastFrame = 0, dirtyFrames = 0;
  let disposed = false, ready = false, homeDistance = 4, errorState = false, shaderFailure = false, phase = 'download';
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const constrained = !!(apple || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4));
  let rotating = !!options.auto && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const abort = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true; abort.abort();
    if (!disposed && !ready) reportError(new Error('Загрузка заняла больше 3 минут. Проверьте соединение и повторите попытку.'), 'TIMEOUT');
  }, 180000);

  function reportError(error, code) {
    if (disposed || errorState) return;
    errorState = true; ready = false;
    clearTimeout(timeout); abort.abort();
    cancelAnimationFrame(frameId); frameId = 0;
    const codes = {download: 'DOWNLOAD', graphics: 'WEBGL2', materials: 'DECODE', render: 'RENDER'};
    callbacks.error(error instanceof Error ? error.message : String(error), {code: code || codes[phase], phase, apple, constrained});
  }

  function stage(value) { phase = value; if (callbacks.stage) callbacks.stage(value); }

  function schedule() {
    if (!disposed && !errorState && !document.hidden && !frameId) frameId = requestAnimationFrame(frame);
  }

  function invalidate() { dirtyFrames = 25; schedule(); }

  function frame(now) {
    frameId = 0;
    if (disposed || errorState || document.hidden) return;
    const delta = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.1); lastFrame = now;
    if (controls) { controls.autoRotate = ready && rotating; controls.update(delta); }
    try { renderer.render(scene, camera); if (shaderFailure) throw new Error('Shader failure'); }
    catch (error) { reportError(new Error('Не удалось отобразить модель. Попробуйте облегчённую версию или другое устройство.'), 'RENDER'); return; }
    if (dirtyFrames > 0) dirtyFrames--;
    if ((ready && rotating) || dirtyFrames > 0) schedule();
  }

  function setRotation(value) {
    rotating = value;
    if (controls && !value) {
      controls.autoRotate = false;
      // Finish the small damping remainder once, so "Stop" leaves a stable view.
      controls.enableDamping = false; controls.update(0); controls.enableDamping = true;
    }
    callbacks.rotation(rotating); invalidate();
  }

  function resize() {
    if (!renderer || disposed) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    // Refit after a viewport/orientation change, without changing the chosen angle.
    if (ready) fit(true);
    invalidate();
  }

  function fit(preserveAngle = false) {
    const sphere = new Box3().setFromObject(pivot).getBoundingSphere(new Sphere());
    const halfVertical = MathUtils.degToRad(camera.fov / 2);
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
    // Keep the shopper's zoom level when only the viewport changes.
    const zoomLevel = preserveAngle ? camera.position.distanceTo(controls.target) / homeDistance : 1;
    homeDistance = sphere.radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.12;
    const direction = preserveAngle ? camera.position.clone().sub(controls.target).normalize() : new Vector3(3.8, 2, 5).normalize();
    controls.target.set(0, 0, 0); controls.minDistance = Math.max(sphere.radius * 0.4, 0.01);
    controls.maxDistance = homeDistance * 4;
    camera.position.copy(direction.multiplyScalar(MathUtils.clamp(homeDistance * zoomLevel, controls.minDistance, controls.maxDistance)));
    camera.near = Math.max(sphere.radius / 1000, 0.001); camera.far = homeDistance * 15;
    camera.updateProjectionMatrix(); controls.update(0);
    if (!preserveAngle) controls.saveState();
    else { controls.position0.copy(camera.position); controls.target0.copy(controls.target); }
  }

  function zoom(factor) {
    if (!ready) return;
    const offset = camera.position.clone().sub(controls.target);
    const distance = MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(offset.setLength(distance).add(controls.target)); controls.update(0); invalidate();
  }

  function keyboard(e) {
    if (!ready || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(0.8); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(1.25); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', ' '].includes(e.key)) return;
    e.preventDefault();
    if (e.key === ' ') { setRotation(!rotating); return; }
    if (e.key === 'Home') { reset(); return; }
    if (rotating) setRotation(false);
    const spherical = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if (e.key === 'ArrowLeft') spherical.theta -= 0.13;
    if (e.key === 'ArrowRight') spherical.theta += 0.13;
    if (e.key === 'ArrowUp') spherical.phi -= 0.1;
    if (e.key === 'ArrowDown') spherical.phi += 0.1;
    spherical.phi = MathUtils.clamp(spherical.phi, 0.05, Math.PI - 0.05);
    camera.position.setFromSpherical(spherical).add(controls.target); controls.update(0); invalidate();
  }

  function interaction() { if (ready && rotating) setRotation(false); invalidate(); }
  function visibility() { lastFrame = performance.now(); if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; } else invalidate(); }
  function contextLost(e) { e.preventDefault(); reportError(new Error('Графический контекст прерван. Закройте другие вкладки и нажмите «Попробовать снова». Для больших моделей поможет облегчённая версия.'), 'CONTEXT_LOST'); }
  function reset() {
    if (!ready) return;
    // Remove residual momentum before resetting the initial camera.
    controls.enableDamping = false; controls.update(0); fit(false); controls.enableDamping = true; invalidate();
  }

  function setModelColor(color) {
    if (!ready || disposed || !recolorer || !recolorer.set(color)) return false;
    invalidate();
    return true;
  }

  function resetModelColor() {
    if (!ready || disposed || !recolorer) return;
    recolorer.restore();
    invalidate();
  }

  function dispose() {
    if (disposed) return;
    disposed = true; ready = false; clearTimeout(timeout); abort.abort(); cancelAnimationFrame(frameId);
    if (resizeObserver) resizeObserver.disconnect();
    window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility);
    if (controls) controls.dispose();
    if (draco) draco.dispose(); if (ktx2) ktx2.dispose();
    if (recolorer) recolorer.dispose();
    if (resources || model) disposeObject(resources || model);
    if (environment) environment.dispose();
    if (renderer) {
      renderer.domElement.removeEventListener('keydown', keyboard);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
  }

  async function init() {
    try {
      // The bootstrap starts this request in parallel with the viewer module import.
      const bytes = await (options.downloadPromise || window.W3DPVModelCache.load(options.model, {signal: abort.signal, progress: callbacks.progress}));
      if (disposed || errorState) return;
      callbacks.progress(100); stage('graphics');
      // Yield so Safari can paint the loading state before synchronous GPU work.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (disposed || errorState) return;
      const canvas = document.createElement('canvas');
      const attributes = {alpha: true, antialias: !constrained, powerPreference: constrained ? 'low-power' : 'default'};
      const context = canvas.getContext('webgl2', attributes) || canvas.getContext('webgl2', {alpha: true, antialias: false});
      if (!context) throw new Error('На этом устройстве недоступен WebGL 2. Попробуйте обновить браузер или открыть товар на другом устройстве.');
      renderer = new WebGLRenderer({canvas, context, alpha: true, antialias: !constrained});
      renderer.debug.onShaderError = () => { shaderFailure = true; };
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, constrained ? 1 : 2));
      renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1; renderer.setClearColor(0xffffff, 0);
      canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', '3D-модель: ' + (options.title || 'товар') + '. Стрелки — вращение, плюс и минус — масштаб, пробел — автовращение, Home — сброс.');
      canvas.addEventListener('keydown', keyboard); canvas.addEventListener('webglcontextlost', contextLost);
      host.appendChild(canvas);
      scene = new Scene(); camera = new PerspectiveCamera(38, 1, 0.01, 100);
      camera.position.set(3, 1.5, 4);
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true; controls.dampingFactor = 0.09; controls.enablePan = false;
      controls.minPolarAngle = 0.05; controls.maxPolarAngle = Math.PI - 0.05;
      controls.autoRotateSpeed = MathUtils.clamp(Number(options.speed) || 8, 1, 30) / 6;
      controls.rotateSpeed = 0.75; controls.zoomSpeed = 0.8;
      controls.addEventListener('change', invalidate); controls.addEventListener('start', interaction);
      // Studio illumination also gives metallic GLB materials an environment to reflect.
      const room = new RoomEnvironment();
      const generator = new PMREMGenerator(renderer);
      try { environment = generator.fromScene(room, 0.04, 0.1, 100, {size: constrained ? 64 : 256}); scene.environment = environment.texture; }
      finally { room.dispose(); generator.dispose(); }
      scene.add(new HemisphereLight(0xffffff, 0xc7d3e4, 1.8));
      const keyLight = new DirectionalLight(0xffffff, 2.3); keyLight.position.set(4, 6, 5); scene.add(keyLight);
      const fillLight = new DirectionalLight(0xe0eaff, 1.4); fillLight.position.set(-5, 2, -4); scene.add(fillLight);
      pivot = new Group(); scene.add(pivot);
      if (window.ResizeObserver) { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); }
      window.addEventListener('resize', resize); document.addEventListener('visibilitychange', visibility);
      resize(); callbacks.rotation(rotating);
      stage('materials');
      if (options.model.format === 'glb') {
        validateGLB(bytes, config.maxVertices);
        const manager = new LoadingManager();
        manager.setURLModifier(url => {
          if (url.startsWith('blob:') || url.startsWith('data:')) return url;
          throw new Error('Внешние файлы модели не поддерживаются.');
        });
        const loader = new GLTFLoader(manager);
        if (apple) loader.register(parser => {
          // Local to this loader: do not change createImageBitmap for other plugins.
          parser.textureLoader = new TextureLoader(manager);
          return {name: 'W3DPV_APPLE_IMAGE_COMPATIBILITY'};
        });
        draco = new DRACOLoader(); draco.setDecoderPath(config.decoderUrl + 'draco/'); draco.setWorkerLimit(constrained ? 1 : 2);
        ktx2 = new KTX2Loader(); ktx2.setTranscoderPath(config.decoderUrl + 'basis/'); ktx2.setWorkerLimit(constrained ? 1 : 2); ktx2.detectSupport(renderer);
        loader.setDRACOLoader(draco); loader.setKTX2Loader(ktx2); loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.parseAsync(bytes, '');
        if (disposed || errorState) { disposeObject(gltf.scenes); return; }
        resources = gltf.scenes;
        model = gltf.scene;
        // Embedded animation clips are intentionally not started: this viewer presents the product shape.
      } else if (options.model.format === 'fbx') {
        checkFBX(bytes);
        const textures = fbxLoadingManager();
        try {
          try { model = textures.parse(new FBXLoader(textures.manager), bytes); }
          catch (error) {
            if (/version not supported/i.test(error.message || '')) throw new Error('Версия FBX не поддерживается. Экспортируйте FBX 2011 или новее (7.x).');
            throw new Error('Не удалось прочитать FBX. Экспортируйте файл заново (FBX 7.x, сетки, встроенные текстуры).');
          }
          // Embedded images decode asynchronously; external texture paths fail at once.
          await textures.idle(30000);
        } finally { textures.release(); }
        if (disposed || errorState) { if (model) disposeObject(model); model = null; return; }
        prepareFBX(model, options.color);
        // Animation clips and skeletons stay in the bind pose, as with GLB.
      } else if (options.model.format === 'obj') {
        const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '');
        if (text.includes('\0') || /<\?|<\/?(?:html|script|svg)\b/i.test(text)) throw new Error('Файл OBJ содержит неподдерживаемые данные.');
        const vertexCount = (text.match(/^v\s/gm) || []).length;
        if (!vertexCount || vertexCount > config.maxVertices) throw new Error('OBJ не содержит геометрии или превышает лимит сложности.');
        model = new OBJLoader().parse(text);
        const originalMaterials = new Set();
        model.traverse(child => {
          if (!child.isMesh) return;
          for (const material of (Array.isArray(child.material) ? child.material : [child.material])) if (material) originalMaterials.add(material);
          const vertexColors = !!child.geometry.getAttribute('color');
          child.material = new MeshStandardMaterial({color: vertexColors ? '#ffffff' : (options.color || '#9aa7b7'), vertexColors, roughness: 0.5, metalness: 0.12, side: DoubleSide});
        });
        originalMaterials.forEach(value => value.dispose());
      } else throw new Error('Поддерживаются только GLB, FBX и OBJ.');
      if (disposed || errorState) { disposeObject(resources || model); model = null; resources = null; return; }
      if (timedOut) throw new Error('Загрузка заняла больше 3 минут. Повторите попытку.');
      let vertexCount = 0, triangleCount = 0, meshCount = 0;
      const textures = new Set();
      model.traverse(child => {
        if (child.isMesh) {
          const copies = child.isInstancedMesh ? child.count : 1, positions = child.geometry.getAttribute('position')?.count || 0;
          meshCount++; vertexCount += positions * copies;
          triangleCount += Math.floor((child.geometry.index ? child.geometry.index.count : positions) / 3) * copies;
        }
        for (const material of (Array.isArray(child.material) ? child.material : [child.material])) {
          if (!material) continue;
          for (const texture of Object.values(material)) if (texture && texture.isTexture) textures.add(texture);
        }
      });
      // The upload check counts the same values, so an accepted file is not rejected here.
      if (callbacks.details) callbacks.details({meshes: meshCount, vertices: vertexCount, triangles: triangleCount});
      const count = value => new Intl.NumberFormat('ru-RU').format(value);
      const maxMeshes = Number(config.maxMeshes) || 1000, maxVertices = (Number(config.maxVertices) || 1000000) * 3, maxTriangles = Number(config.fbxMaxTriangles) || 1500000;
      if (!meshCount) throw new Error('В модели нет полигональных сеток: только кривые, точки или пустые объекты. Экспортируйте объекты как сетки (Mesh).');
      if (meshCount > maxMeshes) throw new Error('Модель состоит из ' + count(meshCount) + ' отдельных сеток, лимит — ' + count(maxMeshes) + '. Объедините детали в 3D-редакторе.');
      if (options.model.format === 'fbx' ? triangleCount > maxTriangles : vertexCount > maxVertices) {
        throw new Error('Модель слишком сложная: ' + count(triangleCount) + ' треугольников, ' + count(vertexCount) + ' вершин после загрузки. Лимит: ' + (options.model.format === 'fbx' ? count(maxTriangles) + ' треугольников' : count(maxVertices) + ' вершин') + '. Уменьшите число полигонов или загрузите облегчённую модель.');
      }
      const resizedImages = new Map();
      const textureLimit = Math.min(constrained ? 2048 : 8192, renderer.capabilities.maxTextureSize);
      for (const texture of textures) {
        const image = texture.image;
        const longest = image ? Math.max(image.width || 0, image.height || 0) : 0;
        if (longest > textureLimit && !(texture.isDataTexture && constrained && longest <= renderer.capabilities.maxTextureSize)) {
          if (texture.isCompressedTexture || texture.isDataTexture || !constrained) throw new Error('Текстуры превышают возможности устройства. Для телефонов загрузите облегчённую модель с текстурами до 2048 пикселей.');
          if (!resizedImages.has(image)) {
            const scale = textureLimit / Math.max(image.width, image.height);
            const small = document.createElement('canvas');
            small.width = Math.max(1, Math.round(image.width * scale)); small.height = Math.max(1, Math.round(image.height * scale));
            const drawing = small.getContext('2d');
            if (!drawing) throw new Error('Не удалось подготовить текстуры. Попробуйте облегчённую модель.');
            drawing.drawImage(image, 0, 0, small.width, small.height); resizedImages.set(image, small);
          }
          texture.image = resizedImages.get(image); texture.needsUpdate = true;
        }
        texture.anisotropy = Math.min(constrained ? 1 : 4, renderer.capabilities.getMaxAnisotropy());
      }
      for (const image of resizedImages.keys()) if (typeof image.close === 'function') image.close();
      model.updateMatrixWorld(true);
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const largest = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(largest) || largest <= 1e-12) throw new Error('Модель имеет некорректные размеры.');
      const scale = 2 / largest, center = box.getCenter(new Vector3());
      const root = new Group(); root.add(model); root.scale.setScalar(scale); root.position.copy(center).multiplyScalar(-scale);
      pivot.add(root); pivot.rotation.y = MathUtils.degToRad(Number(options.yaw) || 0);
      recolorer = createModelRecolorer(model);
      stage('render');
      ready = true; fit();
      renderer.render(scene, camera);
      if (context.isContextLost() || errorState || shaderFailure) { ready = false; throw new Error('Не удалось подготовить графику. Попробуйте облегчённую модель.'); }
      clearTimeout(timeout);
      if (callbacks.details) callbacks.details({apple, constrained, pixelRatio: renderer.getPixelRatio(), textureLimit, meshes: meshCount, vertices: vertexCount, textures: textures.size, resizedTextures: resizedImages.size});
      callbacks.ready(); lastFrame = performance.now(); invalidate();
    } catch (error) {
      clearTimeout(timeout);
      if (disposed) return;
      if (timedOut) reportError(new Error('Загрузка заняла больше 3 минут. Проверьте соединение и повторите попытку.'), 'TIMEOUT');
      else if (error.name !== 'AbortError') {
        if (phase === 'materials' && window.W3DPVModelCache) window.W3DPVModelCache.discard(options.model).catch(() => {});
        const message = error instanceof TypeError && phase === 'download' ? new Error('Не удалось скачать модель. Проверьте соединение; администратору следует проверить HTTPS и доступность файла.') : error;
        reportError(message);
      }
    }
  }
  init();
  return {dispose, zoom, reset, setModelColor, resetModelColor, toggleRotation: () => { if (ready) setRotation(!rotating); }};
}
