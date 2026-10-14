/** Reversible base-color preview. Clones share textures; original materials stay intact. */
export function createModelRecolorer(model) {
  const assignments = [];
  const copies = new Map();
  let disposed = false;
  model.traverse(object => {
    if (object.material) assignments.push({object, original: object.material});
  });

  function painted(original, color) {
    if (!original || !original.color || !original.color.isColor) return original;
    let copy = copies.get(original);
    if (!copy) {
      copy = original.clone();
      const compile = original.onBeforeCompile;
      const cacheKey = original.customProgramCacheKey();
      copy.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer);
        // Keep texture/vertex alpha, while replacing their RGB with the chosen base color.
        // Normal, roughness, metalness, emissive and transparency properties remain intact.
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <map_fragment>', 'vec3 w3dpvMapBase = diffuseColor.rgb;\n#include <map_fragment>\ndiffuseColor.rgb = w3dpvMapBase;')
          .replace('#include <color_fragment>', 'vec3 w3dpvVertexBase = diffuseColor.rgb;\n#include <color_fragment>\ndiffuseColor.rgb = w3dpvVertexBase;');
      };
      copy.customProgramCacheKey = () => cacheKey + ':w3dpv-base-color-v1';
      copy.needsUpdate = true;
      copies.set(original, copy);
    }
    copy.color.set(color);
    return copy;
  }

  function set(color) {
    if (disposed || !/^#[0-9a-f]{6}$/i.test(color || '')) return false;
    for (const entry of assignments) {
      entry.object.material = Array.isArray(entry.original)
        ? entry.original.map(material => painted(material, color))
        : painted(entry.original, color);
    }
    return true;
  }

  function restore() {
    if (disposed) return;
    for (const entry of assignments) entry.object.material = entry.original;
  }

  function dispose() {
    if (disposed) return;
    restore();
    disposed = true;
    // Do not dispose shared textures here: the viewer releases them with the originals.
    for (const copy of copies.values()) copy.dispose();
    copies.clear();
    assignments.length = 0;
  }

  return {set, restore, dispose};
}
