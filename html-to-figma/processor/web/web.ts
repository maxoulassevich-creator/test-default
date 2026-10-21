/* Резервная веб-страница обработчика: подготовка пакета импорта без связи Figma ↔ localhost. */
import { Processor } from '../../plugin/src/ui/client';

const $ = (id: string) => document.getElementById(id)!;
const proc = new Processor(location.origin, sessionStorage.getItem('h2f-token'));
let jobId = '';
type Route = { key: string; label: string; status: string; reason?: string };

async function refreshPair() {
  try {
    const h = await proc.health();
    $('pairState').textContent = h.paired ? 'подключено' : 'нужен код';
    $('up').classList.toggle('hidden', !h.paired);
  } catch (e) { $('err').textContent = (e as Error).message; }
}

async function poll(): Promise<{ state: string; routes: Route[]; error?: { message: string; action: string } }> {
  for (;;) {
    const s = await proc.status<{ state: string; progress: { done: number; total: number; message: string }; routes: Route[]; error?: { message: string; action: string } }>(jobId);
    ($('prog') as HTMLProgressElement).value = s.progress.total ? (100 * s.progress.done) / s.progress.total : 5;
    $('state').textContent = s.progress.message;
    if (s.state !== 'analyzing' && s.state !== 'capturing') return s;
    await new Promise((r) => setTimeout(r, 700));
  }
}

$('pairBtn').onclick = async () => {
  try { const t = await proc.pair(($('code') as HTMLInputElement).value); sessionStorage.setItem('h2f-token', t); await refreshPair(); }
  catch (e) { $('err').textContent = (e as Error).message; }
};
$('go').onclick = async () => {
  const f = ($('file') as HTMLInputElement).files?.[0];
  if (!f) return;
  $('err').textContent = '';
  $('prog').classList.remove('hidden');
  jobId = await proc.upload(f, f.name, {});
  const s = await poll();
  if (s.error) { $('err').textContent = s.error.message + ' ' + s.error.action; return; }
  $('list').classList.remove('hidden');
  $('routes').innerHTML = s.routes.map((r) => `<li><label><input type="checkbox" value="${r.key.replace(/"/g, '&quot;')}" ${r.status === 'ok' ? 'checked' : 'disabled'}> ${r.label} <span class="muted">${r.key}${r.reason ? ' — ' + r.reason : ''}</span></label></li>`).join('');
};
$('all').onclick = () => document.querySelectorAll<HTMLInputElement>('#routes input:not(:disabled)').forEach((i) => (i.checked = true));
$('none').onclick = () => document.querySelectorAll<HTMLInputElement>('#routes input').forEach((i) => (i.checked = false));
$('cap').onclick = async () => {
  const routes = [...document.querySelectorAll<HTMLInputElement>('#routes input:checked')].map((i) => i.value);
  await proc.capture(jobId, { routes });
  const s = await poll();
  if (s.error) { $('err').textContent = s.error.message; return; }
  const blob = await proc.blob(`/api/jobs/${jobId}/package`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'import.h2f.zip';
  a.click();
};
const code = new URLSearchParams(location.search).get('code');
if (code) ($('code') as HTMLInputElement).value = code;
void refreshPair();
