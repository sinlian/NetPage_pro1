/* DuoStage Workers — object storage helpers (R2 in production, memory shim in tests)
   Interface used by routes: putObject(key, bytes, mime), getObject not needed
   (downloads are served straight from the bucket binding in production;
   the dev stand-in keeps render urls pointing at static assets). */

export async function putObject(bucket, key, bytes, mime) {
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
}

/* in-memory bucket shim for tests: put(key, body, opts) */
export function createMemoryBucket() {
  const map = new Map();
  return {
    async put(key, body, opts) { map.set(key, { body, opts }); },
    async get(key) { return map.has(key) ? map.get(key) : null; },
    _size() { return map.size; },
  };
}
