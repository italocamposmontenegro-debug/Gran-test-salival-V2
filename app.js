
(() => {
  'use strict';

  /** =============== Storage keys =============== **/
  const KEY_EVALS = 'gtcs_evaluations_v2';
  const KEY_ACTIVE = 'gtcs_active_id_v2';
  const KEY_CONFIG = 'gtcs_config_v2';
  const KEY_SW_VER = 'gtcs_sw_ver_v2';

  /** =============== Helpers =============== **/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => 'e_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);

  const todayISO = () => new Date().toISOString().slice(0, 10);

  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.add('hidden'), 2500);
  }

  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  /** =============== Default config =============== **/
  const DEFAULT_CONFIG = {
    disItems: [
      'Impacto en higiene personal',
      'Necesidad de cambiar ropa/babero',
      'Irritación de piel/dermatitis perioral',
      'Interferencia en alimentación',
      'Interferencia en habla/comunicación',
      'Impacto en interacción social',
      'Molestia para el usuario',
      'Carga para cuidadores/familia',
      'Limitación en participación escolar/comunitaria',
      'Dificultad en manejo diario (toallas, limpieza, etc.)'
    ],
    dq5Bands: { low: 10, mild: 30, mod: 60 },
    disBands: { low: 20, mod: 50 },
    disScale: { min: 0, max: 10 } // 0–10
  };

  function loadConfig() {
    const raw = localStorage.getItem(KEY_CONFIG);
    const cfg = raw ? safeParse(raw, null) : null;
    return cfg ? { ...DEFAULT_CONFIG, ...cfg } : structuredClone(DEFAULT_CONFIG);
  }

  function saveConfig(cfg) {
    localStorage.setItem(KEY_CONFIG, JSON.stringify(cfg));
    toast('Configuración guardada');
  }

  /** =============== Evaluation template =============== **/
  function defaultEvaluation() {
    return {
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: 'Evaluación ' + new Date().toLocaleString('es-CL'),
      mode: 'completo',
      data: {
        // Sección 0: Identificación
        nombrePaciente: '',
        idFicha: '',
        fechaEvaluacion: todayISO(),
        edadAnios: '',
        edadMeses: '',
        diagnosticoBase: '',
        contextoEvaluacion: 'clinico',
        evaluador: '',
        observacionesGenerales: '',

        // Sección 1: Contexto y Antecedentes
        motivoEvaluacion: '',
        evaluacionAnterior: {
          fecha: '',
          tiempoTranscurrido: '',
          resultadosPrevios: ''
        },

        // Sección 2: DQ5 Actividad
        dq5Actividad: {
          intervalos: Array(20).fill(0),
          contexto: '',
          condiciones: {
            vigilia: false,
            sedente: false,
            sinIngesta: false,
            actividadBasal: false,
            otro: false,
            otroTexto: ''
          },
          patronObservado: {
            escapeAnterior: false,
            posturaAbierta: false,
            bajaDeglusion: false,
            hipotonia: false,
            otro: false,
            otroTexto: ''
          }
        },

        // Sección 3: DQ5 Reposo
        dq5Reposo: {
          intervalos: Array(20).fill(0),
          contexto: '',
          condiciones: {
            vigilia: false,
            sedente: false,
            sinIngesta: false,
            actividadBasal: false,
            otro: false,
            otroTexto: ''
          },
          patronObservado: {
            escapeAnterior: false,
            posturaAbierta: false,
            bajaDeglusion: false,
            hipotonia: false,
            otro: false,
            otroTexto: ''
          }
        },

        // Legacy DQ5 fields (for backwards compatibility)
        intervalos: Array(20).fill(0),
        condicionesDQ5: {
          vigilia: false, sedente: false, sinIngesta: false, actividadBasal: false, otro: false, otroTexto: ''
        },
        patronObservado: {
          escapeAnterior: false, posturaAbierta: false, bajaDeglusion: false, hipotonia: false, otro: false, otroTexto: ''
        },

        // Sección 4: Frecuencia de Babeo (0-3 each, total 0-15)
        frecuenciaBabeo: {
          sentado: 0,
          enPie: 0,
          enCama: 0,
          hablando: 0,
          comerBeber: 0
        },

        // Sección 5: Thomas-Stonell (respaldo clínico)
        severidad: 1,
        frecuencia: 1,

        // Sección 6: DIS (1-10 per item, 10 items = max 100)
        disItems: Array(10).fill(1),

        // Sección 7: Integración/Síntesis
        comentarioIntegracion: '',
        etiologiaOrientativa: 'neuromotor',

        // Sección 8: Plan
        objetivosSeleccionados: {
          selladoLabial: true,
          aumentoDeglusion: true,
          concienciaSensorial: false,
          manejoPostural: false,
          entrenamientoCuidadores: true
        },
        semanasReevaluacion: 10,
        derivaciones: {
          medico: false,
          dermatologia: false,
          odontologia: false
        },
        planNotas: '',

        // Sección 9: Informe editable
        informeEditable: '',
        diagnosticoEditable: ''
      }
    };
  }


  /** =============== App state =============== **/
  const state = {
    cfg: loadConfig(),
    mode: 'completo', // ui mode
    step: 0,
    evals: [],
    activeId: null,
    active: null,
    dqTimer: {
      running: false,
      intervalIndex: 0,
      seconds: 0,
      handle: null
    }
  };

  /** =============== Persistence =============== **/
  function loadAll() {
    const raw = localStorage.getItem(KEY_EVALS);
    state.evals = raw ? safeParse(raw, []) : [];
    state.activeId = localStorage.getItem(KEY_ACTIVE) || (state.evals[0]?.id ?? null);
    if (state.activeId) {
      state.active = state.evals.find(e => e.id === state.activeId) || null;
    }
    if (!state.active && state.evals.length) {
      state.active = state.evals[0];
      state.activeId = state.active.id;
      localStorage.setItem(KEY_ACTIVE, state.activeId);
    }
  }

  function persist() {
    localStorage.setItem(KEY_EVALS, JSON.stringify(state.evals));
    if (state.activeId) localStorage.setItem(KEY_ACTIVE, state.activeId);
  }

  function upsertActive() {
    if (!state.active) return;
    state.active.updatedAt = new Date().toISOString();
    const idx = state.evals.findIndex(e => e.id === state.active.id);
    if (idx >= 0) state.evals[idx] = state.active;
    else state.evals.unshift(state.active);
    persist();
  }

  /** =============== Clinical calculations =============== **/
  function calcDQ5(data) {
    // If dual data exists, use the average as the representative "DQ5" for legacy functions
    if (data.dq5Actividad?.intervalos && data.dq5Reposo?.intervalos) {
      const dual = calcDQ5Dual(data);
      return {
        nEscape: dual.actividad.nEscape + dual.reposo.nEscape,
        pct: dual.promedio,
        cat: dual.cat
      };
    }
    // Legacy support
    const nEscape = (data.intervalos || []).reduce((acc, v) => acc + (v === 1 ? 1 : 0), 0);
    const pct = Number(((nEscape / 20) * 100).toFixed(1));
    const b = state.cfg.dq5Bands;
    let cat;
    if (pct <= b.low) cat = 'Frecuencia baja';
    else if (pct <= b.mild) cat = 'Frecuencia leve';
    else if (pct <= b.mod) cat = 'Frecuencia moderada';
    else cat = 'Frecuencia alta';
    return { nEscape, pct, cat };
  }

  function calcThomas(data) {
    const sev = Number(data.severidad);
    const fr = Number(data.frecuencia);

    const sevCat = (sev <= 2) ? 'Leve' : (sev === 3 ? 'Moderada' : 'Severa');

    let frCat = 'Ausente';
    if (fr === 2) frCat = 'Ocasional';
    else if (fr === 3) frCat = 'Frecuente';
    else if (fr === 4) frCat = 'Constante';

    return { sevCat, frCat };
  }

  function calcDIS(data) {
    const vals = data.disItems || [];
    const total = vals.reduce((a, b) => a + Number(b || 0), 0);
    const max = 100; // DIS uses 1-10 scale for 10 items = max 100
    const pct = max > 0 ? (total / max) * 100 : 0;

    const b = state.cfg.disBands;
    let cat;
    if (pct <= b.low) cat = 'Impacto leve';
    else if (pct <= b.mod) cat = 'Impacto moderado';
    else cat = 'Impacto severo';

    return { total, pct: Number(pct.toFixed(1)), cat, max };
  }

  /** =============== New Clinical Calculations =============== **/

  // Calculate DQ5 for a single session (activity or rest)
  function calcDQ5Single(intervalos) {
    const arr = intervalos || [];
    const nEscape = arr.reduce((acc, v) => acc + (v === 1 ? 1 : 0), 0);
    const pct = (nEscape / 20) * 100;
    return { nEscape, pct: Number(pct.toFixed(1)) };
  }

  // Calculate DQ5 Dual Mode (activity + rest + average)
  function calcDQ5Dual(data) {
    const actividad = calcDQ5Single(data.dq5Actividad?.intervalos);
    const reposo = calcDQ5Single(data.dq5Reposo?.intervalos);
    const promedio = Number(((actividad.pct + reposo.pct) / 2).toFixed(1));

    const b = state.cfg.dq5Bands;
    let cat;
    if (promedio <= b.low) cat = 'Frecuencia baja';
    else if (promedio <= b.mild) cat = 'Frecuencia leve';
    else if (promedio <= b.mod) cat = 'Frecuencia moderada';
    else cat = 'Frecuencia alta';

    return {
      actividad,
      reposo,
      promedio,
      cat,
      contextoActividad: data.dq5Actividad?.contexto || '',
      contextoReposo: data.dq5Reposo?.contexto || ''
    };
  }

  // Calculate Drooling Frequency Scale (0-15)
  function calcFrecuenciaBabeo(data) {
    const fb = data.frecuenciaBabeo || {};
    const values = [fb.sentado || 0, fb.enPie || 0, fb.enCama || 0, fb.hablando || 0, fb.comerBeber || 0];
    const total = values.reduce((a, b) => a + Number(b), 0);

    // Generate descriptive text based on scores
    const activities = ['sentado', 'de pie', 'en cama', 'hablando', 'comiendo y bebiendo'];
    const scoreDescriptions = [
      'sequedad/sin exceso',
      'exceso de saliva sin babeo',
      'babeo leve-moderado (limpieza ocasional)',
      'babeo continuo, ropa mojada y/o uso de pañuelo'
    ];

    const highActivities = [];
    values.forEach((v, i) => {
      if (v === 3) highActivities.push(activities[i]);
    });

    let texto = '';
    if (total === 15) {
      texto = 'babeo continuo, ropa mojada y/o uso constante de pañuelo en actividades de la vida diaria como sentado, de pie, en cama, hablando, comiendo y bebiendo';
    } else if (total >= 10) {
      texto = `babeo frecuente en múltiples actividades${highActivities.length ? ' especialmente ' + highActivities.join(', ') : ''}`;
    } else if (total >= 5) {
      texto = 'babeo moderado en algunas actividades de la vida diaria';
    } else if (total > 0) {
      texto = 'babeo ocasional o leve';
    } else {
      texto = 'sin evidencia de babeo significativo';
    }

    return {
      total,
      max: 15,
      texto,
      values: {
        sentado: fb.sentado || 0,
        enPie: fb.enPie || 0,
        enCama: fb.enCama || 0,
        hablando: fb.hablando || 0,
        comerBeber: fb.comerBeber || 0
      }
    };
  }

  // Classify impact level and detect high impact
  function classifyImpact(data) {
    const freq = calcFrecuenciaBabeo(data);
    const dis = calcDIS(data);
    const dq5 = calcDQ5Dual(data);

    const isHighImpact = (
      freq.total === 15 &&
      dis.pct >= 70 &&
      dq5.promedio >= 60
    );

    // Check for worsening compared to previous evaluation
    const hasWorsened = data.evaluacionAnterior?.resultadosPrevios &&
      data.evaluacionAnterior.resultadosPrevios.toLowerCase().includes('mejor');

    let level = 'BAJO';
    if (isHighImpact) level = 'ALTO';
    else if (dis.pct >= 50 || dq5.promedio >= 40) level = 'MODERADO';

    return {
      level,
      isHighImpact,
      hasWorsened,
      freq,
      dis,
      dq5
    };
  }

  function analyzeIntegration(data) {
    const dq = calcDQ5(data);
    const th = calcThomas(data);
    const di = calcDIS(data);

    const dqHigh = dq.pct > state.cfg.dq5Bands.mod;
    const thHigh = (th.sevCat === 'Severa') || (th.frCat === 'Constante');
    const diHigh = di.cat === 'Impacto severo';

    const nHigh = [dqHigh, thHigh, diHigh].filter(Boolean).length;

    if (nHigh >= 2) return { label: 'Concordante alto', requiresComment: false, code: 'concordante_alto' };
    if (!dqHigh && diHigh) return { label: 'Discordante (DQ5 bajo pero DIS alto — posible sesgo contextual)', requiresComment: true, code: 'disc_dq5_bajo_dis_alto' };
    if (dqHigh && !diHigh) return { label: 'Discordante (DQ5 alto pero DIS bajo — posible adaptación familiar)', requiresComment: true, code: 'disc_dq5_alto_dis_bajo' };
    return { label: 'Concordante', requiresComment: false, code: 'concordante' };
  }

  function profileResult(data) {
    const dq = calcDQ5(data);
    const th = calcThomas(data);
    const di = calcDIS(data);

    const highFlags = [
      dq.pct > state.cfg.dq5Bands.mod,
      th.sevCat === 'Severa' || th.frCat === 'Constante',
      di.cat === 'Impacto severo'
    ];
    const nHigh = highFlags.filter(Boolean).length;

    if (nHigh >= 2) {
      return {
        profile: 'Sialorrea persistente de alto impacto funcional',
        why: `DQ5 ${dq.pct}% (${dq.cat}); Thomas‑Stonell ${th.sevCat}/${th.frCat}; DIS ${di.cat} (${di.pct}%). ≥2 indicadores en rango alto.`
      };
    }
    if (nHigh === 1) {
      return {
        profile: 'Sialorrea funcional moderada',
        why: `Perfil intermedio: DQ5 ${dq.pct}% (${dq.cat}); Thomas‑Stonell ${th.sevCat}/${th.frCat}; DIS ${di.cat} (${di.pct}%).`
      };
    }
    return {
      profile: 'Sialorrea de baja frecuencia y bajo impacto',
      why: `Indicadores predominantemente bajos: DQ5 ${dq.pct}% (${dq.cat}); Thomas‑Stonell ${th.sevCat}/${th.frCat}; DIS ${di.cat} (${di.pct}%).`
    };
  }

  function diagnosisText(data) {
    const dq = calcDQ5(data);
    const th = calcThomas(data);
    const di = calcDIS(data);
    const pr = profileResult(data);

    const map = {
      neuromotor: 'de origen neuromotor',
      sensorial: 'con componente sensorial predominante',
      mixto: 'de etiología mixta (neuromotor–sensorial)',
      evaluacion: 'en proceso de evaluación etiológica'
    };

    return [
      'DIAGNÓSTICO FONOAUDIOLÓGICO ORIENTADOR',
      '',
      `Trastorno del control salival ${map[data.etiologiaOrientativa] ?? 'en evaluación'}, caracterizado por:`,
      '',
      `- Frecuencia objetiva (DQ5): ${dq.pct}% de intervalos con escape visible (${dq.nEscape}/20). ${dq.cat}.`,
      `- Severidad funcional (Thomas‑Stonell & Greenberg): ${th.sevCat}, con frecuencia ${th.frCat}.`,
      `- Impacto funcional/psicosocial (DIS): ${di.total}/${di.max} puntos (${di.pct}%), ${di.cat}.`,
      '',
      `Perfil clínico resultante: ${pr.profile}.`,
      '',
      'NOTA METODOLÓGICA: El DQ5 no posee puntos de corte universales; se interpreta como indicador continuo de frecuencia integrado a escalas funcionales y al contexto clínico.'
    ].join('\n');
  }

  /** =============== Validations per step =============== **/
  function stepValid(step, data) {
    // Step 0: Identification
    if (step === 0) {
      if (!data.fechaEvaluacion) return { ok: false, msg: 'Falta fecha de evaluación.' };
      const a = String(data.edadAnios ?? '').trim();
      if (!a) return { ok: false, msg: 'Falta edad (años) o ingresa "NN".' };
      if (a.toUpperCase() !== 'NN') {
        const n = Number(a);
        if (!(n > 0)) return { ok: false, msg: 'La edad (años) debe ser > 0 o "NN".' };
      }
      return { ok: true };
    }
    // Step 1: Context - always valid
    if (step === 1) return { ok: true };
    // Step 2: DQ5 Actividad - always valid
    if (step === 2) return { ok: true };
    // Step 3: DQ5 Reposo - always valid
    if (step === 3) return { ok: true };
    // Step 4: Frecuencia de Babeo - always valid
    if (step === 4) return { ok: true };
    // Step 5: Thomas-Stonell (backup)
    if (step === 5) {
      if (!(Number(data.severidad) >= 1 && Number(data.severidad) <= 5)) return { ok: false, msg: 'Completa Severidad (Thomas‑Stonell).' };
      if (!(Number(data.frecuencia) >= 1 && Number(data.frecuencia) <= 4)) return { ok: false, msg: 'Completa Frecuencia (Thomas‑Stonell).' };
      return { ok: true };
    }
    // Step 6: DIS - always valid
    if (step === 6) return { ok: true };
    // Step 7: Synthesis - always valid
    if (step === 7) return { ok: true };
    // Step 8: Final report - always valid
    if (step === 8) return { ok: true };

    return { ok: true };
  }

  /** =============== UI render =============== **/
  const STEPS = [
    { title: 'Identificación', hint: 'Complete los campos para iniciar.' },
    { title: 'Contexto/Antecedentes', hint: 'Motivo y evaluación previa.' },
    { title: 'DQ5 Actividad', hint: 'Observación en actividad (5 min, 20 intervalos).' },
    { title: 'DQ5 Reposo', hint: 'Observación en reposo (5 min, 20 intervalos).' },
    { title: 'Frecuencia de Babeo', hint: 'Escala 0-15 por actividad diaria.' },
    { title: 'Thomas‑Stonell', hint: 'Respaldo clínico (no visible en informe).' },
    { title: 'DIS', hint: 'Impacto funcional (1-10 por ítem, 10 ítems).' },
    { title: 'Síntesis', hint: 'Clasificación automática e interpretación.' },
    { title: 'Informe Final', hint: 'Texto narrativo editable y exportable.' }
  ];

  function renderStepsNav() {
    const nav = $('#stepsNav');
    nav.innerHTML = '';
    const data = state.active?.data || defaultEvaluation().data;

    STEPS.forEach((s, i) => {
      const v = stepValid(i, data);
      const done = v.ok && (i < state.step); // completed when passed and earlier
      const el = document.createElement('div');
      el.className = 'step' + (i === state.step ? ' step-active' : '') + (done ? ' step-done' : '') + (!v.ok && i < state.step ? ' step-bad' : '');
      el.innerHTML = `
        <div class="step-num">${i}</div>
        <div>
          <div class="step-title">${s.title}</div>
          <div class="step-sub">${done ? 'Completado' : (i === state.step ? 'En curso' : 'Pendiente')}</div>
        </div>
      `;
      el.addEventListener('click', () => {
        if (state.mode === 'rapido') {
          state.step = i;
          renderAll();
        } else {
          // modo completo: solo permitir ir hacia atrás o al mismo
          if (i <= state.step) {
            state.step = i;
            renderAll();
          } else {
            toast('Modo completo: avanza con “Siguiente”.');
          }
        }
      });
      nav.appendChild(el);
    });
  }

  function setHeader() {
    $('#stepKicker').textContent = `Sección ${state.step} —`;
    $('#stepTitle').textContent = STEPS[state.step].title;
    $('#stepHint').textContent = STEPS[state.step].hint;

    const data = state.active?.data || defaultEvaluation().data;
    const v = stepValid(state.step, data);
    $('#stepStatus').textContent = v.ok ? '✔ Sección válida' : `⚠ ${v.msg}`;
  }

  function inputField({ label, value, onInput, type = 'text', placeholder = '', min = null, max = null }) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = `<span class="field-label">${label}</span>`;
    const inp = document.createElement('input');
    inp.type = type;
    inp.value = value ?? '';
    inp.placeholder = placeholder;
    if (min !== null) inp.min = min;
    if (max !== null) inp.max = max;
    inp.addEventListener('input', e => onInput(e.target.value));
    wrap.appendChild(inp);
    return wrap;
  }

  function textareaField({ label, value, onInput, placeholder = '', rows = 3 }) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = `<span class="field-label">${label}</span>`;
    const ta = document.createElement('textarea');
    ta.rows = rows;
    ta.value = value ?? '';
    ta.placeholder = placeholder;
    ta.addEventListener('input', e => onInput(e.target.value));
    wrap.appendChild(ta);
    return wrap;
  }

  function selectField({ label, value, onChange, options }) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = `<span class="field-label">${label}</span>`;
    const sel = document.createElement('select');
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener('change', e => onChange(e.target.value));
    wrap.appendChild(sel);
    return wrap;
  }

  function checkboxRow(items) {
    const div = document.createElement('div');
    div.className = 'stack';
    items.forEach(({ key, label, checked, onChange }) => {
      const row = document.createElement('label');
      row.className = 'pill';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      row.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /> <span>${label}</span>`;
      const cb = $('input', row);
      cb.addEventListener('change', () => onChange(cb.checked));
      div.appendChild(row);
    });
    return div;
  }

  function renderStepBody() {
    const body = $('#stageBody');
    body.innerHTML = '';
    const evalData = state.active.data;

    // Step 0
    if (state.step === 0) {
      const grid = document.createElement('div');
      grid.className = 'grid2';

      grid.appendChild(inputField({
        label: 'Nombre/Iniciales del usuario',
        value: evalData.nombrePaciente,
        placeholder: 'Ej: J.P. / NN',
        onInput: (v) => { evalData.nombrePaciente = v; markDirty(); }
      }));
      grid.appendChild(inputField({
        label: 'ID/Ficha',
        value: evalData.idFicha,
        placeholder: 'Ej: 12345',
        onInput: (v) => { evalData.idFicha = v; markDirty(); }
      }));
      grid.appendChild(inputField({
        label: 'Fecha de evaluación *',
        type: 'date',
        value: evalData.fechaEvaluacion,
        onInput: (v) => { evalData.fechaEvaluacion = v; markDirty(); }
      }));

      const ageWrap = document.createElement('div');
      ageWrap.className = 'grid2';
      ageWrap.style.gridColumn = 'span 1';
      ageWrap.appendChild(inputField({
        label: 'Edad (años) *',
        type: 'text',
        value: evalData.edadAnios,
        placeholder: 'Ej: 6 / NN',
        onInput: (v) => { evalData.edadAnios = v; markDirty(); }
      }));
      ageWrap.appendChild(inputField({
        label: 'Meses (0–11)',
        type: 'number',
        min: 0, max: 11,
        value: evalData.edadMeses,
        onInput: (v) => { evalData.edadMeses = clamp(v, 0, 11); markDirty(); }
      }));
      grid.appendChild(ageWrap);

      body.appendChild(grid);

      body.appendChild(textareaField({
        label: 'Diagnóstico médico de base',
        value: evalData.diagnosticoBase,
        rows: 2,
        placeholder: 'Texto libre',
        onInput: (v) => { evalData.diagnosticoBase = v; markDirty(); }
      }));

      body.appendChild(selectField({
        label: 'Contexto de evaluación',
        value: evalData.contextoEvaluacion,
        onChange: (v) => { evalData.contextoEvaluacion = v; markDirty(); },
        options: [
          { value: 'clinico', label: 'Clínico' },
          { value: 'educacional', label: 'Educacional' },
          { value: 'domiciliario', label: 'Domiciliario' },
          { value: 'otro', label: 'Otro' }
        ]
      }));

      body.appendChild(inputField({
        label: 'Evaluador/a',
        value: evalData.evaluador,
        placeholder: 'Nombre del profesional',
        onInput: (v) => { evalData.evaluador = v; markDirty(); }
      }));

      body.appendChild(textareaField({
        label: 'Observaciones generales',
        value: evalData.observacionesGenerales,
        rows: 3,
        placeholder: 'Contexto, postura, factores relevantes',
        onInput: (v) => { evalData.observacionesGenerales = v; markDirty(); }
      }));

      return;
    }

    // Step 1: Context / Antecedentes
    if (state.step === 1) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-title">Contexto y Antecedentes</div>
        <p class="muted">Registre información sobre evaluaciones previas y motivo de la actual.</p>
      `;
      body.appendChild(card);

      body.appendChild(inputField({
        label: 'Motivo de la evaluación',
        value: evalData.motivoEvaluacion || '',
        placeholder: 'Ej: control, nueva consulta, seguimiento post-tratamiento',
        onInput: (v) => { evalData.motivoEvaluacion = v; markDirty(); }
      }));

      // Initialize evaluacionAnterior if not exists
      if (!evalData.evaluacionAnterior) {
        evalData.evaluacionAnterior = { fecha: '', tiempoTranscurrido: '', resultadosPrevios: '' };
      }

      const grid = document.createElement('div');
      grid.className = 'grid2';
      grid.appendChild(inputField({
        label: 'Fecha evaluación anterior',
        type: 'date',
        value: evalData.evaluacionAnterior.fecha || '',
        onInput: (v) => { evalData.evaluacionAnterior.fecha = v; markDirty(); }
      }));
      grid.appendChild(inputField({
        label: 'Tiempo transcurrido',
        value: evalData.evaluacionAnterior.tiempoTranscurrido || '',
        placeholder: 'Ej: 6 meses, 1 año',
        onInput: (v) => { evalData.evaluacionAnterior.tiempoTranscurrido = v; markDirty(); }
      }));
      body.appendChild(grid);

      body.appendChild(textareaField({
        label: 'Resultados previos (resumen)',
        value: evalData.evaluacionAnterior.resultadosPrevios || '',
        rows: 4,
        placeholder: 'Describa brevemente los resultados de la evaluación anterior si aplica',
        onInput: (v) => { evalData.evaluacionAnterior.resultadosPrevios = v; markDirty(); }
      }));

      return;
    }

    // Step 2: DQ5 Actividad
    if (state.step === 2) {
      // Initialize dq5Actividad if not exists
      if (!evalData.dq5Actividad) {
        evalData.dq5Actividad = { intervalos: Array(20).fill(0), contexto: '', condiciones: {}, patronObservado: {} };
      }
      if (!evalData.dq5Actividad.intervalos) evalData.dq5Actividad.intervalos = Array(20).fill(0);

      const dq = calcDQ5Single(evalData.dq5Actividad.intervalos);

      const cardInfo = document.createElement('div');
      cardInfo.className = 'card';
      cardInfo.innerHTML = `
        <div class="card-title">DQ5 — En Actividad</div>
        <p class="muted">
          Observe <strong>5 minutos</strong> mientras el usuario realiza una actividad.
          Registre cada <strong>15 s</strong> (20 intervalos):
          <strong>0</strong> = sin escape visible; <strong>1</strong> = escape visible.
        </p>
      `;
      body.appendChild(cardInfo);

      body.appendChild(inputField({
        label: 'Contexto de actividad',
        value: evalData.dq5Actividad.contexto || '',
        placeholder: 'Ej: jugando con bloques, dibujando, conversando',
        onInput: (v) => { evalData.dq5Actividad.contexto = v; markDirty(); }
      }));

      const pills = document.createElement('div');
      pills.className = 'pills';
      pills.innerHTML = `
        <div class="pill ok">Escapes: <strong>${dq.nEscape}/20</strong></div>
        <div class="pill ok">DQ5%: <strong>${dq.pct}%</strong></div>
      `;
      body.appendChild(pills);

      // Grid intervals
      const grid = document.createElement('div');
      grid.className = 'dq-grid';
      evalData.dq5Actividad.intervalos.forEach((v, i) => {
        const it = document.createElement('div');
        it.className = 'interval';
        it.innerHTML = `
          <small>Int ${i + 1}</small>
          <div class="toggle">
            <button class="tbtn ${v === 0 ? 'on0' : ''}" data-mode="actividad" data-i="${i}" data-v="0">0</button>
            <button class="tbtn ${v === 1 ? 'on1' : ''}" data-mode="actividad" data-i="${i}" data-v="1">1</button>
          </div>
        `;
        grid.appendChild(it);
      });
      body.appendChild(grid);

      // Wire toggle buttons
      $$('.tbtn', body).forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.i);
          const v = Number(btn.dataset.v);
          evalData.dq5Actividad.intervalos[i] = v;
          markDirty();
          renderAll(false);
        });
      });

      return;
    }

    // Step 3: DQ5 Reposo
    if (state.step === 3) {
      // Initialize dq5Reposo if not exists
      if (!evalData.dq5Reposo) {
        evalData.dq5Reposo = { intervalos: Array(20).fill(0), contexto: '', condiciones: {}, patronObservado: {} };
      }
      if (!evalData.dq5Reposo.intervalos) evalData.dq5Reposo.intervalos = Array(20).fill(0);

      const dq = calcDQ5Single(evalData.dq5Reposo.intervalos);
      const dqDual = calcDQ5Dual(evalData);

      const cardInfo = document.createElement('div');
      cardInfo.className = 'card';
      cardInfo.innerHTML = `
        <div class="card-title">DQ5 — En Reposo</div>
        <p class="muted">
          Observe <strong>5 minutos</strong> mientras el usuario está en reposo.
          Registre cada <strong>15 s</strong> (20 intervalos):
          <strong>0</strong> = sin escape visible; <strong>1</strong> = escape visible.
        </p>
      `;
      body.appendChild(cardInfo);

      body.appendChild(inputField({
        label: 'Contexto de reposo',
        value: evalData.dq5Reposo.contexto || '',
        placeholder: 'Ej: mirando TV, sentado tranquilo, descansando',
        onInput: (v) => { evalData.dq5Reposo.contexto = v; markDirty(); }
      }));

      const pills = document.createElement('div');
      pills.className = 'pills';
      pills.innerHTML = `
        <div class="pill ok">Escapes: <strong>${dq.nEscape}/20</strong></div>
        <div class="pill ok">DQ5% Reposo: <strong>${dq.pct}%</strong></div>
        <div class="pill warn">TOTAL (promedio): <strong>${dqDual.promedio}%</strong></div>
      `;
      body.appendChild(pills);

      // Grid intervals
      const grid = document.createElement('div');
      grid.className = 'dq-grid';
      evalData.dq5Reposo.intervalos.forEach((v, i) => {
        const it = document.createElement('div');
        it.className = 'interval';
        it.innerHTML = `
          <small>Int ${i + 1}</small>
          <div class="toggle">
            <button class="tbtn ${v === 0 ? 'on0' : ''}" data-mode="reposo" data-i="${i}" data-v="0">0</button>
            <button class="tbtn ${v === 1 ? 'on1' : ''}" data-mode="reposo" data-i="${i}" data-v="1">1</button>
          </div>
        `;
        grid.appendChild(it);
      });
      body.appendChild(grid);

      // Summary card
      const summaryCard = document.createElement('div');
      summaryCard.className = 'card';
      summaryCard.innerHTML = `
        <div class="card-title">Resumen DQ5</div>
        <p><strong>Actividad:</strong> ${dqDual.actividad.pct}% (${dqDual.contextoActividad || 'sin contexto'})</p>
        <p><strong>Reposo:</strong> ${dqDual.reposo.pct}% (${dqDual.contextoReposo || 'sin contexto'})</p>
        <p><strong>TOTAL:</strong> ${dqDual.promedio}% — ${dqDual.cat}</p>
      `;
      body.appendChild(summaryCard);

      // Wire toggle buttons
      $$('.tbtn', body).forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.i);
          const v = Number(btn.dataset.v);
          evalData.dq5Reposo.intervalos[i] = v;
          markDirty();
          renderAll(false);
        });
      });

      return;
    }

    // Step 4: Frecuencia de Babeo
    if (state.step === 4) {
      // Initialize frecuenciaBabeo if not exists
      if (!evalData.frecuenciaBabeo) {
        evalData.frecuenciaBabeo = { sentado: 0, enPie: 0, enCama: 0, hablando: 0, comerBeber: 0 };
      }

      const fb = calcFrecuenciaBabeo(evalData);

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-title">Escala de Frecuencia de Babeo (Drooling Rating Scale)</div>
        <p class="muted">Evalúe cada actividad con escala 0-3:</p>
        <ul class="muted small" style="margin: 8px 0; padding-left: 20px;">
          <li><strong>0:</strong> Sequedad / sin exceso</li>
          <li><strong>1:</strong> Exceso de saliva sin babeo</li>
          <li><strong>2:</strong> Babeo leve-moderado (limpieza ocasional)</li>
          <li><strong>3:</strong> Babeo continuo, ropa mojada / uso de pañuelo</li>
        </ul>
      `;
      body.appendChild(card);

      const activities = [
        { key: 'sentado', label: 'Sentado' },
        { key: 'enPie', label: 'En pie' },
        { key: 'enCama', label: 'En cama' },
        { key: 'hablando', label: 'Hablando' },
        { key: 'comerBeber', label: 'Comer y beber' }
      ];

      const table = document.createElement('table');
      table.className = 'table';
      table.innerHTML = '<thead><tr><th>Actividad</th><th>0</th><th>1</th><th>2</th><th>3</th></tr></thead>';
      const tbody = document.createElement('tbody');

      activities.forEach(act => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${act.label}</td>`;
        for (let score = 0; score <= 3; score++) {
          const td = document.createElement('td');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `fb_${act.key}`;
          radio.value = score;
          radio.checked = (evalData.frecuenciaBabeo[act.key] || 0) === score;
          radio.addEventListener('change', () => {
            evalData.frecuenciaBabeo[act.key] = score;
            markDirty();
            renderAll(false);
          });
          td.appendChild(radio);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);

      const pills = document.createElement('div');
      pills.className = 'pills';
      pills.innerHTML = `
        <div class="pill ${fb.total >= 10 ? 'bad' : (fb.total >= 5 ? 'warn' : 'ok')}">
          Puntaje Total: <strong>${fb.total}/15</strong>
        </div>
      `;
      body.appendChild(pills);

      const descCard = document.createElement('div');
      descCard.className = 'callout callout-info';
      descCard.innerHTML = `
        <div class="callout-title">Descripción para informe</div>
        <div class="callout-body">${escapeHtml(fb.texto)}</div>
      `;
      body.appendChild(descCard);

      return;
    }

    // Step 5: Thomas-Stonell (Clinical backup - not shown in main report)
    if (state.step === 5) {
      const th = calcThomas(evalData);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-title">Thomas‑Stonell & Greenberg — Respaldo Clínico</div>
        <p class="muted">Escala de respaldo. <strong>No se muestra como tabla en el informe final</strong>, solo como referencia clínica.</p>
      `;
      body.appendChild(card);

      const grid = document.createElement('div');
      grid.className = 'grid2';

      const sev = selectField({
        label: 'Severidad (1–5)',
        value: String(evalData.severidad),
        onChange: (v) => { evalData.severidad = Number(v); markDirty(); renderAll(false); },
        options: [
          { value: '1', label: '1 — Seco (sin babeo)' },
          { value: '2', label: '2 — Solo labios húmedos' },
          { value: '3', label: '3 — Labios y mentón húmedos' },
          { value: '4', label: '4 — Ropa húmeda' },
          { value: '5', label: '5 — Ropa empapada, requiere cambio frecuente' }
        ]
      });

      const fr = selectField({
        label: 'Frecuencia (1–4)',
        value: String(evalData.frecuencia),
        onChange: (v) => { evalData.frecuencia = Number(v); markDirty(); renderAll(false); },
        options: [
          { value: '1', label: '1 — Nunca babea' },
          { value: '2', label: '2 — Ocasional (no diario)' },
          { value: '3', label: '3 — Frecuente (diario)' },
          { value: '4', label: '4 — Constante (casi siempre)' }
        ]
      });

      grid.appendChild(sev);
      grid.appendChild(fr);
      body.appendChild(grid);

      const pills = document.createElement('div');
      pills.className = 'pills';
      pills.innerHTML = `
        <div class="pill ok">Severidad: <strong>${th.sevCat}</strong></div>
        <div class="pill ok">Frecuencia: <strong>${th.frCat}</strong></div>
      `;
      body.appendChild(pills);

      const note = document.createElement('div');
      note.className = 'callout callout-warn';
      note.innerHTML = `
        <div class="callout-title">Nota</div>
        <div class="callout-body">Esta escala se usa como respaldo clínico. No aparece como tabla en el informe final.</div>
      `;
      body.appendChild(note);

      return;
    }

    // Step 6: DIS (Drooling Impact Scale)
    if (state.step === 6) {
      // Ensure 10 DIS items with 1-10 scale
      if (!Array.isArray(evalData.disItems)) evalData.disItems = Array(10).fill(1);
      while (evalData.disItems.length < 10) evalData.disItems.push(1);
      if (evalData.disItems.length > 10) evalData.disItems = evalData.disItems.slice(0, 10);

      const di = calcDIS(evalData);

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-title">Drooling Impact Scale (DIS) — Escala de Impacto de Sialorrea</div>
        <p class="muted">Escala <strong>1-10</strong> por ítem (1 = sin impacto, 10 = impacto máximo). Total máximo: 100 puntos.</p>
      `;
      body.appendChild(card);

      // Official 10 DIS items
      const disItemLabels = [
        'Impacto en higiene personal',
        'Necesidad de cambiar ropa/babero',
        'Irritación de piel/dermatitis perioral',
        'Interferencia en alimentación',
        'Interferencia en habla/comunicación',
        'Impacto en interacción social',
        'Molestia para el usuario',
        'Carga para cuidadores/familia',
        'Limitación en participación escolar/comunitaria',
        'Dificultad en manejo diario (toallas, limpieza, etc.)'
      ];

      const table = document.createElement('table');
      table.className = 'table';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr><th>Ítem</th><th style="width:140px">Puntaje (1–10)</th></tr>`;
      table.appendChild(thead);
      const tb = document.createElement('tbody');

      disItemLabels.forEach((txt, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(txt)}</td>
          <td>
            <input type="number" min="1" max="10" step="1" value="${Number(evalData.disItems[i] || 1)}" data-dis="${i}" />
          </td>
        `;
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      body.appendChild(table);

      const pills = document.createElement('div');
      pills.className = 'pills';
      pills.innerHTML = `
        <div class="pill ok">Total: <strong>${di.total}</strong> de 100</div>
        <div class="pill ok">Porcentaje: <strong>${di.pct}%</strong></div>
        <div class="pill ${di.cat === 'Impacto severo' ? 'bad' : (di.cat === 'Impacto moderado' ? 'warn' : 'ok')}">${di.cat}</div>
      `;
      body.appendChild(pills);

      // Progress bar
      const bar = document.createElement('div');
      bar.className = 'card';
      bar.innerHTML = `
        <div class="card-title">Impacto visual</div>
        <div class="bar"><div style="width:${di.pct}%"></div></div>
      `;
      body.appendChild(bar);

      // Handlers
      $$('input[data-dis]', body).forEach(inp => {
        inp.addEventListener('input', () => {
          const idx = Number(inp.dataset.dis);
          evalData.disItems[idx] = clamp(inp.value, 1, 10);
          markDirty();
          renderAll(false);
        });
      });

      return;
    }

    // Step 7: Síntesis (Classification and Interpretation)
    if (state.step === 7) {
      const impact = classifyImpact(evalData);
      const dqDual = calcDQ5Dual(evalData);
      const fb = calcFrecuenciaBabeo(evalData);
      const dis = calcDIS(evalData);
      const th = calcThomas(evalData);

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-title">Síntesis Clínica</div>
        <p class="muted">Clasificación automática basada en los instrumentos aplicados.</p>
      `;
      body.appendChild(card);

      // Impact classification pill
      const impactPill = document.createElement('div');
      impactPill.className = 'pills';
      impactPill.innerHTML = `
        <div class="pill ${impact.level === 'ALTO' ? 'bad' : (impact.level === 'MODERADO' ? 'warn' : 'ok')}">
          Nivel de Impacto: <strong>${impact.level}</strong>
        </div>
        ${impact.isHighImpact ? '<div class="pill bad"><strong>⚠ ALTO IMPACTO</strong></div>' : ''}
        ${impact.hasWorsened ? '<div class="pill warn"><strong>⚠ EMPEORAMIENTO DETECTADO</strong></div>' : ''}
      `;
      body.appendChild(impactPill);

      // Summary table
      const table = document.createElement('table');
      table.className = 'table';
      table.innerHTML = `
        <thead><tr><th>Instrumento</th><th>Resultado</th></tr></thead>
        <tbody>
          <tr><td>DQ5 Actividad</td><td>${dqDual.actividad.pct}% (${dqDual.contextoActividad || 'sin contexto'})</td></tr>
          <tr><td>DQ5 Reposo</td><td>${dqDual.reposo.pct}% (${dqDual.contextoReposo || 'sin contexto'})</td></tr>
          <tr><td>DQ5 TOTAL</td><td><strong>${dqDual.promedio}%</strong></td></tr>
          <tr><td>Frecuencia de Babeo</td><td>${fb.total}/15</td></tr>
          <tr><td>DIS (Impacto)</td><td>${dis.total}/100 (${dis.pct}%)</td></tr>
          <tr><td>Thomas-Stonell (respaldo)</td><td>Sev: ${th.sevCat}, Frec: ${th.frCat}</td></tr>
        </tbody>
      `;
      body.appendChild(table);

      // High impact detection rules
      const rulesCard = document.createElement('div');
      rulesCard.className = 'callout ' + (impact.isHighImpact ? 'callout-warn' : 'callout-info');
      const rules = [
        `Frecuencia de babeo: ${fb.total}/15 ${fb.total === 15 ? '✓' : '✗'}`,
        `DIS ≥ 70%: ${dis.pct}% ${dis.pct >= 70 ? '✓' : '✗'}`,
        `DQ5 promedio ≥ 60%: ${dqDual.promedio}% ${dqDual.promedio >= 60 ? '✓' : '✗'}`
      ];
      rulesCard.innerHTML = `
        <div class="callout-title">Criterios de ALTO IMPACTO</div>
        <div class="callout-body">
          <ul style="margin: 0; padding-left: 20px;">
            ${rules.map(r => `<li>${r}</li>`).join('')}
          </ul>
          <p><strong>Resultado:</strong> ${impact.isHighImpact ? 'Cumple todos los criterios → ALTO IMPACTO' : 'No cumple todos los criterios'}</p>
        </div>
      `;
      body.appendChild(rulesCard);

      // Clinical notes
      body.appendChild(textareaField({
        label: 'Notas clínicas adicionales para síntesis',
        value: evalData.comentarioIntegracion || '',
        rows: 4,
        placeholder: 'Observaciones clínicas, contexto relevante, evolución respecto a evaluación previa...',
        onInput: (v) => { evalData.comentarioIntegracion = v; markDirty(); }
      }));

      return;
    }

    // Step 8: Informe Final (Editable Narrative Report)
    if (state.step === 8) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-title">Informe Final — Texto Narrativo Editable</div>
        <p class="muted">Revise y edite el informe antes de exportar. El formato sigue el estándar fonoaudiológico.</p>
      `;
      body.appendChild(card);

      // Generate report if not exists
      if (!evalData.informeEditable || !evalData.informeEditable.trim()) {
        evalData.informeEditable = buildNarrativeReport(evalData);
      }

      const ta = textareaField({
        label: 'Informe (editable)',
        value: evalData.informeEditable,
        rows: 20,
        onInput: (v) => { evalData.informeEditable = v; markDirty(); }
      });
      body.appendChild(ta);

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.innerHTML = `
        <button class="btn btn-ghost" id="btnRegenReport" type="button">Regenerar</button>
        <button class="btn" id="btnCopyReport2" type="button">Copiar</button>
      `;
      body.appendChild(actions);

      $('#btnRegenReport', body).addEventListener('click', () => {
        evalData.informeEditable = buildNarrativeReport(evalData);
        markDirty();
        renderAll(false);
        toast('Informe regenerado');
      });
      $('#btnCopyReport2', body).addEventListener('click', async () => {
        await navigator.clipboard.writeText(evalData.informeEditable || '');
        toast('Informe copiado al portapapeles');
      });

      return;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** =============== Report building & exports =============== **/
  function labelContext(v) {
    const map = { clinico: 'Clínico', educacional: 'Educacional', domiciliario: 'Domiciliario', otro: 'Otro' };
    return map[v] || String(v || '');
  }

  /** =============== Narrative Report Generator (New Format) =============== **/
  function buildNarrativeReport(data) {
    const dqDual = calcDQ5Dual(data);
    const fb = calcFrecuenciaBabeo(data);
    const dis = calcDIS(data);
    const impact = classifyImpact(data);

    // Context
    const motivo = data.motivoEvaluacion || 'control';
    const tiempoAnterior = data.evaluacionAnterior?.tiempoTranscurrido || '[tiempo no especificado]';
    const resultadosPrevios = data.evaluacionAnterior?.resultadosPrevios || '[sin información previa]';

    // Impact level text
    let impactText = 'bajo impacto';
    if (impact.level === 'ALTO') impactText = 'alto impacto';
    else if (impact.level === 'MODERADO') impactText = 'moderado impacto';

    // Evolution text
    let evolucionText = 'estable';
    if (resultadosPrevios.toLowerCase().includes('mejor')) evolucionText = 'favorable';
    else if (resultadosPrevios.toLowerCase().includes('peor') || resultadosPrevios.toLowerCase().includes('empeor')) evolucionText = 'desfavorable';

    // Recommendations based on impact
    let recomendacion = 'mantener seguimiento y reevaluación periódica';
    if (impact.isHighImpact) {
      recomendacion = 'intervención fonoaudiológica intensiva con manejo interdisciplinario';
    } else if (impact.level === 'MODERADO') {
      recomendacion = 'intervención fonoaudiológica con enfoque en control salival';
    }

    const lines = [
      'EVALUACIÓN FONOAUDIOLÓGICA',
      '',
      'Contexto y antecedentes:',
      '',
      `Se repite evaluación fonoaudiológica de sialorrea para ${motivo}. Evaluación anterior de hace ${tiempoAnterior}, contemplaba ${resultadosPrevios}.`,
      '',
      'Escala de frecuencia de babeo',
      '',
      `${fb.total}/15 puntos.`,
      `El/la usuario/a presenta ${fb.texto}.`,
      '',
      'Escala de impacto de sialorrea',
      '',
      `${dis.total} de 100`,
      `${dis.pct}% de impacto`,
      '',
      "DQ 5'",
      '',
      `${dqDual.actividad.pct}% de salivas nuevas en actividad (${dqDual.contextoActividad || 'sin especificar'}, ${dqDual.actividad.nEscape} salivas nuevas).`,
      `${dqDual.reposo.pct}% de salivas nuevas en reposo (${dqDual.contextoReposo || 'sin especificar'}, ${dqDual.reposo.nEscape} salivas nuevas).`,
      `TOTAL: ${dqDual.promedio}%`,
      '',
      'En síntesis,',
      '',
      `Usuario con ${impactText} en la vida cotidiana producto de la sialorrea, con evolución ${evolucionText} en el transcurso del tiempo, impactando de manera física y social tanto en el usuario como en su familia. Se sugiere ${recomendacion}.`,
      '',
      'Indicaciones y acuerdos',
      '',
      `Se sugiere ${recomendacion}.`,
      '',
      `Ingreso a FA posterior a evaluación.`
    ];

    return lines.join('\n');
  }

  function mapObjectives(obj) {
    const labels = {
      selladoLabial: '• Mejorar competencia de sellado labial',
      aumentoDeglusion: '• Aumentar frecuencia de deglución espontánea',
      concienciaSensorial: '• Desarrollar conciencia sensorial oral',
      manejoPostural: '• Optimizar manejo postural y estabilidad proximal',
      entrenamientoCuidadores: '• Capacitar a cuidadores en estrategias de manejo'
    };
    return Object.entries(obj || {}).filter(([, v]) => v).map(([k]) => labels[k]).filter(Boolean);
  }

  function buildReportText(data) {
    if (data.informeEditable && data.informeEditable.trim()) {
      return data.informeEditable;
    }
    return buildNarrativeReport(data);
  }

  function prettyKey(k) {
    const map = {
      vigilia: 'Vigilia',
      sedente: 'Sedente',
      sinIngesta: 'Sin ingesta',
      actividadBasal: 'Actividad basal',
      escapeAnterior: 'Escape anterior',
      posturaAbierta: 'Postura oral abierta',
      bajaDeglusion: 'Baja deglución espontánea',
      hipotonia: 'Hipotonía orofacial aparente',
      otro: 'Otro'
    };
    return map[k] || k;
  }

  function capitalize(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

  function exportJSON() {
    const data = state.active.data;
    const payload = {
      meta: {
        app: 'Gran Test Integrado de Control Salival',
        version: 'v2',
        exportedAt: new Date().toISOString()
      },
      config: state.cfg,
      evaluation: state.active
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filenameBase(data) + '.json');
  }

  function exportCSV() {
    const d = state.active.data;
    const dqDual = calcDQ5Dual(d);
    const fb = calcFrecuenciaBabeo(d);
    const di = calcDIS(d);
    const impact = classifyImpact(d);

    const rows = [];
    rows.push(['campo', 'valor']);
    rows.push(['nombre', (d.nombrePaciente || 'NN')]);
    rows.push(['id_ficha', (d.idFicha || 'NN')]);
    rows.push(['fecha', d.fechaEvaluacion || '']);
    rows.push(['edad_anios', d.edadAnios || '']);
    rows.push(['edad_meses', d.edadMeses || '']);
    rows.push(['diagnostico_base', (d.diagnosticoBase || '')]);
    rows.push(['contexto', labelContext(d.contextoEvaluacion)]);
    rows.push(['evaluador', (d.evaluador || '')]);

    // Contexto y Antecedentes
    rows.push(['motivo_evaluacion', d.motivoEvaluacion || '']);
    rows.push(['eval_anterior_fecha', d.evaluacionAnterior?.fecha || '']);
    rows.push(['eval_anterior_tiempo', d.evaluacionAnterior?.tiempoTranscurrido || '']);
    rows.push(['eval_anterior_resultados', (d.evaluacionAnterior?.resultadosPrevios || '').replace(/\n/g, '\\n')]);

    // DQ5 Dual
    rows.push(['dq5_actividad_contexto', d.dq5Actividad?.contexto || '']);
    rows.push(['dq5_actividad_pct', dqDual.actividad.pct]);
    rows.push(['dq5_reposo_contexto', d.dq5Reposo?.contexto || '']);
    rows.push(['dq5_reposo_pct', dqDual.reposo.pct]);
    rows.push(['dq5_promedio_total', dqDual.promedio]);
    rows.push(['dq5_categoria', dqDual.cat]);

    // Frecuencia de Babeo
    rows.push(['frecuencia_babeo_total', fb.total]);
    rows.push(['frecuencia_babeo_texto', fb.texto]);
    rows.push(['fb_sentado', d.frecuenciaBabeo?.sentado || 0]);
    rows.push(['fb_enPie', d.frecuenciaBabeo?.enPie || 0]);
    rows.push(['fb_enCama', d.frecuenciaBabeo?.enCama || 0]);
    rows.push(['fb_hablando', d.frecuenciaBabeo?.hablando || 0]);
    rows.push(['fb_comerBeber', d.frecuenciaBabeo?.comerBeber || 0]);

    // Thomas-Stonell (Respaldo)
    rows.push(['thomas_severidad', d.severidad]);
    rows.push(['thomas_frecuencia', d.frecuencia]);

    // DIS
    rows.push(['dis_total', di.total]);
    rows.push(['dis_pct', di.pct]);
    rows.push(['dis_cat', di.cat]);

    // Síntesis
    rows.push(['nivel_impacto', impact.level]);
    rows.push(['es_alto_impacto', impact.isHighImpact]);
    rows.push(['ha_empeorado', impact.hasWorsened]);
    rows.push(['comentario_integracion', (d.comentarioIntegracion || '').replace(/\n/g, '\\n')]);

    // Informe
    rows.push(['informe_narrativo', (d.informeEditable || buildNarrativeReport(d)).replace(/\n/g, '\\n')]);

    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), filenameBase(d) + '.csv');
  }

  function exportPDF() {
    const text = buildReportText(state.active.data);
    const html = `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Reporte — Gran Test Control Salival</title>
        <style>
          body{font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; margin:24px}
          pre{white-space:pre-wrap; font-size:12px; line-height:1.35}
        </style>
      </head>
      <body>
        <pre>${escapeHtml(text)}</pre>
        <script>window.onload=()=>{ setTimeout(()=>window.print(), 100); };</script>
      </body>
      </html>
    `;
    const w = window.open('', '_blank');
    if (!w) { toast('Popup bloqueado. Permite ventanas emergentes para exportar PDF.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function filenameBase(d) {
    const name = (d.nombrePaciente && d.nombrePaciente.trim()) ? d.nombrePaciente.trim().replace(/\s+/g, '_') : 'paciente';
    const date = (d.fechaEvaluacion || todayISO());
    return `gran_test_salival_${name}_${date}`;
  }

  /** =============== Wizard nav & actions =============== **/
  function markDirty() { state._dirty = true; }

  function goNext() {
    const d = state.active.data;
    const v = stepValid(state.step, d);
    if (!v.ok) {
      toast(v.msg);
      return;
    }
    if (state.step < STEPS.length - 1) {
      state.step++;
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function goPrev() {
    if (state.step > 0) {
      state.step--;
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /** =============== DQ timer =============== **/
  function toggleDQTimer() {
    if (state.dqTimer.running) {
      state.dqTimer.running = false;
      clearInterval(state.dqTimer.handle);
      state.dqTimer.handle = null;
      renderAll(false);
      return;
    }
    state.dqTimer.running = true;
    state.dqTimer.handle = setInterval(() => {
      state.dqTimer.seconds += 1;
      if (state.dqTimer.seconds >= 15) {
        state.dqTimer.seconds = 0;
        if (state.dqTimer.intervalIndex < 19) {
          state.dqTimer.intervalIndex += 1;
        } else {
          // stop
          state.dqTimer.running = false;
          clearInterval(state.dqTimer.handle);
          state.dqTimer.handle = null;
          state.dqTimer.intervalIndex = 0;
          state.dqTimer.seconds = 0;
          toast('Cronómetro DQ5 finalizado');
        }
      }
      // update timer UI if currently on step 1
      if (state.step === 1) renderAll(false);
    }, 1000);
    renderAll(false);
  }

  function resetDQTimer(clearIntervals) {
    state.dqTimer.running = false;
    clearInterval(state.dqTimer.handle);
    state.dqTimer.handle = null;
    state.dqTimer.intervalIndex = 0;
    state.dqTimer.seconds = 0;
    if (clearIntervals && state.active?.data?.intervalos) {
      state.active.data.intervalos = Array(20).fill(0);
      markDirty();
    }
  }

  /** =============== Config drawer =============== **/
  function openDrawer(which) {
    if (which === 'config') {
      $('#configBackdrop').classList.remove('hidden');
      $('#configDrawer').classList.remove('hidden');
      renderConfig();
    }
    if (which === 'review') {
      $('#reviewBackdrop').classList.remove('hidden');
      $('#reviewDrawer').classList.remove('hidden');
      renderReview();
    }
  }

  function closeDrawer(which) {
    if (which === 'config') {
      $('#configBackdrop').classList.add('hidden');
      $('#configDrawer').classList.add('hidden');
    }
    if (which === 'review') {
      $('#reviewBackdrop').classList.add('hidden');
      $('#reviewDrawer').classList.add('hidden');
    }
  }

  function renderConfig() {
    const list = $('#disConfigList');
    list.innerHTML = '';

    state.cfg.disItems.forEach((txt, i) => {
      const row = document.createElement('div');
      row.className = 'grid2';
      row.innerHTML = `
        <label class="field" style="grid-column: span 2">
          <span class="field-label">Ítem ${i + 1}</span>
          <input type="text" value="${escapeHtml(txt)}" data-dis-txt="${i}">
        </label>
      `;
      list.appendChild(row);
    });

    $('#cfg_dq5_low').value = state.cfg.dq5Bands.low;
    $('#cfg_dq5_mild').value = state.cfg.dq5Bands.mild;
    $('#cfg_dq5_mod').value = state.cfg.dq5Bands.mod;
    $('#cfg_dis_low').value = state.cfg.disBands.low;
    $('#cfg_dis_mod').value = state.cfg.disBands.mod;

    $$('input[data-dis-txt]').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.disTxt);
        state.cfg.disItems[i] = inp.value;
      });
    });
  }

  function applyConfigToActive() {
    // ensure DIS values length matches config
    const d = state.active.data;
    const n = state.cfg.disItems.length;
    if (!Array.isArray(d.disItems)) d.disItems = [];
    while (d.disItems.length < n) d.disItems.push(0);
    if (d.disItems.length > n) d.disItems = d.disItems.slice(0, n);
  }

  /** =============== Review drawer =============== **/
  function renderReview() {
    const d = state.active.data;
    const dqDual = calcDQ5Dual(d);
    const fb = calcFrecuenciaBabeo(d);
    const di = calcDIS(d);
    const impact = classifyImpact(d);

    const content = $('#reviewContent');
    const checklist = STEPS.map((s, i) => {
      const v = stepValid(i, d);
      return `<li class="${v.ok ? 'ok' : 'bad'}"><strong>Etapa ${i}:</strong> ${escapeHtml(s.title)} — ${v.ok ? 'OK' : escapeHtml(v.msg || 'Pendiente')}</li>`;
    }).join('');

    const html = `
      <div class="card">
        <div class="card-title">Resumen Clínico</div>
        <div class="pills">
          <span class="pill ok">DQ5 Promedio: <strong>${dqDual.promedio}%</strong></span>
          <span class="pill ok">Frecuencia Babeo: <strong>${fb.total}/15</strong></span>
          <span class="pill ${di.cat === 'Impacto severo' ? 'bad' : (di.cat === 'Impacto moderado' ? 'warn' : 'ok')}">DIS Impacto: <strong>${di.pct}%</strong></span>
          <span class="pill ${impact.isHighImpact ? 'bad' : 'ok'}">Clasificación: <strong>${impact.level} IMPACTO</strong></span>
          ${impact.isHighImpact ? '<span class="pill bad">⚠ ALTO IMPACTO</span>' : ''}
          ${impact.hasWorsened ? '<span class="pill warn">⚠ EMPEORAMIENTO</span>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Estado de evaluación</div>
        <ul style="margin:0; padding-left:18px; color:var(--muted); font-size:0.9rem;">${checklist}</ul>
      </div>

      <div class="card">
        <div class="card-title">Vista previa del informe narrativo</div>
        <div style="background: rgba(0,0,0,0.05); padding: 15px; border-radius: 8px; font-family: monospace; font-size: 0.85rem; white-space: pre-wrap; color: var(--text-muted); line-height: 1.4;">${escapeHtml(d.informeEditable || buildNarrativeReport(d))}</div>
      </div>
    `;
    content.innerHTML = html;
  }

  /** =============== Evaluation list UI =============== **/
  function renderEvalSelect() {
    const sel = $('#evalSelect');
    sel.innerHTML = '';
    if (!state.evals.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(sin evaluaciones)';
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;

    state.evals.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      const date = new Date(e.updatedAt).toLocaleString('es-CL');
      const name = (e.data?.nombrePaciente && e.data.nombrePaciente.trim()) ? e.data.nombrePaciente.trim() : 'NN';
      opt.textContent = `${name} · ${e.data?.fechaEvaluacion || ''} · ${date}`;
      sel.appendChild(opt);
    });
    sel.value = state.activeId || state.evals[0].id;
  }

  function setModeButtons() {
    const c = $('#modeCompleto');
    const r = $('#modeRapido');
    if (state.mode === 'completo') {
      c.classList.add('seg-active');
      r.classList.remove('seg-active');
    } else {
      r.classList.add('seg-active');
      c.classList.remove('seg-active');
    }
  }

  /** =============== Main render =============== **/
  function renderAll(scrollTop = true) {
    if (!state.active) {
      // create a first one
      state.active = defaultEvaluation();
      state.activeId = state.active.id;
      state.evals.unshift(state.active);
      persist();
    }

    applyConfigToActive();
    renderEvalSelect();
    renderStepsNav();
    setHeader();
    setModeButtons();
    renderStepBody();

    // nav buttons state
    $('#btnPrev').disabled = state.step === 0;
    $('#btnNext').textContent = (state.step === STEPS.length - 1) ? 'Finalizar' : 'Siguiente';
    if (state.step === STEPS.length - 1) {
      $('#btnNext').disabled = false;
    } else {
      const v = stepValid(state.step, state.active.data);
      $('#btnNext').disabled = (state.mode === 'completo') ? !v.ok : false;
    }

    // update header status
    const v = stepValid(state.step, state.active.data);
    $('#stepStatus').textContent = v.ok ? '✔ Sección válida' : `⚠ ${v.msg}`;
  }

  /** =============== Actions =============== **/
  function newEvaluation() {
    const e = defaultEvaluation();
    // ensure DIS length matches config
    e.data.disItems = Array(state.cfg.disItems.length).fill(0);
    state.evals.unshift(e);
    state.active = e;
    state.activeId = e.id;
    state.step = 0;
    resetDQTimer(false);
    persist();
    toast('Nueva evaluación creada');
    renderAll();
  }

  function duplicateEvaluation() {
    if (!state.active) return;
    const copy = structuredClone(state.active);
    copy.id = uid();
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    copy.title = 'Copia · ' + (state.active.title || 'Evaluación');
    state.evals.unshift(copy);
    state.active = copy;
    state.activeId = copy.id;
    state.step = 0;
    resetDQTimer(false);
    persist();
    toast('Evaluación duplicada');
    renderAll();
  }

  function saveEvaluation() {
    upsertActive();
    toast('Guardado local');
    renderAll(false);
  }

  function wipeAll() {
    if (!confirm('Esto eliminará TODAS las evaluaciones y configuración local de esta app en este dispositivo. ¿Continuar?')) return;
    localStorage.removeItem(KEY_EVALS);
    localStorage.removeItem(KEY_ACTIVE);
    localStorage.removeItem(KEY_CONFIG);
    localStorage.removeItem(KEY_SW_VER);

    state.cfg = structuredClone(DEFAULT_CONFIG);
    state.evals = [];
    state.active = null;
    state.activeId = null;
    state.step = 0;
    resetDQTimer(true);

    toast('Datos eliminados');
    setTimeout(() => location.reload(), 300);
  }

  function loadDemo() {
    const e = defaultEvaluation();
    e.data.nombrePaciente = 'NN';
    e.data.idFicha = 'DEMO-001';
    e.data.fechaEvaluacion = todayISO();
    e.data.edadAnios = '7';
    e.data.edadMeses = '2';
    e.data.diagnosticoBase = 'Parálisis cerebral (ejemplo)';
    e.data.contextoEvaluacion = 'clinico';
    e.data.evaluador = 'Fonoaudiólogo/a';
    e.data.observacionesGenerales = 'Demo: registro de ejemplo para testeo interno.';
    // DQ5
    e.data.intervalos = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
    // Thomas
    e.data.severidad = 4;
    e.data.frecuencia = 3;
    // DIS
    e.data.disItems = Array(state.cfg.disItems.length).fill(0).map((_, i) => (i % 3 === 0 ? 6 : (i % 3 === 1 ? 4 : 2)));
    // Integration comment (might be required)
    e.data.comentarioIntegracion = 'Demo: impacto moderado con frecuencia objetiva moderada.';
    e.data.etiologiaOrientativa = 'neuromotor';
    e.data.semanasReevaluacion = 10;

    state.evals.unshift(e);
    state.active = e;
    state.activeId = e.id;
    state.step = 0;
    resetDQTimer(false);
    persist();
    toast('Demo cargada');
    renderAll();
  }

  /** =============== Wiring =============== **/
  function wire() {
    $('#btnPrev').addEventListener('click', goPrev);
    $('#btnNext').addEventListener('click', () => {
      if (state.step === STEPS.length - 1) {
        openDrawer('review');
      } else {
        goNext();
      }
    });

    $('#btnNew').addEventListener('click', newEvaluation);
    $('#btnDuplicate').addEventListener('click', duplicateEvaluation);
    $('#btnSave').addEventListener('click', saveEvaluation);

    $('#evalSelect').addEventListener('change', () => {
      const id = $('#evalSelect').value;
      const found = state.evals.find(e => e.id === id);
      if (found) {
        state.active = found;
        state.activeId = id;
        state.step = 0;
        resetDQTimer(false);
        localStorage.setItem(KEY_ACTIVE, id);
        renderAll();
      }
    });

    $('#btnWipe').addEventListener('click', wipeAll);
    $('#btnLoadDemo').addEventListener('click', loadDemo);

    // Mode
    $('#modeCompleto').addEventListener('click', () => {
      state.mode = 'completo';
      if (state.active) state.active.mode = 'completo';
      toast('Modo completo');
      renderAll(false);
    });
    $('#modeRapido').addEventListener('click', () => {
      state.mode = 'rapido';
      if (state.active) state.active.mode = 'rapido';
      toast('Modo rápido');
      renderAll(false);
    });

    // Config
    $('#btnConfig').addEventListener('click', () => openDrawer('config'));
    $('#btnCloseConfig').addEventListener('click', () => closeDrawer('config'));
    $('#configBackdrop').addEventListener('click', () => closeDrawer('config'));

    $('#btnAddDisItem').addEventListener('click', () => {
      state.cfg.disItems.push('Nuevo ítem DIS');
      renderConfig();
    });

    $('#btnSaveConfig').addEventListener('click', () => {
      // bands
      state.cfg.dq5Bands.low = clamp($('#cfg_dq5_low').value, 0, 100);
      state.cfg.dq5Bands.mild = clamp($('#cfg_dq5_mild').value, 0, 100);
      state.cfg.dq5Bands.mod = clamp($('#cfg_dq5_mod').value, 0, 100);
      state.cfg.disBands.low = clamp($('#cfg_dis_low').value, 0, 100);
      state.cfg.disBands.mod = clamp($('#cfg_dis_mod').value, 0, 100);

      // ensure ascending order
      if (!(state.cfg.dq5Bands.low <= state.cfg.dq5Bands.mild && state.cfg.dq5Bands.mild <= state.cfg.dq5Bands.mod)) {
        toast('DQ5: rangos deben ser ascendentes (baja ≤ leve ≤ moderada).');
        return;
      }
      if (!(state.cfg.disBands.low <= state.cfg.disBands.mod)) {
        toast('DIS: rangos deben ser ascendentes (leve ≤ moderado).');
        return;
      }

      saveConfig(state.cfg);
      applyConfigToActive();
      markDirty();
      renderAll(false);
    });

    $('#btnResetConfig').addEventListener('click', () => {
      if (!confirm('Restaurar configuración por defecto (solo local)?')) return;
      state.cfg = structuredClone(DEFAULT_CONFIG);
      saveConfig(state.cfg);
      applyConfigToActive();
      renderAll(false);
    });

    // Review
    $('#btnRevision').addEventListener('click', () => openDrawer('review'));
    $('#btnCloseReview').addEventListener('click', () => closeDrawer('review'));
    $('#reviewBackdrop').addEventListener('click', () => closeDrawer('review'));

    $('#btnCopyReport').addEventListener('click', async () => {
      const text = buildReportText(state.active.data);
      await navigator.clipboard.writeText(text);
      toast('Informe copiado');
    });
    $('#btnExportJSON').addEventListener('click', exportJSON);
    $('#btnExportCSV').addEventListener('click', exportCSV);
    $('#btnExportPDF').addEventListener('click', exportPDF);

    // Auto-save on unload
    window.addEventListener('beforeunload', () => {
      if (state._dirty) upsertActive();
    });
  }

  /** =============== Service worker registration (safe) =============== **/
  async function tryRegisterSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const cur = localStorage.getItem(KEY_SW_VER);
      const ver = 'v3';
      if (cur !== ver) {
        // force unregister old SW on major change to avoid stale cache
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        localStorage.setItem(KEY_SW_VER, ver);
      }
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (e) {
      console.warn('SW registration failed', e);
      // do not block app
    }
  }

  /** =============== Init =============== **/
  function init() {
    loadAll();
    if (!state.evals.length) {
      // create initial empty evaluation
      state.active = defaultEvaluation();
      state.evals.unshift(state.active);
      state.activeId = state.active.id;
      persist();
    }
    if (state.active) {
      state.mode = state.active.mode || 'completo';
    }

    wire();
    renderAll();
    tryRegisterSW();
    toast('App lista');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
