/* Rastreo DHL · Evidencias para tickets
 * 100% estático (GitHub Pages). Las llaves viven solo en localStorage.
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const CFG_KEY = 'dhltrack_cfg_v1';
  const ROWS_KEY = 'dhltrack_rows_v1';
  const DHL_URL = 'https://api-eu.dhl.com/track/shipments';

  const STATUS_LABEL = {
    delivered: 'Entregado', transit: 'En tránsito', 'pre-transit': 'Pre-tránsito',
    failure: 'Incidencia', unknown: 'Desconocido', error: 'Error de consulta',
    pending: 'Sin consultar', loading: 'Consultando…'
  };

  let cfg = loadCfg();
  let rows = loadRows();          // [{uid,ticket,guia,cp,pdv,contacto,destino,descripcion,serie,modelo,state,result,error,checkedAt}]
  let stopFlag = false;
  let currentUid = null;

  /* ---------------- util ---------------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
  const padCp = (v) => { const d = onlyDigits(v); return d ? d.padStart(5, '0').slice(-5) : ''; };
  const normHeader = (h) => String(h ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  const fileBase = (r) => `${(r.ticket || 'SIN-TICKET').toString().replace(/[^\w-]/g, '')}_${r.guia}`;

  /* ---------------- config ---------------- */
  function loadCfg() {
    const def = { mode: 'proxy', proxyUrl: '', anonKey: '', apiKey: '', delay: 1200, lang: 'es' };
    try { return { ...def, ...(JSON.parse(localStorage.getItem(CFG_KEY)) || {}) }; } catch { return def; }
  }
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
  function fillCfgForm() {
    $('#cfgMode').value = cfg.mode; $('#cfgDelay').value = cfg.delay; $('#cfgProxyUrl').value = cfg.proxyUrl;
    $('#cfgAnonKey').value = cfg.anonKey; $('#cfgApiKey').value = cfg.apiKey; $('#cfgLang').value = cfg.lang;
    toggleModeFields();
  }
  function toggleModeFields() {
    const m = $('#cfgMode').value;
    document.querySelectorAll('.proxyOnly').forEach((e) => e.classList.toggle('hidden', m !== 'proxy'));
    document.querySelectorAll('.directOnly').forEach((e) => e.classList.toggle('hidden', m !== 'direct'));
  }
  function readCfgForm() {
    cfg = {
      mode: $('#cfgMode').value,
      delay: Math.max(300, parseInt($('#cfgDelay').value, 10) || 1200),
      proxyUrl: $('#cfgProxyUrl').value.trim(),
      anonKey: $('#cfgAnonKey').value.trim(),
      apiKey: $('#cfgApiKey').value.trim(),
      lang: $('#cfgLang').value
    };
  }

  /* ---------------- persistencia ---------------- */
  function loadRows() { try { return JSON.parse(localStorage.getItem(ROWS_KEY)) || []; } catch { return []; } }
  function saveRows() {
    try { localStorage.setItem(ROWS_KEY, JSON.stringify(rows.map((r) => ({ ...r, state: r.state === 'loading' ? 'pending' : r.state })))); }
    catch { /* cuota llena: se ignora */ }
  }

  /* ---------------- carga de datos ---------------- */
  const COLS = {
    ticket: [/^TICKET/, /^FOLIO/, /^NO\.? ?TICKET/],
    guia: [/^NO\.? ?GUIA/, /GUIA/, /AWB/, /TRACKING/, /RASTREO/],
    cp: [/^CP DESTINO/, /C\.?P\.? DESTINO/, /CODIGO POSTAL DESTINO/, /^CP$/],
    pdv: [/^PDV/, /TIENDA/, /SUCURSAL/],
    contacto: [/^CONTACTO/, /DESTINATARIO/],
    destino: [/^CD DESTINO/, /CIUDAD DESTINO/, /ESTADO DESTINO/],
    mensajeria: [/MENSAJERIA/, /PAQUETERIA/, /CARRIER/],
    descripcion: [/^DESCRIPCION/],
    modelo: [/^MODELO/],
    serie: [/^SERIE/]
  };

  function mapHeaders(headerRow) {
    const H = headerRow.map(normHeader);
    const map = {};
    for (const [key, regs] of Object.entries(COLS)) {
      for (const re of regs) {
        const i = H.findIndex((h, idx) => re.test(h) && !Object.values(map).includes(idx));
        if (i >= 0) { map[key] = i; break; }
      }
    }
    return map;
  }

  function addRows(list) {
    const existing = new Set(rows.map((r) => r.guia));
    let added = 0, dup = 0, bad = 0;
    for (const x of list) {
      const guia = onlyDigits(x.guia);
      if (guia.length < 8) { bad++; continue; }
      if (existing.has(guia)) { dup++; continue; }
      existing.add(guia);
      rows.push({
        uid: uid(), guia, ticket: String(x.ticket ?? '').trim(), cp: padCp(x.cp),
        pdv: String(x.pdv ?? '').trim(), contacto: String(x.contacto ?? '').trim(),
        destino: String(x.destino ?? '').trim(), descripcion: String(x.descripcion ?? '').trim(),
        modelo: String(x.modelo ?? '').trim(), serie: String(x.serie ?? '').trim(),
        state: 'pending', result: null, error: '', checkedAt: null
      });
      added++;
    }
    saveRows(); render();
    $('#loadMsg').textContent = `Agregadas: ${added} · Duplicadas: ${dup} · Inválidas: ${bad}` + (list.some((x) => !padCp(x.cp)) ? ' · ⚠️ Hay guías sin CP: DHL dará menos detalle.' : '');
  }

  async function handleFile(file) {
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const out = [];
      const onlyDhl = $('#onlyDhl').checked;
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        const hIdx = aoa.findIndex((r) => r.some((c) => /GUIA|AWB|TRACKING/.test(normHeader(c))));
        if (hIdx < 0) continue;
        const map = mapHeaders(aoa[hIdx]);
        if (map.guia == null) continue;
        for (const r of aoa.slice(hIdx + 1)) {
          const get = (k) => (map[k] != null ? r[map[k]] : '');
          if (!onlyDigits(get('guia'))) continue;
          if (onlyDhl && map.mensajeria != null && !/DHL/i.test(get('mensajeria'))) continue;
          out.push({ ticket: get('ticket'), guia: get('guia'), cp: get('cp'), pdv: get('pdv'), contacto: get('contacto'),
            destino: get('destino'), descripcion: get('descripcion'), modelo: get('modelo'), serie: get('serie') });
        }
      }
      if (!out.length) { toast('No encontré una columna de guía (NO GUIA / GUIA / AWB).'); return; }
      addRows(out);
    } catch (e) {
      console.error(e); toast('No pude leer el archivo: ' + e.message);
    }
  }

  function handlePaste() {
    const lines = $('#pasteBox').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const list = lines.map((l) => {
      const p = l.split(/[\t,;|]+/).map((s) => s.trim());
      if (p.length === 1) return { guia: p[0] };
      if (p.length === 2) return onlyDigits(p[0]).length >= 8 ? { guia: p[0], cp: p[1] } : { ticket: p[0], guia: p[1] };
      return { ticket: p[0], guia: p[1], cp: p[2], pdv: p[3] };
    });
    addRows(list);
    $('#pasteBox').value = '';
  }

  /* ---------------- API ---------------- */
  async function fetchTracking(r) {
    if (cfg.mode === 'demo') { await sleep(300); return demoResponse(r); }

    const params = new URLSearchParams({ trackingNumber: r.guia, service: 'express', language: cfg.lang });
    if (r.cp) params.set('recipientPostalCode', r.cp);

    let url, headers;
    if (cfg.mode === 'proxy') {
      if (!cfg.proxyUrl) throw new Error('Falta la URL de la Edge Function en Configuración.');
      url = `${cfg.proxyUrl}?${params}`;
      headers = cfg.anonKey ? { Authorization: `Bearer ${cfg.anonKey}`, apikey: cfg.anonKey } : {};
    } else {
      if (!cfg.apiKey) throw new Error('Falta la DHL API Key en Configuración.');
      url = `${DHL_URL}?${params}`;
      headers = { 'DHL-API-Key': cfg.apiKey, Accept: 'application/json' };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try { res = await fetch(url, { headers }); }
      catch { throw new Error(cfg.mode === 'direct' ? 'El navegador bloqueó la llamada (CORS). Usa el modo Proxy Supabase.' : 'No se pudo conectar con la Edge Function.'); }

      if (res.status === 429) { await sleep(4000 * (attempt + 1)); continue; }
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      if (res.status === 404) throw new Error('DHL no encontró la guía (404).');
      if (res.status === 401 || res.status === 403) throw new Error('Llave inválida o sin permiso (' + res.status + ').');
      if (!res.ok) throw new Error((json && (json.detail || json.title || json.error)) || `Error HTTP ${res.status}`);
      return json;
    }
    throw new Error('Límite de consultas alcanzado (429). Sube la pausa o intenta más tarde.');
  }

  function locText(l) {
    const a = l?.address || {};
    return [a.addressLocality, a.countryCode].filter(Boolean).join(', ');
  }

  function normalize(json) {
    const s = json?.shipments?.[0];
    if (!s) return null;
    const d = s.details || {};
    const pod = d.proofOfDelivery || {};
    const signed = pod.signed || {};
    const signedBy = signed.name || [signed.givenName, signed.familyName].filter(Boolean).join(' ') || '';
    return {
      id: s.id,
      service: s.service,
      product: d.product?.productName || '',
      statusCode: s.status?.statusCode || 'unknown',
      status: s.status?.status || '',
      description: s.status?.description || s.status?.remark || '',
      lastTs: s.status?.timestamp || '',
      lastLoc: locText(s.status?.location),
      origin: locText(s.origin),
      destination: locText(s.destination),
      eta: s.estimatedTimeOfDelivery || '',
      pieces: d.totalNumberOfPieces ?? '',
      weight: d.weight ? `${d.weight.value} ${d.weight.unitText || ''}`.trim() : '',
      signedBy,
      podUrl: pod.documentUrl || '',
      podTs: pod.timestamp || '',
      events: (s.events || []).map((e) => ({
        ts: e.timestamp, loc: locText(e.location), desc: e.description || e.status || '', code: e.statusCode || ''
      }))
    };
  }

  async function checkRow(r) {
    r.state = 'loading'; r.error = ''; renderRow(r);
    try {
      const json = await fetchTracking(r);
      const n = normalize(json);
      if (!n) throw new Error('Respuesta sin información de envío.');
      r.result = n; r.state = n.statusCode; r.checkedAt = new Date().toISOString();
    } catch (e) {
      r.state = 'error'; r.error = e.message; r.checkedAt = new Date().toISOString();
    }
    renderRow(r); saveRows(); updateCounters();
    return r;
  }

  async function runAll() {
    const targets = visibleRows().filter((r) => r.state !== 'delivered');
    const list = targets.length ? targets : visibleRows();
    if (!list.length) { toast('No hay guías para consultar.'); return; }
    stopFlag = false;
    $('#btnRun').disabled = true; $('#btnStop').classList.remove('hidden'); $('#progressWrap').classList.remove('hidden');
    for (let i = 0; i < list.length; i++) {
      if (stopFlag) break;
      setProgress(i, list.length);
      await checkRow(list[i]);
      if (i < list.length - 1 && cfg.mode !== 'demo') await sleep(cfg.delay);
    }
    setProgress(list.length, list.length);
    $('#btnRun').disabled = false; $('#btnStop').classList.add('hidden');
    toast(stopFlag ? 'Consulta detenida.' : 'Consulta terminada. (Las entregadas no se reconsultan.)');
    setTimeout(() => $('#progressWrap').classList.add('hidden'), 1500);
  }
  function setProgress(i, n) {
    $('#progressBar').style.width = `${(i / n) * 100}%`;
    $('#progressTxt').textContent = `${i} / ${n}`;
  }

  /* ---------------- tabla ---------------- */
  function visibleRows() {
    const q = $('#search').value.trim().toLowerCase();
    const f = $('#statusFilter').value;
    return rows.filter((r) => {
      if (f && r.state !== f) return false;
      if (!q) return true;
      return [r.ticket, r.guia, r.pdv, r.destino, r.contacto, r.result?.destination].join(' ').toLowerCase().includes(q);
    });
  }
  function rowHtml(r) {
    const st = r.state;
    const last = r.result ? `${esc(r.result.description || r.result.status)}<br><span class="muted small">${esc(fmtDate(r.result.lastTs))} ${esc(r.result.lastLoc)}</span>` :
      (r.error ? `<span class="small" style="color:var(--bad)">${esc(r.error)}</span>` : '');
    return `<td class="mono">${esc(r.ticket)}</td>
      <td class="mono">${esc(r.guia)}</td>
      <td class="mono">${esc(r.cp) || '<span class="muted">—</span>'}</td>
      <td>${esc(r.pdv)}<br><span class="muted small">${esc(r.destino || r.result?.destination || '')}</span></td>
      <td><span class="badge b-${esc(st)}">${esc(STATUS_LABEL[st] || st)}</span></td>
      <td>${last}</td>
      <td class="row gap">
        <button class="btn" data-act="check" data-uid="${r.uid}" title="Consultar">↻</button>
        <button class="btn" data-act="view" data-uid="${r.uid}" ${r.result ? '' : 'disabled'}>Ficha</button>
        <button class="btn ghost" data-act="del" data-uid="${r.uid}" title="Quitar">✕</button>
      </td>`;
  }
  function render() {
    const tb = $('#tbl tbody');
    const list = visibleRows();
    tb.innerHTML = list.map((r) => `<tr id="r-${r.uid}">${rowHtml(r)}</tr>`).join('');
    $('#emptyMsg').classList.toggle('hidden', rows.length > 0);
    updateCounters();
  }
  function renderRow(r) {
    const tr = document.getElementById('r-' + r.uid);
    if (tr) tr.innerHTML = rowHtml(r);
  }
  function updateCounters() {
    const c = {}; rows.forEach((r) => { c[r.state] = (c[r.state] || 0) + 1; });
    $('#counters').textContent = `${rows.length} guías · ` + Object.entries(c).map(([k, v]) => `${STATUS_LABEL[k] || k}: ${v}`).join(' · ');
  }

  /* ---------------- ficha ---------------- */
  function fichaHtml(r) {
    const x = r.result || {};
    const st = x.statusCode || 'unknown';
    const delivered = st === 'delivered';
    const events = (x.events || []);
    const cell = (label, val) => `<div><span>${label}</span><b>${esc(val) || '—'}</b></div>`;
    return `<div class="ficha">
      <div class="f-head">
        <span class="logo">DHL</span>
        <div class="t">Guía ${esc(r.guia)}<small>${r.ticket ? 'Ticket ' + esc(r.ticket) : ''}${x.product ? ' · ' + esc(x.product) : ''}</small></div>
      </div>
      <div class="f-status ${esc(st)}">
        <div>
          <div class="big">${esc(STATUS_LABEL[st] || x.status || st)}</div>
          <div class="desc">${esc(x.description || x.status)}</div>
        </div>
        <div style="text-align:right">
          <div class="small muted">${delivered ? 'Entregado el' : 'Última actualización'}</div>
          <div style="font-weight:700">${esc(fmtDate(x.lastTs))}</div>
          <div class="small">${esc(x.lastLoc)}</div>
        </div>
      </div>
      <div class="f-route"><span>${esc(x.origin) || 'Origen'}</span><span class="arrow">➜</span><span>${esc(x.destination) || 'Destino'}</span></div>
      <div class="f-grid">
        ${cell('Ticket', r.ticket)}
        ${cell('Tienda / PDV', r.pdv)}
        ${cell('Contacto', r.contacto)}
        ${cell('Equipo', [r.descripcion, r.modelo].filter(Boolean).join(' · '))}
        ${cell('Serie', r.serie)}
        ${cell('CP destino', r.cp)}
        ${cell(delivered ? 'Recibió / firmó' : 'Entrega estimada', delivered ? x.signedBy : fmtDate(x.eta))}
        ${cell('Piezas', x.pieces)}
        ${cell('Peso', x.weight)}
      </div>
      ${!r.cp ? '<div class="f-warn" style="margin-top:12px">⚠️ Consulta sin código postal: DHL oculta parte del historial y el comprobante de entrega.</div>' : ''}
      <div class="f-sec">
        <h3>Historial del envío (${events.length})</h3>
        <ul class="tl">
          ${events.map((e) => `<li><div class="when">${esc(fmtDate(e.ts))}</div><div class="dot"></div>
            <div><div class="what">${esc(e.desc)}</div><div class="where">${esc(e.loc)}</div></div></li>`).join('') || '<li><div></div><div></div><div class="muted">Sin eventos disponibles.</div></li>'}
        </ul>
      </div>
      <div class="f-foot">
        <span>Fuente: DHL Shipment Tracking API${cfg.mode === 'demo' ? ' (DEMO)' : ''}</span>
        <span>Consultado: ${esc(fmtDate(r.checkedAt))}</span>
      </div>
    </div>`;
  }

  function openModal(r) {
    currentUid = r.uid;
    $('#modalTitle').textContent = `Ficha · ${r.ticket ? 'Ticket ' + r.ticket + ' · ' : ''}Guía ${r.guia}`;
    $('#cardHost').innerHTML = fichaHtml(r);
    $('#modal').classList.remove('hidden');
  }
  const currentRow = () => rows.find((r) => r.uid === currentUid);

  async function captureEl(el) {
    if (document.fonts?.ready) await document.fonts.ready;
    return html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  }
  const canvasBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));

  async function exportPng() {
    const r = currentRow(); if (!r) return;
    const c = await captureEl($('#cardHost .ficha'));
    download(await canvasBlob(c), fileBase(r) + '.png');
  }
  async function exportPdf() {
    const r = currentRow(); if (!r) return;
    const c = await captureEl($('#cardHost .ficha'));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth() - 40;
    const ph = pdf.internal.pageSize.getHeight() - 40;
    let w = pw, h = (c.height * pw) / c.width;
    if (h > ph) { h = ph; w = (c.width * ph) / c.height; }
    pdf.addImage(c.toDataURL('image/png'), 'PNG', 20, 20, w, h);
    pdf.save(fileBase(r) + '.pdf');
  }
  async function copyImage() {
    try {
      const c = await captureEl($('#cardHost .ficha'));
      const blob = await canvasBlob(c);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Imagen copiada. Pégala con Ctrl+V en tu ticket.');
    } catch { toast('Tu navegador no permite copiar imágenes; usa ⬇ PNG.'); }
  }

  async function exportZip() {
    const list = visibleRows().filter((r) => r.result);
    if (!list.length) { toast('No hay fichas consultadas para exportar.'); return; }
    const zip = new JSZip();
    const host = $('#offscreen');
    $('#progressWrap').classList.remove('hidden');
    for (let i = 0; i < list.length; i++) {
      setProgress(i, list.length);
      host.innerHTML = fichaHtml(list[i]);
      const c = await captureEl(host.firstElementChild);
      zip.file(fileBase(list[i]) + '.png', await canvasBlob(c));
    }
    host.innerHTML = '';
    setProgress(list.length, list.length);
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, `evidencias_dhl_${new Date().toISOString().slice(0, 10)}.zip`);
    setTimeout(() => $('#progressWrap').classList.add('hidden'), 1000);
  }

  function exportXlsx() {
    if (!rows.length) { toast('No hay datos.'); return; }
    const data = visibleRows().map((r) => ({
      TICKET: r.ticket, GUIA: r.guia, CP_DESTINO: r.cp, PDV: r.pdv, CONTACTO: r.contacto,
      ESTATUS: STATUS_LABEL[r.state] || r.state,
      DETALLE: r.result?.description || r.error || '',
      ULTIMA_ACTUALIZACION: fmtDate(r.result?.lastTs),
      UBICACION: r.result?.lastLoc || '',
      ORIGEN: r.result?.origin || '', DESTINO: r.result?.destination || '',
      ENTREGA_ESTIMADA: fmtDate(r.result?.eta),
      FIRMO: r.result?.signedBy || '',
      PIEZAS: r.result?.pieces ?? '', PESO: r.result?.weight || '',
      CONSULTADO: fmtDate(r.checkedAt)
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = Object.keys(data[0]).map((k) => ({ wch: Math.max(12, k.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rastreo DHL');
    XLSX.writeFile(wb, `rastreo_dhl_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /* ---------------- demo ---------------- */
  function demoResponse(r) {
    const now = Date.now(), h = 3600e3;
    const delivered = Number(r.guia.slice(-1)) % 2 === 0;
    const ev = [
      { t: now - 70 * h, s: 'transit', d: 'Envío recogido', c: 'MEXICO CITY' },
      { t: now - 66 * h, s: 'transit', d: 'Procesado en instalación DHL', c: 'MEXICO CITY' },
      { t: now - 50 * h, s: 'transit', d: 'Llegó a la instalación de destino', c: 'GUADALAJARA' },
      { t: now - 30 * h, s: 'transit', d: 'Con mensajero para entrega', c: 'GUADALAJARA' }
    ];
    if (delivered) ev.push({ t: now - 26 * h, s: 'delivered', d: 'Entregado', c: 'GUADALAJARA' });
    const last = ev[ev.length - 1];
    return {
      shipments: [{
        id: r.guia, service: 'express',
        origin: { address: { addressLocality: 'MEXICO CITY', countryCode: 'MX' } },
        destination: { address: { addressLocality: 'GUADALAJARA', countryCode: 'MX' } },
        status: { timestamp: new Date(last.t).toISOString(), statusCode: last.s, status: last.d, description: last.d,
          location: { address: { addressLocality: last.c, countryCode: 'MX' } } },
        estimatedTimeOfDelivery: new Date(now + 20 * h).toISOString(),
        details: { product: { productName: 'EXPRESS DOMESTIC' }, totalNumberOfPieces: 1, weight: { value: 2.5, unitText: 'kg' },
          proofOfDelivery: delivered ? { signed: { name: 'RECEPCIÓN TIENDA' } } : undefined },
        events: ev.slice().reverse().map((e) => ({ timestamp: new Date(e.t).toISOString(), statusCode: e.s, description: e.d,
          location: { address: { addressLocality: e.c, countryCode: 'MX' } } }))
      }]
    };
  }

  /* ---------------- eventos ---------------- */
  function bind() {
    $('#btnConfig').onclick = () => $('#configPanel').classList.toggle('hidden');
    $('#cfgMode').onchange = toggleModeFields;
    $('#btnSaveCfg').onclick = () => { readCfgForm(); saveCfg(); $('#cfgMsg').textContent = '✔ Guardado'; };
    $('#btnTestCfg').onclick = async () => {
      readCfgForm(); saveCfg();
      $('#cfgMsg').textContent = 'Probando…';
      try {
        await fetchTracking({ guia: '0000000000', cp: '' });
        $('#cfgMsg').textContent = '✔ Conexión correcta.';
      } catch (e) {
        $('#cfgMsg').textContent = /404|no encontró/i.test(e.message) ? '✔ Conexión correcta (la guía de prueba no existe, es normal).' : '✖ ' + e.message;
      }
    };

    const dz = $('#dropZone');
    $('#pickFile').onclick = (e) => { e.preventDefault(); $('#fileInput').click(); };
    $('#fileInput').onchange = (e) => { handleFile(e.target.files[0]); e.target.value = ''; };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); handleFile(e.dataTransfer.files[0]); };
    $('#btnAddPaste').onclick = handlePaste;

    $('#btnRun').onclick = runAll;
    $('#btnStop').onclick = () => { stopFlag = true; };
    $('#btnZip').onclick = exportZip;
    $('#btnXlsx').onclick = exportXlsx;
    $('#btnClear').onclick = () => { if (confirm('¿Quitar todas las guías de la lista?')) { rows = []; saveRows(); render(); } };
    $('#search').oninput = render;
    $('#statusFilter').onchange = render;

    $('#tbl tbody').onclick = async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const r = rows.find((x) => x.uid === b.dataset.uid); if (!r) return;
      if (b.dataset.act === 'check') await checkRow(r);
      if (b.dataset.act === 'view') openModal(r);
      if (b.dataset.act === 'del') { rows = rows.filter((x) => x !== r); saveRows(); render(); }
    };

    $('#btnClose').onclick = () => $('#modal').classList.add('hidden');
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').classList.add('hidden'); });
    $('#btnPng').onclick = exportPng;
    $('#btnPdf').onclick = exportPdf;
    $('#btnCopy').onclick = copyImage;
    $('#btnRefresh').onclick = async () => { const r = currentRow(); if (r) { await checkRow(r); openModal(r); } };
  }

  fillCfgForm();
  bind();
  render();
  if (!cfg.proxyUrl && !cfg.apiKey && cfg.mode !== 'demo') $('#configPanel').classList.remove('hidden');
})();
