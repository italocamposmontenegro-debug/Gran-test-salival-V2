
(() => {
  'use strict';

  /** =============== Storage keys =============== **/
  const KEY_EVALS = 'gtcs_evaluations_v2';
  const KEY_ACTIVE = 'gtcs_active_id_v2';
  const KEY_CONFIG = 'gtcs_config_v2';
  const KEY_SW_VER = 'gtcs_sw_ver_v2';

  /** =============== Helpers =============== **/
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const uid = () => 'e_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);

  const todayISO = () => new Date().toISOString().slice(0,10);

  function toast(msg){
    const t = $('#toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(()=>t.classList.add('hidden'), 2500);
  }

  function safeParse(json, fallback){
    try { return JSON.parse(json); } catch { return fallback; }
  }

  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clamp(n, min, max){
    n = Number(n);
    if(Number.isNaN(n)) return min;
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

  function loadConfig(){
    const raw = localStorage.getItem(KEY_CONFIG);
    const cfg = raw ? safeParse(raw, null) : null;
    return cfg ? { ...DEFAULT_CONFIG, ...cfg } : structuredClone(DEFAULT_CONFIG);
  }

  function saveConfig(cfg){
    localStorage.setItem(KEY_CONFIG, JSON.stringify(cfg));
    toast('Configuración guardada');
  }

  /** =============== Evaluation template =============== **/
  function defaultEvaluation(){
    return {
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: 'Evaluación ' + new Date().toLocaleString('es-CL'),
      mode: 'completo',
      data: {
        // Sección 0
        nombrePaciente: '',
        idFicha: '',
        fechaEvaluacion: todayISO(),
        edadAnios: '',
        edadMeses: '',
        diagnosticoBase: '',
        contextoEvaluacion: 'clinico',
        evaluador: '',
        observacionesGenerales: '',

        // Sección 1: DQ5
        intervalos: Array(20).fill(0),
        condicionesDQ5: {
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
        },

        // Sección 2: Thomas-Stonell
        severidad: 1,
        frecuencia: 1,

        // Sección 3: DIS
        disItems: Array(10).fill(0),

        // Sección 4: Integración
        comentarioIntegracion: '',

        // Sección 6: Diagnóstico
        etiologiaOrientativa: 'neuromotor',

        // Sección 7: Plan
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
        // editable free notes for plan
        planNotas: ''
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
  function loadAll(){
    const raw = localStorage.getItem(KEY_EVALS);
    state.evals = raw ? safeParse(raw, []) : [];
    state.activeId = localStorage.getItem(KEY_ACTIVE) || (state.evals[0]?.id ?? null);
    if(state.activeId){
      state.active = state.evals.find(e=>e.id===state.activeId) || null;
    }
    if(!state.active && state.evals.length){
      state.active = state.evals[0];
      state.activeId = state.active.id;
      localStorage.setItem(KEY_ACTIVE, state.activeId);
    }
  }

  function persist(){
    localStorage.setItem(KEY_EVALS, JSON.stringify(state.evals));
    if(state.activeId) localStorage.setItem(KEY_ACTIVE, state.activeId);
  }

  function upsertActive(){
    if(!state.active) return;
    state.active.updatedAt = new Date().toISOString();
    const idx = state.evals.findIndex(e=>e.id===state.active.id);
    if(idx>=0) state.evals[idx] = state.active;
    else state.evals.unshift(state.active);
    persist();
  }

  /** =============== Clinical calculations =============== **/
  function calcDQ5(data){
    const nEscape = (data.intervalos || []).reduce((acc,v)=>acc + (v===1?1:0), 0);
    const pct = (nEscape/20)*100;
    const b = state.cfg.dq5Bands;
    let cat;
    if(pct <= b.low) cat = 'Frecuencia baja / dentro de rangos funcionales habituales';
    else if(pct <= b.mild) cat = 'Frecuencia leve';
    else if(pct <= b.mod) cat = 'Frecuencia moderada';
    else cat = 'Frecuencia alta';
    return { nEscape, pct: Number(pct.toFixed(1)), cat };
  }

  function calcThomas(data){
    const sev = Number(data.severidad);
    const fr = Number(data.frecuencia);

    const sevCat = (sev<=2) ? 'Leve' : (sev===3 ? 'Moderada' : 'Severa');

    let frCat = 'Ausente';
    if(fr===2) frCat='Ocasional';
    else if(fr===3) frCat='Frecuente';
    else if(fr===4) frCat='Constante';

    return { sevCat, frCat };
  }

  function calcDIS(data){
    const vals = data.disItems || [];
    const total = vals.reduce((a,b)=>a + Number(b||0), 0);
    const max = state.cfg.disScale.max * (state.cfg.disItems.length);
    const pct = max>0 ? (total / max) * 100 : 0;

    const b = state.cfg.disBands;
    let cat;
    if(pct <= b.low) cat = 'Impacto leve';
    else if(pct <= b.mod) cat = 'Impacto moderado';
    else cat = 'Impacto severo';

    return { total, pct: Number(pct.toFixed(1)), cat, max };
  }

  function analyzeIntegration(data){
    const dq = calcDQ5(data);
    const th = calcThomas(data);
    const di = calcDIS(data);

    const dqHigh = dq.pct > state.cfg.dq5Bands.mod;
    const thHigh = (th.sevCat === 'Severa') || (th.frCat === 'Constante');
    const diHigh = di.cat === 'Impacto severo';

    const nHigh = [dqHigh, thHigh, diHigh].filter(Boolean).length;

    if(nHigh >= 2) return { label: 'Concordante alto', requiresComment:false, code:'concordante_alto' };
    if(!dqHigh && diHigh) return { label: 'Discordante (DQ5 bajo pero DIS alto — posible sesgo contextual)', requiresComment:true, code:'disc_dq5_bajo_dis_alto' };
    if(dqHigh && !diHigh) return { label: 'Discordante (DQ5 alto pero DIS bajo — posible adaptación familiar)', requiresComment:true, code:'disc_dq5_alto_dis_bajo' };
    return { label: 'Concordante', requiresComment:false, code:'concordante' };
  }

  function profileResult(data){
    const dq = calcDQ5(data);
    const th = calcThomas(data);
    const di = calcDIS(data);

    const highFlags = [
      dq.pct > state.cfg.dq5Bands.mod,
      th.sevCat === 'Severa' || th.frCat === 'Constante',
      di.cat === 'Impacto severo'
    ];
    const nHigh = highFlags.filter(Boolean).length;

    if(nHigh >= 2){
      return {
        profile: 'Sialorrea persistente de alto impacto funcional',
        why: `DQ5 ${dq.pct}% (${dq.cat}); Thomas‑Stonell ${th.sevCat}/${th.frCat}; DIS ${di.cat} (${di.pct}%). ≥2 indicadores en rango alto.`
      };
    }
    if(nHigh === 1){
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

  function diagnosisText(data){
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
  function stepValid(step, data){
    if(step===0){
      // fecha obligatoria; edad > 0 o NN permitido (pero aquí pedimos al menos algo)
      if(!data.fechaEvaluacion) return { ok:false, msg:'Falta fecha de evaluación.' };
      const a = String(data.edadAnios ?? '').trim();
      if(!a) return { ok:false, msg:'Falta edad (años) o ingresa "NN".' };
      if(a.toUpperCase() !== 'NN'){
        const n = Number(a);
        if(!(n>0)) return { ok:false, msg:'La edad (años) debe ser > 0 o "NN".' };
      }
      return { ok:true };
    }
    if(step===2){
      if(!(Number(data.severidad)>=1 && Number(data.severidad)<=5)) return { ok:false, msg:'Completa Severidad (Thomas‑Stonell).' };
      if(!(Number(data.frecuencia)>=1 && Number(data.frecuencia)<=4)) return { ok:false, msg:'Completa Frecuencia (Thomas‑Stonell).' };
      return { ok:true };
    }
    if(step===4){
      const integ = analyzeIntegration(data);
      if(integ.requiresComment){
        const c = String(data.comentarioIntegracion||'').trim();
        if(c.length<3) return { ok:false, msg:'Se requiere comentario clínico por discordancia.' };
      }
      return { ok:true };
    }
    return { ok:true };
  }

  /** =============== UI render =============== **/
  const STEPS = [
    { title:'Identificación', hint:'Complete los campos para iniciar.' },
    { title:'DQ5', hint:'Registro 0/1 en 20 intervalos (5 min).' },
    { title:'Thomas‑Stonell', hint:'Severidad (1–5) y Frecuencia (1–4).' },
    { title:'DIS', hint:'Impacto funcional y psicosocial (0–10 por ítem).' },
    { title:'Integración', hint:'Concordancia entre escalas y comentario si hay discordancia.' },
    { title:'Perfil clínico', hint:'Tipificación automática con explicación.' },
    { title:'Diagnóstico', hint:'Texto orientador editable y copiable.' },
    { title:'Plan', hint:'Objetivos y seguimiento sugeridos (editable).' },
    { title:'Reporte final', hint:'Vista previa y exportaciones.' }
  ];

  function renderStepsNav(){
    const nav = $('#stepsNav');
    nav.innerHTML = '';
    const data = state.active?.data || defaultEvaluation().data;

    STEPS.forEach((s, i)=>{
      const v = stepValid(i, data);
      const done = v.ok && (i < state.step); // completed when passed and earlier
      const el = document.createElement('div');
      el.className = 'step' + (i===state.step?' step-active':'') + (done?' step-done':'') + (!v.ok && i<state.step ? ' step-bad':'');
      el.innerHTML = `
        <div class="step-num">${i}</div>
        <div>
          <div class="step-title">${s.title}</div>
          <div class="step-sub">${done?'Completado': (i===state.step?'En curso': 'Pendiente')}</div>
        </div>
      `;
      el.addEventListener('click', ()=>{
        if(state.mode==='rapido'){
          state.step = i;
          renderAll();
        } else {
          // modo completo: solo permitir ir hacia atrás o al mismo
          if(i <= state.step){
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

  function setHeader(){
    $('#stepKicker').textContent = `Sección ${state.step} —`;
    $('#stepTitle').textContent = STEPS[state.step].title;
    $('#stepHint').textContent = STEPS[state.step].hint;

    const data = state.active?.data || defaultEvaluation().data;
    const v = stepValid(state.step, data);
    $('#stepStatus').textContent = v.ok ? '✔ Sección válida' : `⚠ ${v.msg}`;
  }

  function inputField({label, value, onInput, type='text', placeholder='', min=null, max=null}){
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = `<span class="field-label">${label}</span>`;
    const inp = document.createElement('input');
    inp.type = type;
    inp.value = value ?? '';
    inp.placeholder = placeholder;
    if(min!==null) inp.min = min;
    if(max!==null) inp.max = max;
    inp.addEventListener('input', e=>onInput(e.target.value));
    wrap.appendChild(inp);
    return wrap;
  }

  function textareaField({label, value, onInput, placeholder='', rows=3}){
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = `<span class="field-label">${label}</span>`;
    const ta = document.createElement('textarea');
    ta.rows = rows;
    ta.value = value ?? '';
    ta.placeholder = placeholder;
    ta.addEventListener('input', e=>onInput(e.target.value));
    wrap.appendChild(ta);
    return wrap;
  }

  function selectField({label, value, onChange, options}){
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = `<span class="field-label">${label}</span>`;
    const sel = document.createElement('select');
    options.forEach(o=>{
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener('change', e=>onChange(e.target.value));
    wrap.appendChild(sel);
    return wrap;
  }

  function checkboxRow(items){
    const div = document.createElement('div');
    div.className = 'stack';
    items.forEach(({key,label,checked,onChange})=>{
      const row = document.createElement('label');
      row.className = 'pill';
      row.style.display='flex';
      row.style.alignItems='center';
      row.style.gap='10px';
      row.innerHTML = `<input type="checkbox" ${checked?'checked':''} /> <span>${label}</span>`;
      const cb = $('input', row);
      cb.addEventListener('change', ()=>onChange(cb.checked));
      div.appendChild(row);
    });
    return div;
  }

  function renderStepBody(){
    const body = $('#stageBody');
    body.innerHTML = '';
    const evalData = state.active.data;

    // Step 0
    if(state.step===0){
      const grid = document.createElement('div');
      grid.className = 'grid2';

      grid.appendChild(inputField({
        label:'Nombre/Iniciales del usuario',
        value: evalData.nombrePaciente,
        placeholder:'Ej: J.P. / NN',
        onInput:(v)=>{ evalData.nombrePaciente=v; markDirty(); }
      }));
      grid.appendChild(inputField({
        label:'ID/Ficha',
        value: evalData.idFicha,
        placeholder:'Ej: 12345',
        onInput:(v)=>{ evalData.idFicha=v; markDirty(); }
      }));
      grid.appendChild(inputField({
        label:'Fecha de evaluación *',
        type:'date',
        value: evalData.fechaEvaluacion,
        onInput:(v)=>{ evalData.fechaEvaluacion=v; markDirty(); }
      }));

      const ageWrap = document.createElement('div');
      ageWrap.className='grid2';
      ageWrap.style.gridColumn='span 1';
      ageWrap.appendChild(inputField({
        label:'Edad (años) *',
        type:'text',
        value: evalData.edadAnios,
        placeholder:'Ej: 6 / NN',
        onInput:(v)=>{ evalData.edadAnios=v; markDirty(); }
      }));
      ageWrap.appendChild(inputField({
        label:'Meses (0–11)',
        type:'number',
        min:0, max:11,
        value: evalData.edadMeses,
        onInput:(v)=>{ evalData.edadMeses = clamp(v,0,11); markDirty(); }
      }));
      grid.appendChild(ageWrap);

      body.appendChild(grid);

      body.appendChild(textareaField({
        label:'Diagnóstico médico de base',
        value: evalData.diagnosticoBase,
        rows:2,
        placeholder:'Texto libre',
        onInput:(v)=>{ evalData.diagnosticoBase=v; markDirty(); }
      }));

      body.appendChild(selectField({
        label:'Contexto de evaluación',
        value: evalData.contextoEvaluacion,
        onChange:(v)=>{ evalData.contextoEvaluacion=v; markDirty(); },
        options:[
          {value:'clinico', label:'Clínico'},
          {value:'educacional', label:'Educacional'},
          {value:'domiciliario', label:'Domiciliario'},
          {value:'otro', label:'Otro'}
        ]
      }));

      body.appendChild(inputField({
        label:'Evaluador/a',
        value: evalData.evaluador,
        placeholder:'Nombre del profesional',
        onInput:(v)=>{ evalData.evaluador=v; markDirty(); }
      }));

      body.appendChild(textareaField({
        label:'Observaciones generales',
        value: evalData.observacionesGenerales,
        rows:3,
        placeholder:'Contexto, postura, factores relevantes',
        onInput:(v)=>{ evalData.observacionesGenerales=v; markDirty(); }
      }));

      return;
    }

    // Step 1: DQ5
    if(state.step===1){
      const dq = calcDQ5(evalData);

      const cardInfo = document.createElement('div');
      cardInfo.className='card';
      cardInfo.innerHTML = `
        <div class="card-title">DQ5 — Frecuencia objetiva</div>
        <p class="muted">
          Observe <strong>5 minutos</strong>. Registre cada <strong>15 s</strong> (20 intervalos):
          <strong>0</strong> = sin escape visible; <strong>1</strong> = escape visible (labios/mentón/ropa).
        </p>
        <p class="muted small">
          Nota: El DQ5 entrega un valor continuo y no posee puntos de corte universales; las bandas son orientativas para lectura clínica y seguimiento.
        </p>
      `;
      body.appendChild(cardInfo);

      const cardTimer = document.createElement('div');
      cardTimer.className='card';
      cardTimer.innerHTML = `
        <div class="card-title">
          <span>Cronómetro guiado</span>
          <span class="muted small">Intervalo ${state.dqTimer.intervalIndex+1}/20 · ${15 - state.dqTimer.seconds}s</span>
        </div>
        <div class="row-actions">
          <button class="btn" id="dqStart">${state.dqTimer.running?'Pausar':'Iniciar'}</button>
          <button class="btn btn-ghost" id="dqReset">Reiniciar</button>
          <span class="pill ${state.dqTimer.running?'ok':'warn'}">${state.dqTimer.running?'Activo':'Detenido'}</span>
        </div>
        <p class="muted small">Sugerencia: al terminar cada intervalo, selecciona 0/1 del intervalo actual.</p>
      `;
      body.appendChild(cardTimer);

      // Results pill
      const pills = document.createElement('div');
      pills.className='pills';
      pills.innerHTML = `
        <div class="pill ok">n_escape: <strong>${dq.nEscape}</strong></div>
        <div class="pill ok">DQ5%: <strong>${dq.pct}</strong></div>
        <div class="pill warn">${dq.cat}</div>
      `;
      body.appendChild(pills);

      // Grid intervals
      const grid = document.createElement('div');
      grid.className='dq-grid';
      evalData.intervalos.forEach((v, i)=>{
        const it = document.createElement('div');
        it.className='interval';
        const active = i===state.dqTimer.intervalIndex && state.dqTimer.running;
        it.style.outline = active ? '2px solid rgba(107,43,191,.55)' : 'none';
        it.innerHTML = `
          <small>Intervalo ${i+1}</small>
          <div class="toggle">
            <button class="tbtn ${v===0?'on0':''}" data-i="${i}" data-v="0">0</button>
            <button class="tbtn ${v===1?'on1':''}" data-i="${i}" data-v="1">1</button>
          </div>
        `;
        grid.appendChild(it);
      });
      body.appendChild(grid);

      // DQ5 extra fields
      const cardExtra = document.createElement('div');
      cardExtra.className='card';
      cardExtra.innerHTML = `<div class="card-title">Condiciones y patrón observado</div>`;

      const cond = checkboxRow([
        {key:'vigilia',label:'Vigilia',checked:evalData.condicionesDQ5.vigilia,onChange:(c)=>{evalData.condicionesDQ5.vigilia=c; markDirty();}},
        {key:'sedente',label:'Sedente',checked:evalData.condicionesDQ5.sedente,onChange:(c)=>{evalData.condicionesDQ5.sedente=c; markDirty();}},
        {key:'sinIngesta',label:'Sin ingesta',checked:evalData.condicionesDQ5.sinIngesta,onChange:(c)=>{evalData.condicionesDQ5.sinIngesta=c; markDirty();}},
        {key:'actividadBasal',label:'Actividad basal',checked:evalData.condicionesDQ5.actividadBasal,onChange:(c)=>{evalData.condicionesDQ5.actividadBasal=c; markDirty();}},
        {key:'otro',label:'Otro',checked:evalData.condicionesDQ5.otro,onChange:(c)=>{evalData.condicionesDQ5.otro=c; markDirty();}}
      ]);

      const condOther = inputField({
        label:'Otro (detalle)',
        value: evalData.condicionesDQ5.otroTexto,
        placeholder:'Opcional',
        onInput:(v)=>{ evalData.condicionesDQ5.otroTexto=v; markDirty(); }
      });

      const pat = checkboxRow([
        {key:'escapeAnterior',label:'Escape anterior',checked:evalData.patronObservado.escapeAnterior,onChange:(c)=>{evalData.patronObservado.escapeAnterior=c; markDirty();}},
        {key:'posturaAbierta',label:'Postura oral abierta',checked:evalData.patronObservado.posturaAbierta,onChange:(c)=>{evalData.patronObservado.posturaAbierta=c; markDirty();}},
        {key:'bajaDeglusion',label:'Baja deglución espontánea',checked:evalData.patronObservado.bajaDeglusion,onChange:(c)=>{evalData.patronObservado.bajaDeglusion=c; markDirty();}},
        {key:'hipotonia',label:'Hipotonía orofacial aparente',checked:evalData.patronObservado.hipotonia,onChange:(c)=>{evalData.patronObservado.hipotonia=c; markDirty();}},
        {key:'otro',label:'Otro',checked:evalData.patronObservado.otro,onChange:(c)=>{evalData.patronObservado.otro=c; markDirty();}}
      ]);
      const patOther = inputField({
        label:'Otro (detalle)',
        value: evalData.patronObservado.otroTexto,
        placeholder:'Opcional',
        onInput:(v)=>{ evalData.patronObservado.otroTexto=v; markDirty(); }
      });

      const g = document.createElement('div');
      g.className='grid2';
      const col1=document.createElement('div'); col1.className='stack';
      const col2=document.createElement('div'); col2.className='stack';
      col1.appendChild(document.createElement('div')).outerHTML = '';
      col1.appendChild(document.createElement('div'));
      col1.innerHTML = `<div class="muted"><strong>Condiciones</strong></div>`;
      col1.appendChild(cond);
      col1.appendChild(condOther);

      col2.innerHTML = `<div class="muted"><strong>Patrón</strong></div>`;
      col2.appendChild(pat);
      col2.appendChild(patOther);
      g.appendChild(col1); g.appendChild(col2);

      cardExtra.appendChild(g);
      body.appendChild(cardExtra);

      // wire toggle buttons
      $$('.tbtn', body).forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const i = Number(btn.dataset.i);
          const v = Number(btn.dataset.v);
          evalData.intervalos[i]=v;
          markDirty();
          renderAll(false); // rerender without scroll reset
        });
      });

      // timer wiring
      $('#dqStart', body).addEventListener('click', ()=>{
        toggleDQTimer();
      });
      $('#dqReset', body).addEventListener('click', ()=>{
        resetDQTimer(true);
        toast('DQ5 reiniciado');
        renderAll(false);
      });

      return;
    }

    // Step 2: Thomas-Stonell
    if(state.step===2){
      const th = calcThomas(evalData);
      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = `
        <div class="card-title">Thomas‑Stonell & Greenberg — Severidad y Frecuencia funcional</div>
        <p class="muted">Seleccione la severidad (1–5) y frecuencia (1–4). Se genera una clasificación funcional automática.</p>
      `;
      body.appendChild(card);

      const grid = document.createElement('div');
      grid.className='grid2';

      const sev = selectField({
        label:'Severidad (1–5)',
        value: String(evalData.severidad),
        onChange:(v)=>{ evalData.severidad = Number(v); markDirty(); renderAll(false); },
        options:[
          {value:'1',label:'1 — Seco (sin babeo)'},
          {value:'2',label:'2 — Solo labios húmedos'},
          {value:'3',label:'3 — Labios y mentón húmedos'},
          {value:'4',label:'4 — Ropa húmeda'},
          {value:'5',label:'5 — Ropa empapada, requiere cambio frecuente'}
        ]
      });

      const fr = selectField({
        label:'Frecuencia (1–4)',
        value: String(evalData.frecuencia),
        onChange:(v)=>{ evalData.frecuencia = Number(v); markDirty(); renderAll(false); },
        options:[
          {value:'1',label:'1 — Nunca babea'},
          {value:'2',label:'2 — Ocasional (no diario)'},
          {value:'3',label:'3 — Frecuente (diario)'},
          {value:'4',label:'4 — Constante (casi siempre)'}
        ]
      });

      grid.appendChild(sev);
      grid.appendChild(fr);
      body.appendChild(grid);

      const pills = document.createElement('div');
      pills.className='pills';
      pills.innerHTML = `
        <div class="pill ok">Severidad: <strong>${th.sevCat}</strong></div>
        <div class="pill ok">Frecuencia: <strong>${th.frCat}</strong></div>
        <div class="pill warn">Resumen: Thomas‑Stonell — Severidad ${th.sevCat}, Frecuencia ${th.frCat}</div>
      `;
      body.appendChild(pills);

      return;
    }

    // Step 3: DIS
    if(state.step===3){
      // ensure disItems length matches config items length
      const n = state.cfg.disItems.length;
      if(!Array.isArray(evalData.disItems)) evalData.disItems = [];
      while(evalData.disItems.length < n) evalData.disItems.push(0);
      if(evalData.disItems.length > n) evalData.disItems = evalData.disItems.slice(0,n);

      const di = calcDIS(evalData);

      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = `
        <div class="card-title">Drooling Impact Scale (DIS) — Impacto funcional y psicosocial</div>
        <p class="muted">Escala 0–10 por ítem (0 = sin impacto, 10 = impacto máximo). Ítems editables en Configuración.</p>
      `;
      body.appendChild(card);

      const table = document.createElement('table');
      table.className='table';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr><th>Ítem</th><th style="width:140px">Puntaje (0–10)</th></tr>`;
      table.appendChild(thead);
      const tb = document.createElement('tbody');

      state.cfg.disItems.forEach((txt, i)=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(txt)}</td>
          <td>
            <input type="number" min="0" max="10" step="1" value="${Number(evalData.disItems[i]||0)}" data-dis="${i}" />
          </td>
        `;
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      body.appendChild(table);

      const pills = document.createElement('div');
      pills.className='pills';
      pills.innerHTML = `
        <div class="pill ok">Total: <strong>${di.total}</strong> / ${di.max}</div>
        <div class="pill ok">DIS%: <strong>${di.pct}</strong></div>
        <div class="pill ${di.cat==='Impacto severo'?'bad':(di.cat==='Impacto moderado'?'warn':'ok')}">${di.cat} (orientativo)</div>
      `;
      body.appendChild(pills);

      // simple bar
      const bar = document.createElement('div');
      bar.className='card';
      bar.innerHTML = `
        <div class="card-title">Distribución (barra global)</div>
        <div class="bar"><div style="width:${di.pct}%"></div></div>
        <p class="muted small">Clasificación orientativa: ≤${state.cfg.disBands.low}% leve; ≤${state.cfg.disBands.mod}% moderado; &gt;${state.cfg.disBands.mod}% severo.</p>
      `;
      body.appendChild(bar);

      // handlers
      $$('input[data-dis]', body).forEach(inp=>{
        inp.addEventListener('input', ()=>{
          const idx = Number(inp.dataset.dis);
          evalData.disItems[idx] = clamp(inp.value, 0, 10);
          markDirty();
          renderAll(false);
        });
      });

      return;
    }

    // Step 4: Integración
    if(state.step===4){
      const dq = calcDQ5(evalData);
      const th = calcThomas(evalData);
      const di = calcDIS(evalData);
      const integ = analyzeIntegration(evalData);

      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = `
        <div class="card-title">Integración transversal (correlación)</div>
        <p class="muted">Se genera concordancia y se solicita comentario cuando hay discordancia.</p>
      `;
      body.appendChild(card);

      const table = document.createElement('table');
      table.className='table';
      table.innerHTML = `
        <thead><tr><th>Instrumento</th><th>Resultado</th></tr></thead>
        <tbody>
          <tr><td>DQ5 (Frecuencia)</td><td>${dq.pct}% — ${dq.cat}</td></tr>
          <tr><td>Thomas‑Stonell</td><td>Severidad ${th.sevCat} · Frecuencia ${th.frCat}</td></tr>
          <tr><td>DIS (Impacto)</td><td>${di.total}/${di.max} (${di.pct}%) — ${di.cat}</td></tr>
        </tbody>
      `;
      body.appendChild(table);

      const pill = document.createElement('div');
      pill.className='pills';
      pill.innerHTML = `
        <div class="pill ${integ.requiresComment?'warn':'ok'}">Integración: <strong>${integ.label}</strong></div>
        <div class="pill warn">Si hay discordancia, registre comentario clínico (obligatorio).</div>
      `;
      body.appendChild(pill);

      const ta = textareaField({
        label:'Comentario clínico de integración ' + (integ.requiresComment?'* (obligatorio)':'(opcional)'),
        value: evalData.comentarioIntegracion,
        rows:4,
        placeholder:'Ej: contexto, sesgos, adaptación familiar, condiciones del DQ5, barreras/facilitadores.',
        onInput:(v)=>{ evalData.comentarioIntegracion=v; markDirty(); renderAll(false); }
      });
      body.appendChild(ta);

      return;
    }

    // Step 5: Perfil clínico
    if(state.step===5){
      const pr = profileResult(evalData);
      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = `
        <div class="card-title">Perfil clínico resultante (tipificación)</div>
        <div class="pills">
          <div class="pill ok"><strong>${pr.profile}</strong></div>
        </div>
        <p class="muted"><strong>Transparencia:</strong> ${escapeHtml(pr.why)}</p>
      `;
      body.appendChild(card);
      return;
    }

    // Step 6: Diagnóstico
    if(state.step===6){
      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = `
        <div class="card-title">Diagnóstico fonoaudiológico orientador (editable)</div>
        <p class="muted">Generación automática con posibilidad de editar antes de exportar.</p>
      `;
      body.appendChild(card);

      const eti = selectField({
        label:'Etiología orientativa (sin diagnóstico médico)',
        value: evalData.etiologiaOrientativa,
        onChange:(v)=>{ evalData.etiologiaOrientativa=v; markDirty(); renderAll(false); },
        options:[
          {value:'neuromotor', label:'Neuromotor'},
          {value:'sensorial', label:'Sensorial'},
          {value:'mixto', label:'Mixto'},
          {value:'evaluacion', label:'En evaluación'}
        ]
      });
      body.appendChild(eti);

      // Use evalData.planNotas as general "editable diagnosis"? We'll store in evalData.diagnosticoEditable
      if(typeof evalData.diagnosticoEditable !== 'string' || !evalData.diagnosticoEditable.trim()){
        evalData.diagnosticoEditable = diagnosisText(evalData);
      }

      const ta = textareaField({
        label:'Texto (puedes editarlo)',
        value: evalData.diagnosticoEditable,
        rows:12,
        onInput:(v)=>{ evalData.diagnosticoEditable=v; markDirty(); }
      });
      body.appendChild(ta);

      const actions = document.createElement('div');
      actions.className='row-actions';
      actions.innerHTML = `
        <button class="btn btn-ghost" id="btnRegenerateDx" type="button">Regenerar</button>
        <button class="btn" id="btnCopyDx" type="button">Copiar</button>
      `;
      body.appendChild(actions);

      $('#btnRegenerateDx', body).addEventListener('click', ()=>{
        evalData.diagnosticoEditable = diagnosisText(evalData);
        markDirty();
        renderAll(false);
        toast('Diagnóstico regenerado');
      });
      $('#btnCopyDx', body).addEventListener('click', async ()=>{
        await navigator.clipboard.writeText(evalData.diagnosticoEditable || '');
        toast('Copiado');
      });

      return;
    }

    // Step 7: Plan
    if(state.step===7){
      const pr = profileResult(evalData);
      const di = calcDIS(evalData);

      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = `
        <div class="card-title">Indicaciones y plan (automático + editable)</div>
        <p class="muted">Se sugiere una estructura base. Ajusta según contexto clínico.</p>
      `;
      body.appendChild(card);

      const objGeneral = document.createElement('div');
      objGeneral.className='callout callout-info';
      objGeneral.innerHTML = `
        <div class="callout-title">Objetivo general (predefinido)</div>
        <div class="callout-body">Optimizar el control salival y minimizar el impacto funcional y psicosocial de la sialorrea.</div>
      `;
      body.appendChild(objGeneral);

      const grid = document.createElement('div');
      grid.className='grid2';

      const checklist = checkboxRow([
        {key:'selladoLabial',label:'Sellado labial',checked:evalData.objetivosSeleccionados.selladoLabial,onChange:(c)=>{evalData.objetivosSeleccionados.selladoLabial=c; markDirty();}},
        {key:'aumentoDeglusion',label:'Aumento de deglución espontánea',checked:evalData.objetivosSeleccionados.aumentoDeglusion,onChange:(c)=>{evalData.objetivosSeleccionados.aumentoDeglusion=c; markDirty();}},
        {key:'concienciaSensorial',label:'Conciencia sensorial oral',checked:evalData.objetivosSeleccionados.concienciaSensorial,onChange:(c)=>{evalData.objetivosSeleccionados.concienciaSensorial=c; markDirty();}},
        {key:'manejoPostural',label:'Manejo postural / estabilidad proximal',checked:evalData.objetivosSeleccionados.manejoPostural,onChange:(c)=>{evalData.objetivosSeleccionados.manejoPostural=c; markDirty();}},
        {key:'entrenamientoCuidadores',label:'Entrenamiento a cuidadores',checked:evalData.objetivosSeleccionados.entrenamientoCuidadores,onChange:(c)=>{evalData.objetivosSeleccionados.entrenamientoCuidadores=c; markDirty();}}
      ]);

      const follow = document.createElement('div');
      follow.className='stack';
      follow.appendChild(selectField({
        label:'Reevaluación recomendada (semanas)',
        value:String(evalData.semanasReevaluacion),
        onChange:(v)=>{ evalData.semanasReevaluacion = clamp(v, 4, 24); markDirty(); },
        options:[
          {value:'8',label:'8'},
          {value:'10',label:'10'},
          {value:'12',label:'12'},
          {value:'16',label:'16'}
        ]
      }));

      // Derivations suggestion
      const needsDer = (di.cat==='Impacto severo');
      const deriv = checkboxRow([
        {key:'medico',label:'Interconsulta médica (orientación)',checked:evalData.derivaciones.medico,onChange:(c)=>{evalData.derivaciones.medico=c; markDirty();}},
        {key:'dermatologia',label:'Dermatología (si irritación/cutáneo marcado)',checked:evalData.derivaciones.dermatologia,onChange:(c)=>{evalData.derivaciones.dermatologia=c; markDirty();}},
        {key:'odontologia',label:'Odontología (salud oral / maloclusión / etc.)',checked:evalData.derivaciones.odontologia,onChange:(c)=>{evalData.derivaciones.odontologia=c; markDirty();}}
      ]);
      follow.appendChild(document.createElement('div'));
      const hint = document.createElement('div');
      hint.className='pill ' + (needsDer?'warn':'ok');
      hint.textContent = needsDer ? 'Sugerencia: DIS severo → considerar derivación/interconsulta (orientativo).' : 'Derivación: según criterio clínico.';
      follow.appendChild(hint);
      follow.appendChild(deriv);

      grid.appendChild(checklist);
      grid.appendChild(follow);
      body.appendChild(grid);

      body.appendChild(textareaField({
        label:'Notas clínicas / indicaciones específicas (editable)',
        value: evalData.planNotas,
        rows:5,
        placeholder:'Estrategias, indicaciones a cuidadores, adaptaciones contextuales, etc.',
        onInput:(v)=>{ evalData.planNotas=v; markDirty(); }
      }));

      // show context
      const pill = document.createElement('div');
      pill.className='pills';
      pill.innerHTML = `<div class="pill ok">Perfil actual: <strong>${escapeHtml(pr.profile)}</strong></div>`;
      body.appendChild(pill);

      return;
    }

    // Step 8: Report
    if(state.step===8){
      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = `
        <div class="card-title">Reporte final</div>
        <p class="muted">Usa “Revisión final” (arriba) para copiar y exportar. Aquí se muestra una vista previa abreviada.</p>
      `;
      body.appendChild(card);

      const pre = document.createElement('pre');
      pre.style.whiteSpace='pre-wrap';
      pre.style.margin='0';
      pre.style.padding='14px';
      pre.style.border='1px solid var(--border)';
      pre.style.borderRadius='16px';
      pre.style.background='rgba(255,255,255,.02)';
      pre.textContent = buildReportText(state.active.data);
      body.appendChild(pre);

      return;
    }
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /** =============== Report building & exports =============== **/
  function labelContext(v){
    const map = { clinico:'Clínico', educacional:'Educacional', domiciliario:'Domiciliario', otro:'Otro' };
    return map[v] || String(v||'');
  }

  function mapObjectives(obj){
    const labels = {
      selladoLabial: '• Mejorar competencia de sellado labial',
      aumentoDeglusion: '• Aumentar frecuencia de deglución espontánea',
      concienciaSensorial: '• Desarrollar conciencia sensorial oral',
      manejoPostural: '• Optimizar manejo postural y estabilidad proximal',
      entrenamientoCuidadores: '• Capacitar a cuidadores en estrategias de manejo'
    };
    return Object.entries(obj||{}).filter(([,v])=>v).map(([k])=>labels[k]).filter(Boolean);
  }

  function buildReportText(data){
    const dq = calcDQ5(data);
    const th = calcThomas(data);
    const di = calcDIS(data);
    const integ = analyzeIntegration(data);
    const pr = profileResult(data);
    const dx = (data.diagnosticoEditable && data.diagnosticoEditable.trim()) ? data.diagnosticoEditable : diagnosisText(data);

    const cond = Object.entries(data.condicionesDQ5||{}).filter(([k,v])=>v && k!=='otroTexto').map(([k])=>k);
    const condTxt = cond.length ? cond.map(k=>'• '+prettyKey(k)).join('\n') : '• No especificado';
    const condOther = data.condicionesDQ5?.otroTexto ? `\n• Otro: ${data.condicionesDQ5.otroTexto}` : '';

    const pat = Object.entries(data.patronObservado||{}).filter(([k,v])=>v && k!=='otroTexto').map(([k])=>k);
    const patTxt = pat.length ? pat.map(k=>'• '+prettyKey(k)).join('\n') : '• No especificado';
    const patOther = data.patronObservado?.otroTexto ? `\n• Otro: ${data.patronObservado.otroTexto}` : '';

    const disLines = state.cfg.disItems.map((txt,i)=> `${txt}: ${Number(data.disItems?.[i]||0)}/${state.cfg.disScale.max}`).join('\n');

    const objs = mapObjectives(data.objetivosSeleccionados);
    const objTxt = objs.length ? objs.join('\n') : '• (sin selección)';

    const deriv = Object.entries(data.derivaciones||{}).filter(([,v])=>v).map(([k])=>`• ${capitalize(k)}`).join('\n');

    return [
      '═══════════════════════════════════════════════════════════',
      'GRAN TEST INTEGRADO DE CONTROL SALIVAL',
      'Informe de Evaluación Fonoaudiológica (uso interno)',
      '═══════════════════════════════════════════════════════════',
      '',
      'IDENTIFICACIÓN',
      '─────────────────────────────────────────────────────────',
      `Nombre/Iniciales: ${data.nombrePaciente?.trim() ? data.nombrePaciente : 'NN'}`,
      `ID/Ficha: ${data.idFicha?.trim() ? data.idFicha : 'NN'}`,
      `Fecha de evaluación: ${data.fechaEvaluacion || ''}`,
      `Edad: ${data.edadAnios || ''} años ${data.edadMeses || ''} meses`,
      `Diagnóstico de base: ${data.diagnosticoBase?.trim()? data.diagnosticoBase : 'No especificado'}`,
      `Contexto: ${labelContext(data.contextoEvaluacion)}`,
      `Evaluador/a: ${data.evaluador?.trim()? data.evaluador : 'No especificado'}`,
      data.observacionesGenerales?.trim()? `Observaciones: ${data.observacionesGenerales}` : '',
      '',
      '1) DQ5 (Drooling Quotient 5) — Frecuencia objetiva',
      '─────────────────────────────────────────────────────────',
      'Observación: 5 minutos (20 intervalos de 15 segundos)',
      `Intervalos con escape: ${dq.nEscape}/20`,
      `Porcentaje DQ5: ${dq.pct}%`,
      `Etiqueta orientativa: ${dq.cat}`,
      '',
      'Registro intervalos (1..20):',
      (data.intervalos||[]).map((v,i)=>`  ${String(i+1).padStart(2,'0')}: ${v===1?'ESCAPE':'sin escape'}`).join('\n'),
      '',
      'Condiciones durante DQ5:',
      condTxt + condOther,
      '',
      'Patrón observado:',
      patTxt + patOther,
      '',
      'Nota: El DQ5 entrega un valor continuo y no posee puntos de corte universales; estas bandas son orientativas para lectura clínica y seguimiento.',
      '',
      '2) Thomas‑Stonell & Greenberg',
      '─────────────────────────────────────────────────────────',
      `Severidad: ${data.severidad} → ${th.sevCat}`,
      `Frecuencia: ${data.frecuencia} → ${th.frCat}`,
      `Resumen: Severidad ${th.sevCat}, Frecuencia ${th.frCat}`,
      '',
      '3) Drooling Impact Scale (DIS)',
      '─────────────────────────────────────────────────────────',
      disLines,
      '',
      `Total DIS: ${di.total}/${di.max}`,
      `DIS%: ${di.pct}%`,
      `Categoría orientativa: ${di.cat}`,
      '',
      '4) Integración transversal',
      '─────────────────────────────────────────────────────────',
      integ.label,
      (data.comentarioIntegracion?.trim()? `Comentario clínico: ${data.comentarioIntegracion}` : ''),
      '',
      '5) Perfil clínico resultante',
      '─────────────────────────────────────────────────────────',
      pr.profile,
      `Fundamentación: ${pr.why}`,
      '',
      '6) Diagnóstico orientador',
      '─────────────────────────────────────────────────────────',
      dx,
      '',
      '7) Indicaciones y plan',
      '─────────────────────────────────────────────────────────',
      'Objetivo general: Optimizar el control salival y minimizar el impacto funcional y psicosocial de la sialorrea.',
      '',
      'Objetivos específicos:',
      objTxt,
      '',
      `Seguimiento: Reevaluación recomendada en ${data.semanasReevaluacion} semanas.`,
      deriv ? `\nDerivaciones sugeridas (orientación):\n${deriv}` : '',
      data.planNotas?.trim()? `\nNotas: ${data.planNotas}` : '',
      '',
      'NOTA METODOLÓGICA ESTÁNDAR:',
      'La sialorrea se evalúa con instrumentos observacionales y funcionales. El DQ5 cuantifica frecuencia como porcentaje continuo y no posee puntos de corte universales; se utiliza para objetivar frecuencia y seguimiento. Thomas‑Stonell & Greenberg aporta tipificación funcional (severidad/frecuencia) y la Drooling Impact Scale mide repercusión en calidad de vida. La interpretación es integral y clínica.',
      '',
      'AVISO: Esta herramienta apoya el registro clínico; no reemplaza el juicio profesional del fonoaudiólogo/a.'
    ].filter(Boolean).join('\n');
  }

  function prettyKey(k){
    const map = {
      vigilia:'Vigilia',
      sedente:'Sedente',
      sinIngesta:'Sin ingesta',
      actividadBasal:'Actividad basal',
      escapeAnterior:'Escape anterior',
      posturaAbierta:'Postura oral abierta',
      bajaDeglusion:'Baja deglución espontánea',
      hipotonia:'Hipotonía orofacial aparente',
      otro:'Otro'
    };
    return map[k] || k;
  }

  function capitalize(s){ return String(s||'').charAt(0).toUpperCase() + String(s||'').slice(1); }

  function exportJSON(){
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    downloadBlob(blob, filenameBase(data) + '.json');
  }

  function exportCSV(){
    const d = state.active.data;
    const dq = calcDQ5(d);
    const th = calcThomas(d);
    const di = calcDIS(d);
    const integ = analyzeIntegration(d);
    const pr = profileResult(d);

    const rows = [];
    rows.push(['campo','valor']);
    rows.push(['nombre', (d.nombrePaciente||'NN')]);
    rows.push(['id_ficha', (d.idFicha||'NN')]);
    rows.push(['fecha', d.fechaEvaluacion||'']);
    rows.push(['edad_anios', d.edadAnios||'']);
    rows.push(['edad_meses', d.edadMeses||'']);
    rows.push(['diagnostico_base', (d.diagnosticoBase||'')]);
    rows.push(['contexto', labelContext(d.contextoEvaluacion)]);
    rows.push(['evaluador', (d.evaluador||'')]);

    rows.push(['dq5_n_escape', dq.nEscape]);
    rows.push(['dq5_pct', dq.pct]);
    rows.push(['dq5_cat_orientativa', dq.cat]);
    (d.intervalos||[]).forEach((v,i)=> rows.push([`dq5_intervalo_${i+1}`, v]));

    rows.push(['thomas_severidad', d.severidad]);
    rows.push(['thomas_sev_cat', th.sevCat]);
    rows.push(['thomas_frecuencia', d.frecuencia]);
    rows.push(['thomas_frec_cat', th.frCat]);

    state.cfg.disItems.forEach((txt,i)=> rows.push([`dis_item_${i+1}_${txt}`, Number(d.disItems?.[i]||0)]));
    rows.push(['dis_total', di.total]);
    rows.push(['dis_pct', di.pct]);
    rows.push(['dis_cat_orientativa', di.cat]);

    rows.push(['integracion', integ.label]);
    rows.push(['comentario_integracion', d.comentarioIntegracion||'']);

    rows.push(['perfil', pr.profile]);
    rows.push(['perfil_razon', pr.why]);

    rows.push(['etiologia_orientativa', d.etiologiaOrientativa||'']);
    rows.push(['diagnostico_texto', (d.diagnosticoEditable || diagnosisText(d)).replace(/\n/g,'\\n')]);

    rows.push(['semanas_reevaluacion', d.semanasReevaluacion]);
    rows.push(['plan_notas', (d.planNotas||'').replace(/\n/g,'\\n')]);

    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv], {type:'text/csv'}), filenameBase(d) + '.csv');
  }

  function exportPDF(){
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
    if(!w){ toast('Popup bloqueado. Permite ventanas emergentes para exportar PDF.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function filenameBase(d){
    const name = (d.nombrePaciente && d.nombrePaciente.trim()) ? d.nombrePaciente.trim().replace(/\s+/g,'_') : 'paciente';
    const date = (d.fechaEvaluacion || todayISO());
    return `gran_test_salival_${name}_${date}`;
  }

  /** =============== Wizard nav & actions =============== **/
  function markDirty(){ state._dirty = true; }

  function goNext(){
    const d = state.active.data;
    const v = stepValid(state.step, d);
    if(!v.ok){
      toast(v.msg);
      return;
    }
    if(state.step < STEPS.length-1){
      state.step++;
      renderAll();
      window.scrollTo({top:0, behavior:'smooth'});
    }
  }

  function goPrev(){
    if(state.step>0){
      state.step--;
      renderAll();
      window.scrollTo({top:0, behavior:'smooth'});
    }
  }

  /** =============== DQ timer =============== **/
  function toggleDQTimer(){
    if(state.dqTimer.running){
      state.dqTimer.running = false;
      clearInterval(state.dqTimer.handle);
      state.dqTimer.handle = null;
      renderAll(false);
      return;
    }
    state.dqTimer.running = true;
    state.dqTimer.handle = setInterval(()=>{
      state.dqTimer.seconds += 1;
      if(state.dqTimer.seconds >= 15){
        state.dqTimer.seconds = 0;
        if(state.dqTimer.intervalIndex < 19){
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
      if(state.step === 1) renderAll(false);
    }, 1000);
    renderAll(false);
  }

  function resetDQTimer(clearIntervals){
    state.dqTimer.running = false;
    clearInterval(state.dqTimer.handle);
    state.dqTimer.handle = null;
    state.dqTimer.intervalIndex = 0;
    state.dqTimer.seconds = 0;
    if(clearIntervals && state.active?.data?.intervalos){
      state.active.data.intervalos = Array(20).fill(0);
      markDirty();
    }
  }

  /** =============== Config drawer =============== **/
  function openDrawer(which){
    if(which==='config'){
      $('#configBackdrop').classList.remove('hidden');
      $('#configDrawer').classList.remove('hidden');
      renderConfig();
    }
    if(which==='review'){
      $('#reviewBackdrop').classList.remove('hidden');
      $('#reviewDrawer').classList.remove('hidden');
      renderReview();
    }
  }

  function closeDrawer(which){
    if(which==='config'){
      $('#configBackdrop').classList.add('hidden');
      $('#configDrawer').classList.add('hidden');
    }
    if(which==='review'){
      $('#reviewBackdrop').classList.add('hidden');
      $('#reviewDrawer').classList.add('hidden');
    }
  }

  function renderConfig(){
    const list = $('#disConfigList');
    list.innerHTML = '';

    state.cfg.disItems.forEach((txt, i)=>{
      const row = document.createElement('div');
      row.className='grid2';
      row.innerHTML = `
        <label class="field" style="grid-column: span 2">
          <span class="field-label">Ítem ${i+1}</span>
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

    $$('input[data-dis-txt]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const i = Number(inp.dataset.disTxt);
        state.cfg.disItems[i] = inp.value;
      });
    });
  }

  function applyConfigToActive(){
    // ensure DIS values length matches config
    const d = state.active.data;
    const n = state.cfg.disItems.length;
    if(!Array.isArray(d.disItems)) d.disItems = [];
    while(d.disItems.length < n) d.disItems.push(0);
    if(d.disItems.length > n) d.disItems = d.disItems.slice(0,n);
  }

  /** =============== Review drawer =============== **/
  function renderReview(){
    const d = state.active.data;
    const dq = calcDQ5(d);
    const th = calcThomas(d);
    const di = calcDIS(d);
    const integ = analyzeIntegration(d);
    const pr = profileResult(d);

    const content = $('#reviewContent');
    const checklist = STEPS.map((s,i)=>{
      const v = stepValid(i, d);
      return `<li class="${v.ok?'ok':'bad'}"><strong>Sección ${i}:</strong> ${escapeHtml(s.title)} — ${v.ok?'OK':escapeHtml(v.msg||'Pendiente')}</li>`;
    }).join('');

    const html = `
      <div class="card">
        <div class="card-title">Resumen</div>
        <div class="pills">
          <span class="pill ok">DQ5: <strong>${dq.pct}%</strong></span>
          <span class="pill ok">Thomas: <strong>${th.sevCat}/${th.frCat}</strong></span>
          <span class="pill ${di.cat==='Impacto severo'?'bad':(di.cat==='Impacto moderado'?'warn':'ok')}">DIS: <strong>${di.pct}%</strong> (${di.cat})</span>
          <span class="pill ${integ.requiresComment?'warn':'ok'}">Integración: <strong>${integ.label}</strong></span>
        </div>
        <p class="muted"><strong>Perfil:</strong> ${escapeHtml(pr.profile)}</p>
      </div>

      <div class="card">
        <div class="card-title">Checklist de completitud</div>
        <ul style="margin:0; padding-left:18px; color:var(--muted)">${checklist}</ul>
      </div>

      <div class="card">
        <div class="card-title">Informe</div>
        <pre style="white-space:pre-wrap; margin:0">${escapeHtml(buildReportText(d))}</pre>
      </div>
    `;
    content.innerHTML = html;
  }

  /** =============== Evaluation list UI =============== **/
  function renderEvalSelect(){
    const sel = $('#evalSelect');
    sel.innerHTML = '';
    if(!state.evals.length){
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(sin evaluaciones)';
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;

    state.evals.forEach(e=>{
      const opt = document.createElement('option');
      opt.value = e.id;
      const date = new Date(e.updatedAt).toLocaleString('es-CL');
      const name = (e.data?.nombrePaciente && e.data.nombrePaciente.trim()) ? e.data.nombrePaciente.trim() : 'NN';
      opt.textContent = `${name} · ${e.data?.fechaEvaluacion || ''} · ${date}`;
      sel.appendChild(opt);
    });
    sel.value = state.activeId || state.evals[0].id;
  }

  function setModeButtons(){
    const c = $('#modeCompleto');
    const r = $('#modeRapido');
    if(state.mode==='completo'){
      c.classList.add('seg-active');
      r.classList.remove('seg-active');
    } else {
      r.classList.add('seg-active');
      c.classList.remove('seg-active');
    }
  }

  /** =============== Main render =============== **/
  function renderAll(scrollTop=true){
    if(!state.active){
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
    $('#btnPrev').disabled = state.step===0;
    $('#btnNext').textContent = (state.step === STEPS.length-1) ? 'Finalizar' : 'Siguiente';
    if(state.step === STEPS.length-1){
      $('#btnNext').disabled = false;
    } else {
      const v = stepValid(state.step, state.active.data);
      $('#btnNext').disabled = (state.mode==='completo') ? !v.ok : false;
    }

    // update header status
    const v = stepValid(state.step, state.active.data);
    $('#stepStatus').textContent = v.ok ? '✔ Sección válida' : `⚠ ${v.msg}`;
  }

  /** =============== Actions =============== **/
  function newEvaluation(){
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

  function duplicateEvaluation(){
    if(!state.active) return;
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

  function saveEvaluation(){
    upsertActive();
    toast('Guardado local');
    renderAll(false);
  }

  function wipeAll(){
    if(!confirm('Esto eliminará TODAS las evaluaciones y configuración local de esta app en este dispositivo. ¿Continuar?')) return;
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
    setTimeout(()=>location.reload(), 300);
  }

  function loadDemo(){
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
    e.data.intervalos = [0,1,0,0,1,0,0,1,0,0, 0,1,0,0,1,0,0,1,0,0];
    // Thomas
    e.data.severidad = 4;
    e.data.frecuencia = 3;
    // DIS
    e.data.disItems = Array(state.cfg.disItems.length).fill(0).map((_,i)=> (i%3===0?6:(i%3===1?4:2)));
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
  function wire(){
    $('#btnPrev').addEventListener('click', goPrev);
    $('#btnNext').addEventListener('click', ()=>{
      if(state.step === STEPS.length-1){
        openDrawer('review');
      } else {
        goNext();
      }
    });

    $('#btnNew').addEventListener('click', newEvaluation);
    $('#btnDuplicate').addEventListener('click', duplicateEvaluation);
    $('#btnSave').addEventListener('click', saveEvaluation);

    $('#evalSelect').addEventListener('change', ()=>{
      const id = $('#evalSelect').value;
      const found = state.evals.find(e=>e.id===id);
      if(found){
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
    $('#modeCompleto').addEventListener('click', ()=>{
      state.mode='completo';
      if(state.active) state.active.mode='completo';
      toast('Modo completo');
      renderAll(false);
    });
    $('#modeRapido').addEventListener('click', ()=>{
      state.mode='rapido';
      if(state.active) state.active.mode='rapido';
      toast('Modo rápido');
      renderAll(false);
    });

    // Config
    $('#btnConfig').addEventListener('click', ()=>openDrawer('config'));
    $('#btnCloseConfig').addEventListener('click', ()=>closeDrawer('config'));
    $('#configBackdrop').addEventListener('click', ()=>closeDrawer('config'));

    $('#btnAddDisItem').addEventListener('click', ()=>{
      state.cfg.disItems.push('Nuevo ítem DIS');
      renderConfig();
    });

    $('#btnSaveConfig').addEventListener('click', ()=>{
      // bands
      state.cfg.dq5Bands.low = clamp($('#cfg_dq5_low').value, 0, 100);
      state.cfg.dq5Bands.mild = clamp($('#cfg_dq5_mild').value, 0, 100);
      state.cfg.dq5Bands.mod = clamp($('#cfg_dq5_mod').value, 0, 100);
      state.cfg.disBands.low = clamp($('#cfg_dis_low').value, 0, 100);
      state.cfg.disBands.mod = clamp($('#cfg_dis_mod').value, 0, 100);

      // ensure ascending order
      if(!(state.cfg.dq5Bands.low <= state.cfg.dq5Bands.mild && state.cfg.dq5Bands.mild <= state.cfg.dq5Bands.mod)){
        toast('DQ5: rangos deben ser ascendentes (baja ≤ leve ≤ moderada).');
        return;
      }
      if(!(state.cfg.disBands.low <= state.cfg.disBands.mod)){
        toast('DIS: rangos deben ser ascendentes (leve ≤ moderado).');
        return;
      }

      saveConfig(state.cfg);
      applyConfigToActive();
      markDirty();
      renderAll(false);
    });

    $('#btnResetConfig').addEventListener('click', ()=>{
      if(!confirm('Restaurar configuración por defecto (solo local)?')) return;
      state.cfg = structuredClone(DEFAULT_CONFIG);
      saveConfig(state.cfg);
      applyConfigToActive();
      renderAll(false);
    });

    // Review
    $('#btnRevision').addEventListener('click', ()=>openDrawer('review'));
    $('#btnCloseReview').addEventListener('click', ()=>closeDrawer('review'));
    $('#reviewBackdrop').addEventListener('click', ()=>closeDrawer('review'));

    $('#btnCopyReport').addEventListener('click', async ()=>{
      const text = buildReportText(state.active.data);
      await navigator.clipboard.writeText(text);
      toast('Informe copiado');
    });
    $('#btnExportJSON').addEventListener('click', exportJSON);
    $('#btnExportCSV').addEventListener('click', exportCSV);
    $('#btnExportPDF').addEventListener('click', exportPDF);

    // Auto-save on unload
    window.addEventListener('beforeunload', ()=>{
      if(state._dirty) upsertActive();
    });
  }

  /** =============== Service worker registration (safe) =============== **/
  async function tryRegisterSW(){
    if(!('serviceWorker' in navigator)) return;
    try{
      const cur = localStorage.getItem(KEY_SW_VER);
      const ver = 'v2';
      if(cur !== ver){
        // force unregister old SW on major change to avoid stale cache
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
        localStorage.setItem(KEY_SW_VER, ver);
      }
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (e){
      console.warn('SW registration failed', e);
      // do not block app
    }
  }

  /** =============== Init =============== **/
  function init(){
    loadAll();
    if(!state.evals.length){
      // create initial empty evaluation
      state.active = defaultEvaluation();
      state.evals.unshift(state.active);
      state.activeId = state.active.id;
      persist();
    }
    if(state.active){
      state.mode = state.active.mode || 'completo';
    }

    wire();
    renderAll();
    tryRegisterSW();
    toast('App lista');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
