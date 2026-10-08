// Accès au serveur Sillon.
async function call(method, url, data) {
  const res = await fetch(url, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Erreur ${res.status}`);
  return out;
}

export const api = {
  library: () => call('GET', '/api/library'),
  played: (id) => call('POST', `/api/tracks/${id}/play`),
  duration: (id, duration) => call('POST', `/api/tracks/${id}/duration`, { duration }),
  streamURL: (id) => `/api/stream/${id}`,

  // XHR pour suivre la progression de l'envoi.
  upload(file, onProgress, key = '') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      if (key) xhr.setRequestHeader('Authorization', `Bearer ${key}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let out = {};
        try { out = JSON.parse(xhr.responseText); } catch { /* réponse vide */ }
        xhr.status < 300 ? resolve(out) : reject(Object.assign(new Error(out.error || `Erreur ${xhr.status}`), { status: xhr.status }));
      };
      xhr.onerror = () => reject(new Error('Serveur injoignable'));
      xhr.send(file);
    });
  },
};
