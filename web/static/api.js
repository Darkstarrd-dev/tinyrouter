const API = '/api';

async function apiGet(path, signal) {
  const r = await fetch(API + path, { signal: signal });
  return r.json();
}
async function apiPost(path, body, signal) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal
  });
  return r.json();
}
async function apiPatch(path, body, signal) {
  const r = await fetch(API + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal
  });
  return r.json();
}
async function apiPut(path, body, signal) {
  const r = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal
  });
  return r.json();
}
async function apiDelete(path, signal) {
  const r = await fetch(API + path, { method: 'DELETE', signal: signal });
  return r.json();
}
