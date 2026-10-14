(function () {
  'use strict';
  if (window.W3DPVModelCache || !window.W3DPVConfig) return;
  const config = window.W3DPVConfig;
  const maxBytes = Number(config.maxBytes) || 83886080;
  const ttl = (Number(config.cacheTTL) || 2592000) * 1000;
  const mobile = matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const diskBudget = (mobile ? 80 : 160) * 1048576;
  const memoryBudget = (mobile ? 8 : 16) * 1048576;
  const cacheName = 'w3dpv-models-v1-' + config.cacheNamespace;
  const pending = new Map();
  let memory, cleanup, databasePromise, writes = Promise.resolve(), last = {source: 'none'}, storageError = '', cacheReadMs = 0;
  const aborted = () => new DOMException('Загрузка отменена.', 'AbortError');

  function bounded(promise, fallback, ms = 4000) {
    let timer;
    return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]).finally(() => clearTimeout(timer));
  }

  function absolute(url) {
    const value = new URL(url, location.href);
    if (!['http:', 'https:'].includes(value.protocol)) throw new Error('Адрес модели имеет неподдерживаемый формат.');
    // A page cached before an HTTPS migration may still contain local HTTP media URLs.
    if (location.protocol === 'https:' && value.protocol === 'http:' && value.hostname === location.hostname && (!value.port || value.port === '80')) { value.protocol = 'https:'; value.port = ''; }
    return value.href;
  }

  function keyFor(model) {
    const url = new URL(absolute(model.sourceUrl || model.url));
    url.searchParams.set('w3dpv-cache-version', model.cacheVersion || String(model.bytes || 0));
    url.searchParams.set('w3dpv-generation', config.cacheGeneration || 'initial');
    return url.href;
  }

  function transaction(database, stores, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
      try { operation(tx, result => { value = result; }); }
      catch (error) { try { tx.abort(); } catch (ignored) {} reject(error); }
    });
  }

  async function storage() {
    if (!window.isSecureContext || !window.indexedDB) return null;
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(cacheName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('models'); database.createObjectStore('meta', {keyPath: 'key'});
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDBBlocked'));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); databasePromise = null; };
        resolve(database);
      };
    }).catch(error => { storageError = error.name || 'StorageUnavailable'; return null; });
    return bounded(databasePromise, null, 3500);
  }

  async function metadata(database) {
    return transaction(database, ['meta'], 'readonly', (tx, result) => {
      const request = tx.objectStore('meta').getAll(); request.onsuccess = () => result(request.result);
    });
  }

  function remove(database, key) {
    return transaction(database, ['models','meta'], 'readwrite', tx => {
      tx.objectStore('models').delete(key); tx.objectStore('meta').delete(key);
    });
  }

  async function entries(database) {
    const values = await metadata(database);
    const result = [];
    for (const value of values) {
      const {key, created, bytes} = value;
      if (!created || Date.now() - created > ttl || !bytes || bytes > maxBytes) { await remove(database, key); continue; }
      result.push({key, created, bytes});
    }
    return result.sort((a, b) => a.created - b.created);
  }

  async function clean(cache, reserve = 0, keep) {
    const values = await entries(cache);
    let bytes = values.reduce((sum, entry) => sum + entry.bytes, 0), count = values.length;
    for (const entry of values) {
      if (bytes + reserve <= diskBudget && count < (reserve ? 8 : 9)) break;
      if (entry.key === keep) continue;
      await remove(cache, entry.key); bytes -= entry.bytes; count--;
    }
  }

  function basicValidate(bytes, model) {
    if (!bytes.byteLength) throw new Error('Получен пустой файл модели.');
    if (bytes.byteLength > maxBytes) throw new Error('Модель превышает лимит ' + (maxBytes / 1048576) + ' МиБ.');
    if (model.bytes && bytes.byteLength !== Number(model.bytes)) throw new Error('Файл загружен не полностью или изменён на сервере. Обновите страницу и повторите попытку.');
    if (model.format === 'glb') {
      const header = bytes.byteLength >= 20 ? new DataView(bytes, 0, 20) : null;
      if (!header || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('Вместо корректного GLB получен другой файл. Проверьте доступность модели на сайте.');
    } else if (model.format === 'obj') {
      const start = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024)));
      if (/<!doctype|<html|<\?php|<script/i.test(start)) throw new Error('Вместо OBJ сервер вернул страницу. Проверьте доступность модели.');
    } else if (model.format === 'fbx') {
      // Binary FBX starts with a fixed signature; ASCII FBX declares its header near the start.
      const start = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 65536)));
      if (!start.startsWith('Kaydara FBX Binary  \0') && (/<!doctype|<html|<\?php|<script/i.test(start) || !/FBXHeaderExtension|FBXVersion/.test(start))) throw new Error('Вместо корректного FBX получен другой файл. Проверьте доступность модели на сайте.');
    } else throw new Error('Поддерживаются только GLB, FBX и OBJ.');
  }

  async function read(cache, key, model) {
    if (!cache || !model.cacheVersion) return null;
    const record = await transaction(cache, ['models','meta'], 'readonly', (tx, result) => {
      let body, meta;
      const blob = tx.objectStore('models').get(key); const info = tx.objectStore('meta').get(key);
      blob.onsuccess = () => { body = blob.result; result({body, meta}); };
      info.onsuccess = () => { meta = info.result; result({body, meta}); };
    });
    if (!record.body || !record.meta) return null;
    const created = record.meta.created;
    if (!created || Date.now() - created > ttl) { await remove(cache, key); return null; }
    try {
      const bytes = record.body instanceof Blob ? await record.body.arrayBuffer() : record.body;
      if (!(bytes instanceof ArrayBuffer)) throw new Error('Cached model data is invalid.');
      basicValidate(bytes, model); return bytes;
    } catch (error) { storageError = 'CacheRead: ' + (error.message || error.name); await remove(cache, key); return null; }
  }

  async function save(cache, key, model, bytes) {
    if (!cache || !model.cacheVersion || bytes.byteLength > diskBudget) return;
    try {
      await remove(cache, key);
      await clean(cache, bytes.byteLength, key);
      await transaction(cache, ['models','meta'], 'readwrite', tx => {
        // ArrayBuffer avoids Blob backing-file limitations in WebKit/private storage.
        tx.objectStore('models').put(bytes, key);
        tx.objectStore('meta').put({key, created: Date.now(), bytes: bytes.byteLength});
      });
    } catch (error) { storageError = (error.name || 'StorageUnavailable') + ': ' + (error.message || ''); }
  }

  function write(operation) {
    const result = writes.then(operation, operation);
    writes = result.catch(() => {});
    return result;
  }

  async function download(url, model, signal, notify, refresh = false) {
    const response = await fetch(absolute(url), {signal, credentials: 'same-origin', cache: refresh ? 'reload' : 'default'});
    if (!response.ok) throw new Error('Файл модели недоступен (HTTP ' + response.status + ').');
    const headerLength = Number(response.headers.get('content-length')) || 0;
    if (headerLength > maxBytes) throw new Error('Модель превышает лимит ' + (maxBytes / 1048576) + ' МиБ.');
    const total = Number(model.bytes) || headerLength;
    if (total > maxBytes) throw new Error('Модель превышает лимит ' + (maxBytes / 1048576) + ' МиБ.');
    if (!response.body || !response.body.getReader) {
      const bytes = await response.arrayBuffer(); basicValidate(bytes, model); return bytes;
    }
    const reader = response.body.getReader();
    // Known file size: one allocation instead of chunks + a second 33–80 MiB copy.
    let output = total ? new Uint8Array(total) : null, chunks = [], received = 0, previous = -1;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (signal.aborted) throw aborted();
        if (received + value.byteLength > maxBytes || (output && received + value.byteLength > output.byteLength)) throw new Error('Размер полученной модели не соответствует ожидаемому. Обновите страницу.');
        if (output) output.set(value, received); else chunks.push(value);
        received += value.byteLength;
        const percent = total ? Math.min(99, Math.round(received / total * 100)) : null;
        if (percent !== previous) { notify('progress', percent); previous = percent; }
      }
    } catch (error) { try { await reader.cancel(); } catch (ignored) {} throw error; }
    finally { reader.releaseLock(); }
    if (!output) { output = new Uint8Array(received); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } chunks = []; }
    const bytes = received === output.byteLength ? output.buffer : output.buffer.slice(0, received);
    basicValidate(bytes, model); return bytes;
  }

  function remember(key, bytes) {
    if (bytes.byteLength <= memoryBudget) memory = {key, bytes, created: Date.now()};
    else memory = null;
  }

  async function obtain(record, key, model, refresh) {
    const signal = record.abort.signal;
    const notify = (type, value) => { record[type] = value; record.clients.forEach(client => { if (client[type]) client[type](value); }); };
    if (!refresh && memory && memory.key === key && Date.now() - memory.created < ttl) {
      last = {source: 'memory', bytes: memory.bytes.byteLength}; notify('stage', 'memory'); return memory.bytes;
    }
    const cache = await storage();
    if (cache && !cleanup) cleanup = bounded(write(() => clean(cache)).catch(() => {}), null);
    if (signal.aborted) throw aborted();
    if (!refresh) {
      // Metadata lives in a separate store, so cleanup does not load other binaries.
      const start = performance.now();
      const cached = await bounded(read(cache, key, model).catch(error => { storageError = error.name || 'CacheRead'; return null; }), null, 10000);
      cacheReadMs = Math.round(performance.now() - start);
      if (signal.aborted) throw aborted();
      if (cached) { last = {source: 'browser', bytes: cached.byteLength}; notify('stage', 'browser'); remember(key, cached); return cached; }
    }
    notify('stage', 'download');
    let bytes, usedOriginal = !model.sourceUrl || refresh;
    const url = refresh && model.sourceUrl ? model.sourceUrl : model.url;
    try { bytes = await download(url, model, signal, notify, refresh); }
    catch (error) {
      if (signal.aborted || !model.sourceUrl || absolute(url) === absolute(model.sourceUrl)) throw error;
      // A monthly purge can race a cached HTML page. Fall back to the original.
      bytes = await download(model.sourceUrl, model, signal, notify, refresh);
      usedOriginal = true;
    }
    if (signal.aborted) throw aborted();
    last = {source: usedOriginal ? 'network' : 'server', bytes: bytes.byteLength};
    await bounded(write(() => save(cache, key, model, bytes)), null);
    if (signal.aborted) throw aborted();
    remember(key, bytes); return bytes;
  }

  function load(model, options = {}) {
    if (options.signal && options.signal.aborted) return Promise.reject(aborted());
    let key;
    try { key = keyFor(model); } catch (error) { return Promise.reject(error); }
    const pendingKey = key + (options.refresh ? ':refresh' : '');
    let record = pending.get(pendingKey);
    if (!record || record.abort.signal.aborted) {
      record = {abort: new AbortController(), clients: new Set()};
      pending.set(pendingKey, record);
      record.promise = Promise.resolve().then(() => obtain(record, key, model, options.refresh)).finally(() => { if (pending.get(pendingKey) === record) pending.delete(pendingKey); });
    }
    return new Promise((resolve, reject) => {
      let finished = false;
      const client = {progress: options.progress, stage: options.stage};
      record.clients.add(client);
      if (options.stage && record.stage) options.stage(record.stage);
      if (options.progress && record.progress !== undefined) options.progress(record.progress);
      function finish(error, bytes) {
        if (finished) return; finished = true;
        if (options.signal) options.signal.removeEventListener('abort', cancel);
        record.clients.delete(client);
        if (!record.clients.size) record.abort.abort();
        error ? reject(error) : resolve(bytes);
      }
      function cancel() { finish(aborted()); }
      if (options.signal) options.signal.addEventListener('abort', cancel, {once: true});
      record.promise.then(bytes => finish(null, bytes), error => finish(error));
    });
  }

  function warm(model) {
    if (pending.size) return;
    if (navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType))) return;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    load(model, {signal: abort.signal}).catch(() => {}).finally(() => clearTimeout(timer));
  }

  async function discard(model) {
    const key = keyFor(model);
    if (memory && memory.key === key) memory = null;
    const cache = await storage();
    if (cache) await bounded(write(() => remove(cache, key)).catch(() => false), false);
  }

  window.W3DPVModelCache = {load, warm, discard, diagnostics: () => ({...last, storage: 'indexeddb', storageError, cacheReadMs, secure: window.isSecureContext, memoryBudget, diskBudget})};
})();
