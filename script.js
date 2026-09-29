(async () => {
const configResponse = await fetch(`./config.json?t=${Date.now()}`, { cache: "no-store" });
if (!configResponse.ok) throw new Error("No se ha podido cargar config.json");
const SETTINGS = await configResponse.json();
const REF_SECONDS = Number(SETTINGS.medidas.tiempo.referencia);
const REF_AMPS = Number(SETTINGS.medidas.intensidad.referencia);
const TOL_SECONDS = Number(SETTINGS.medidas.tiempo.tolerancia);
const TOL_AMPS = Number(SETTINGS.medidas.intensidad.tolerancia);
const CONFIG = {
  title: SETTINGS.app.titulo,
  levels: { initial: Number(SETTINGS.simulacion.niveles.inicial), remanent: Number(SETTINGS.simulacion.niveles.remanente), empty: Number(SETTINGS.simulacion.niveles.vacio) },
  simulation: {
    autoDrainMs: Number(SETTINGS.simulacion.vaciadoMs),
    thresholds: { stop: Number(SETTINGS.simulacion.umbrales.paro), run: Number(SETTINGS.simulacion.umbrales.marcha), alarm: Number(SETTINGS.simulacion.umbrales.alarma) },
    drainPerSecond: Number(SETTINGS.simulacion.descensoPorSegundo),
    floatAngle: Number(SETTINGS.simulacion.anguloBoya),
    buoyancyBand: Number(SETTINGS.simulacion.bandaFlotacion)
  }
};
const { levels, simulation } = CONFIG;
const configNumbers = [REF_SECONDS, REF_AMPS, TOL_SECONDS, TOL_AMPS, levels.initial, levels.remanent, levels.empty, simulation.autoDrainMs, simulation.thresholds.stop, simulation.thresholds.run, simulation.thresholds.alarm, simulation.drainPerSecond, simulation.floatAngle, simulation.buoyancyBand];
const levelNumbers = [levels.initial, levels.remanent, levels.empty, simulation.thresholds.stop, simulation.thresholds.run, simulation.thresholds.alarm];
if (!CONFIG.title || configNumbers.some((value) => !Number.isFinite(value)) || REF_SECONDS <= 0 || REF_AMPS <= 0 || TOL_SECONDS < 0 || TOL_AMPS < 0 || levelNumbers.some((value) => value < 0 || value > 100) || simulation.autoDrainMs <= 0 || simulation.drainPerSecond <= 0 || simulation.floatAngle <= 0 || simulation.buoyancyBand <= 0) throw new Error("config.json contiene valores no válidos");
const formatConfigNumber = (value) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(value);
const formatTimeReference = () => `${formatConfigNumber(REF_SECONDS)} s ± ${formatConfigNumber(TOL_SECONDS)} s`;
const formatAmpReference = () => `${formatConfigNumber(REF_AMPS)} A ± ${formatConfigNumber(TOL_AMPS)} A`;
const $ = (s) => document.querySelector(s);
const on = (selector, event, handler) => $(selector).addEventListener(event, handler);
const HOUR_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const createSimState = () => ({
  level: levels.initial,
  control: "auto",
  overrides: { stop: "auto", run: "auto", alarm: "auto" },
  latched: false,
  raf: 0,
  last: 0,
  elapsed: 0,
  dryRun: false
});
const state = {
  step: 0,
  pump: false,
  alarm: false,
  alarmPhase: 0,
  timer: null,
  start: 0,
  mode: "guide",
  waterLevel: levels.initial,
  sim: createSimState()
};
const sim = state.sim;
const ui = {};
["progress", "water", "pump", "lcd", "siren", "timer", "amps", "title", "stepTitle", "instructions", "actions", "notice", "result", "measurements", "guideMode", "simMode", "dryRunWarning", "discharge", "pipeWater", "mainView", "registerMode", "historyMode"].forEach((id) => ui[id] = $(`#${id}`));
Object.assign(ui, { stop: $("#stopFloat"), run: $("#runFloat"), alarm: $("#alarmFloat"), runLed: $("#runLed"), alarmLed: $("#alarmLed"), tank: $(".tank") });
document.title = CONFIG.title;
$("#measuredTime").placeholder = formatConfigNumber(REF_SECONDS);
$("#measuredAmp").placeholder = formatConfigNumber(REF_AMPS);
$("#ampsReference").textContent = `Referencia ${formatAmpReference()}`;
$("#timeReference").textContent = `Referencia ${formatTimeReference()}`;
const floatAngleAt = (name, level) => {
  const t = simulation.thresholds[name];
  const b = simulation.buoyancyBand;
  const p = Math.max(0, Math.min(1, (level - (t - b * 0.75)) / b));
  return simulation.floatAngle * p;
};
const floatRiseAt = (el, level) => {
  const base =
    parseFloat(getComputedStyle(el).getPropertyValue("--cable")) || 0;
  const surface = ui.tank.clientHeight * (1 - level / 100), target = surface - el.offsetTop - 28;
  return Math.min(0, Math.max(-Math.max(0, base - 58), target - base));
};
const drawCable = (el, rise = 0) => {
  const path = el.querySelector(".cable-path");
  if (!path) return;
  const base =
    parseFloat(getComputedStyle(el).getPropertyValue("--cable")) || 0;
  const x = 46,
    y = base + rise;
  if (rise < -3) {
    const slack = Math.min(46, -rise * 0.34);
    const neck = Math.max(24, Math.min(y - 28, base * 0.45));
    path.setAttribute(
      "d",
      `M${x} 0 L${x} ${neck} C${x} ${neck + 16} ${x + slack} ${Math.max(neck + 20, y - 16)} ${x} ${y}`
    );
  } else path.setAttribute("d", `M${x} 0 L${x} ${y}`);
};
const setFloatVisual = (el, angle, rise = 0) => {
  el.style.setProperty(
    "--float-angle",
    `${Math.max(0, Math.min(simulation.floatAngle, angle))}deg`
  );
  el.style.setProperty("--float-rise", `${rise}px`);
  drawCable(el, rise);
};
const updateGuideFloat = () => {
  if (state.mode === "guide" && ui.stop.classList.contains("up")) {
    setFloatVisual(
      ui.stop,
      floatAngleAt("stop", state.waterLevel),
      floatRiseAt(ui.stop, state.waterLevel)
    );
  }
};
const setWater = (h) => {
  state.waterLevel = h;
  ui.water.style.transitionDuration = state.mode === "sim" ? "0s" : "";
  ui.water.style.height = h + "%";
  if (!state.pump) ui.pipeWater.style.transitionDuration = "0s";
  ui.discharge.style.setProperty(
    "--pipe-level",
    Math.max(0, Math.min(100, h / 0.9)) + "%"
  );
  updateGuideFloat();
};
const setFloat = (el, on) => {
  el.classList.toggle("up", on);
  if (!on) return setFloatVisual(el, 0, 0);
  if (el === ui.stop && state.mode === "guide") {
    return setFloatVisual(
      el,
      floatAngleAt("stop", state.waterLevel),
      floatRiseAt(el, state.waterLevel)
    );
  }
  setFloatVisual(el, simulation.floatAngle, -30);
};
const updateLcd = () => {
  ui.lcd.innerHTML = state.alarm ? "ALARMA<br>BOYA ALTA" : state.pump ? `RUN<br>${REF_AMPS.toFixed(1)} A` : "AUTO";
};
const setPump = (on) => {
  const wasOn = state.pump;
  state.pump = on;
  if (state.mode === "sim" && on && !wasOn) {
    sim.elapsed = 0;
    sim.last = 0;
    ui.timer.textContent = "0.0 s";
  }
  ui.pipeWater.style.transitionDuration = on ? ".3s" : ".95s";
  ui.discharge.classList.toggle("pumping", on);
  ui.pump.classList.toggle("run", on);
  ui.runLed.classList.toggle("on", on);
  ui.amps.textContent = on ? `${REF_AMPS.toFixed(1)} A` : "—";
  updateLcd();
};
const setDryRun = (on) => {
  sim.dryRun = on;
  ui.pump.classList.toggle("dry-run", on);
  ui.dryRunWarning.classList.toggle("hidden", !on);
};
const setAlarm = (on, move = true) => {
  state.alarm = on;
  if (move) setFloat(ui.alarm, on);
  ui.alarmLed.classList.toggle("on", on);
  ui.siren.classList.toggle("on", on);
  updateLcd();
};
const simFloatState = (name) => {
  const o = sim.overrides[name];
  return (
    o === "up" ||
    (o === "auto" && sim.level >= simulation.thresholds[name])
  );
};
const simFloatAngle = (name) => {
  const o = sim.overrides[name];
  return o === "up"
    ? simulation.floatAngle
    : o === "down"
      ? 0
      : floatAngleAt(name, sim.level);
};
const simFloatRise = (name) => {
  const o = sim.overrides[name];
  const el = name === "stop" ? ui.stop : name === "run" ? ui.run : ui.alarm;
  if (o === "down") return 0;
  if (o === "up") return -30;
  return simFloatAngle(name) > 0 ? floatRiseAt(el, sim.level) : 0;
};
const floatText = (name, active) => {
  if (active) return "flotando";
  return simFloatAngle(name) > 8 ? "basculando" : "colgando";
};
const syncSimFloats = () => {
  const stop = simFloatState("stop"), run = simFloatState("run"), alarm = simFloatState("alarm");
  ["stop", "run", "alarm"].forEach((name) => setFloatVisual(ui[name], simFloatAngle(name), simFloatRise(name)));
  setAlarm(alarm, false);
  if (sim.control === "auto") {
    if (!sim.latched && stop && run) sim.latched = true;
    if (sim.latched && !stop) sim.latched = false;
    setPump(sim.latched);
  }
  setDryRun(state.pump && sim.level <= 0);
  $("#simStatus").innerHTML =
    `Nivel <b>${sim.level.toFixed(1)}%</b> · Tiempo <b>${sim.elapsed.toFixed(1)} s</b> · PARO <b>${floatText("stop", stop)}</b> · MARCHA <b>${floatText("run", run)}</b> · ALARMA <b>${alarm ? "activa" : floatText("alarm", false)}</b> · Bomba <b>${state.pump ? "ON" : "OFF"}</b>` +
    (sim.dryRun
      ? "<br><b>SIMULACIÓN:</b> bomba funcionando en vacío. Detener inmediatamente."
      : "");
};
const setSimLevel = (value) => {
  sim.level = Math.max(0, Math.min(75, Number(value) || 0));
  setWater(sim.level);
  $("#simLevel").value = sim.level;
  $("#simLevelValue").textContent = sim.level.toFixed(1) + "%";
  syncSimFloats();
  ensureSimDrain();
};
const stopSimDrain = () => {
  if (sim.raf) cancelAnimationFrame(sim.raf);
  sim.raf = sim.last = 0;
};
const stopTimer = () => {
  if (!state.timer) return false;
  clearInterval(state.timer);
  state.timer = null;
  return true;
};
const simDrainTick = (now) => {
  if (state.mode !== "sim" || !state.pump) {
    sim.raf = 0;
    sim.last = 0;
    return;
  }
  if (!sim.last) sim.last = now;
  const dt = Math.min((now - sim.last) / 1000, 0.1);
  sim.last = now;
  sim.elapsed += dt;
  ui.timer.textContent = sim.elapsed.toFixed(1) + " s";
  if (sim.level > 0) {
    setSimLevel(
      Math.max(0, sim.level - simulation.drainPerSecond * dt)
    );
  }
  if (sim.level <= 0 && state.pump) {
    setDryRun(true);
    $("#simStatus").innerHTML =
      `Nivel <b>0%</b> · Tiempo <b>${sim.elapsed.toFixed(1)} s</b> · Bomba <b>ON</b><br><b>SIMULACIÓN:</b> bomba funcionando en vacío. Vibración y calentamiento excesivos.`;
  }
  if (state.pump) sim.raf = requestAnimationFrame(simDrainTick);
  else {
    sim.raf = 0;
    sim.last = 0;
  }
};
const ensureSimDrain = () => {
  if (state.pump && !sim.raf) sim.raf = requestAnimationFrame(simDrainTick);
};
const renderSim = () => {
  $("#simLevel").value = sim.level;
  $("#simLevelValue").textContent = sim.level.toFixed(1) + "%";
  ["stop", "run", "alarm"].forEach((name) => $(`#sim${name[0].toUpperCase()}${name.slice(1)}`).value = sim.overrides[name]);
  const manual = sim.control === "manual";
  $("#simControlMode").textContent = sim.control.toUpperCase();
  $("#simAuto").classList.toggle("mode-active", !manual);
  $("#simManual").classList.toggle("mode-active", manual);
  $("#simPumpOn").disabled = $("#simPumpOff").disabled = !manual;
  syncSimFloats();
  ensureSimDrain();
};
const syncModeUi = () => {
  const main = state.mode === "guide" || state.mode === "sim";
  document.body.classList.toggle("simulating", state.mode === "sim");
  ui.mainView.classList.toggle("hidden", !main);
  ui.progress.classList.toggle("hidden", !main);
  [["guide", ui.guideMode], ["sim", ui.simMode], ["register", ui.registerMode], ["history", ui.historyMode]].forEach(([mode, panel]) => {
    const active = state.mode === mode;
    panel.classList.toggle("hidden", !active);
    $(`#${mode}Btn`).classList.toggle("mode-active", active);
  });
  $("#resetBtn").disabled = !main;
};
const enterMode = (mode) => {
  if (!["guide", "sim", "register", "history"].includes(mode)) return;
  stopTimer();
  stopSimDrain();
  state.mode = mode;
  syncModeUi();
  if (mode === "sim") {
    Object.assign(sim, createSimState());
    setPump(false);
    ui.timer.textContent = "0.0 s";
    setAlarm(false);
    setWater(sim.level);
    renderSim();
    return;
  }
  if (mode === "guide") {
    resetApp(false);
    return;
  }
  setPump(false);
  setDryRun(false);
  setAlarm(false);
  if (mode === "register") prepareRecordForm();
  if (mode === "history") loadHistory();
};
const animateWater = (from, to, duration, onFrame) =>
  new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      setWater(from + (to - from) * eased);
      if (onFrame) onFrame(p);
      if (p < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
const next = () => {
  state.step = Math.min(state.step + 1, STEPS.length - 1);
  render();
};
const fail = (m) => (ui.result.innerHTML = `<div class="result bad">${m}</div>`);
const ok = (m) => (ui.result.innerHTML = `<div class="result ok">${m}</div>`);
const autoDrain = async () => {
  setFloat(ui.run, false);
  let stopDropped = false;
  await animateWater(
    levels.initial,
    levels.remanent,
    simulation.autoDrainMs,
    (p) => {
      if (!stopDropped && p > 0.86) {
        stopDropped = true;
        setFloat(ui.stop, false);
      }
    }
  );
  setPump(false);
  next();
};
const startManual = () => {
  setPump(true);
  state.start = performance.now();
  state.timer = setInterval(() => {
    ui.timer.textContent =
      ((performance.now() - state.start) / 1000).toFixed(1) + " s";
  }, 100);
  setWater(levels.empty);
  ui.actions.innerHTML =
    '<button class="danger" id="stopNow">DETENER BOMBA</button>';
  on("#stopNow", "click", stopManual);
};
const stopManual = () => {
  if (!stopTimer()) return;
  const t = (performance.now() - state.start) / 1000;
  setPump(false);
  $("#measuredTime").value = t.toFixed(1);
  ui.actions.innerHTML =
    '<button class="good" id="compareBtn">Comparar resultados</button>';
  on("#compareBtn", "click", evaluate);
  ui.notice.innerHTML =
    '<div class="notice">Parada inmediata al detectar por sonido que la bomba empieza a quedarse sin agua. Nunca mantenerla trabajando en vacío.</div>';
};
const evaluate = () => {
  const t = Number($("#measuredTime").value);
  const a = Number($("#measuredAmp").value);
  if (!(t > 0) || !(a > 0)) {
    return fail(
      "Introduce el tiempo y la intensidad obtenidos en esta prueba guiada."
    );
  }
  const issues = [
    Math.abs(t - REF_SECONDS) > TOL_SECONDS &&
      `Tiempo fuera de rango (${REF_SECONDS - TOL_SECONDS}–${REF_SECONDS + TOL_SECONDS} s): revisar caudal, obstrucciones, impulsión y bomba.`,
    Math.abs(a - REF_AMPS) > TOL_AMPS + 0.0001 &&
      `Intensidad fuera de rango (${(REF_AMPS - TOL_AMPS).toFixed(1)}–${(REF_AMPS + TOL_AMPS).toFixed(1)} A): revisar carga, bomba y alimentación.`
  ].filter(Boolean);
  issues.length
    ? fail(issues.join("<br>"))
    : ok("Valores dentro de referencia.");
};
const STEPS = [
  { t: "Prueba de ALARMA", x: "Prueba independiente inicial: levanta manualmente la boya de <b>ALARMA</b>, comprueba las tres señales y vuelve a soltarla.", special: "alarm" },
  {
    t: "Comprobar PARO",
    x: "Con el depósito casi vacío, debe quedar agua por encima del remanente y la boya de <b>PARO</b> debe estar flotando.",
    action: () => setFloat(ui.stop, true),
    actionLabel: "Confirmar PARO flotando",
    confirm: () => ui.stop.classList.contains("up"),
    confirmLabel: "Continuar",
    fail: "Revisar nivel, libertad de movimiento, cable y estado de PARO."
  },
  {
    t: "Forzar MARCHA",
    x: "Con PARO flotando, levanta manualmente <b>MARCHA</b>. La bomba debe arrancar inmediatamente.",
    action: () => { setFloat(ui.run, true); setPump(true); },
    actionLabel: "Levantar MARCHA",
    confirm: () => state.pump,
    confirmLabel: "Confirmar que la bomba ha arrancado",
    fail: "Revisar MARCHA, PARO, controlador, protecciones, alimentación y bomba.",
    onConfirm: autoDrain
  },
  {
    t: "Vaciado automático",
    x: "Comprueba que la bomba se detiene cuando PARO deja de flotar. Debe quedar un <b>remanente visible por debajo de PARO</b> y alrededor de la bomba.",
    confirm: () => !state.pump && !ui.stop.classList.contains("up"),
    confirmLabel: "Vaciado correcto",
    fail: "Revisar PARO, cableado, lógica de control y controlador."
  },
  { t: "Preparar MANUAL", x: "Accede al <b>menú 7</b> del controlador y prepara el funcionamiento manual.", confirm: () => true, confirmLabel: "Modo manual preparado" },
  { t: "Vaciar remanente", x: "Arranca manualmente la bomba. Mide el tiempo y observa la intensidad. <b>Al cambiar el sonido por falta de agua, detén inmediatamente.</b>", n: "Nunca mantener la bomba trabajando en vacío.", special: "manual" },
  { t: "Comparar resultados", x: `Introduce los valores obtenidos. Referencias: <b>${formatTimeReference()}</b> y <b>${formatAmpReference()}</b>.`, special: "compare" },
  { t: "Guía completada", x: "Has completado la secuencia didáctica de la prueba. El registro de una prueba real se realiza de forma independiente desde Registrar prueba.", special: "end" }
];
function render() {
  ui.title.textContent = CONFIG.title;
  ui.progress.innerHTML =
    `<div class="progress-current"><b>${state.step + 1}/${STEPS.length}</b><span>${STEPS[state.step].t}</span></div>` +
    `<div class="progress-track">${STEPS.map((s, i) => `<div class="stepdot ${i === state.step ? "active" : i < state.step ? "done" : ""}" title="${i + 1}. ${s.t}"><i>${i + 1}</i></div>`).join("")}</div>`;
  const s = STEPS[state.step];
  ui.stepTitle.textContent = `${state.step + 1}. ${s.t}`;
  ui.instructions.innerHTML = s.x;
  ui.notice.innerHTML = s.n ? `<div class="notice">${s.n}</div>` : "";
  ui.result.innerHTML = "";
  ui.measurements.style.display =
    s.special === "manual" || s.special === "compare" ? "grid" : "none";
  if (s.special === "alarm") {
    const phases = [
      [
        '<button class="primary" id="alarmAction">Levantar ALARMA</button>',
        () => {
          setAlarm(true);
          state.alarmPhase = 1;
          render();
        }
      ],
      [
        '<button class="good" id="alarmAction">Sirena + LED + mensaje funcionan</button><button id="alarmFail">Falla alguna señal</button>',
        () => {
          state.alarmPhase = 2;
          render();
        }
      ],
      [
        '<button class="primary" id="alarmAction">Soltar ALARMA</button>',
        () => {
          setAlarm(false);
          state.alarmPhase = 3;
          render();
        }
      ],
      [
        '<button class="good" id="alarmAction">Prueba de ALARMA completada</button>',
        () => {
          state.alarmPhase = 0;
          next();
        }
      ]
    ];
    const [markup, fn] = phases[state.alarmPhase];
    ui.actions.innerHTML = markup;
    on("#alarmAction", "click", fn);
    const alarmFail = $("#alarmFail");
    if (alarmFail) {
      alarmFail.addEventListener("click", () =>
        fail(
          "Revisar boya de ALARMA, sirena exterior, LED rojo, mensaje en pantalla, cableado y configuración."
        )
      );
    }
    return;
  }
  if (s.special === "manual") {
    ui.actions.innerHTML =
      '<button class="primary" id="manualBtn">Iniciar prueba manual</button>';
    on("#manualBtn", "click", startManual);
    return;
  }
  if (s.special === "compare") {
    ui.actions.innerHTML =
      '<button class="good" id="compareBtn">Comparar resultados</button><button id="nextBtn">Continuar</button>';
    on("#compareBtn", "click", evaluate);
    on("#nextBtn", "click", next);
    return;
  }
  if (s.special === "end") {
    ui.actions.innerHTML =
      '<button class="primary" id="restartGuide">Repetir guía</button>';
    on("#restartGuide", "click", () => resetApp());
    return;
  }
  const buttons = [];
  if (s.action) {
    buttons.push(
      `<button class="primary" id="actionBtn">${s.actionLabel}</button>`
    );
  }
  buttons.push(
    `<button class="good" id="confirmBtn">${s.confirmLabel}</button>`
  );
  if (s.fail) {
    buttons.push('<button id="failBtn">No funciona correctamente</button>');
  }
  ui.actions.innerHTML = buttons.join("");
  if (s.action) {
    on("#actionBtn", "click", s.action);
  }
  on("#confirmBtn", "click", async () => {
    if (!s.confirm()) {
      return fail(
        "Realiza primero la acción indicada y comprueba el resultado."
      );
    }
    if (s.onConfirm) await s.onConfirm();
    else next();
  });
  if (s.fail) {
    on("#failBtn", "click", () => fail(s.fail));
  }
}
const pad2 = (n) => String(n).padStart(2, "0");
const localDateValue = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const recordStatusKeys = ["pruebaAlarma", "boyaParo", "forzarMarcha", "vaciadoAutomatico", "modoManual"];
const calculateRecordResult = (record) => {
  const statuses = recordStatusKeys.map((key) => record[key]);
  const time = Number(record.tiempoRemanenteReal);
  const amps = Number(record.intensidadReal);
  if (statuses.some((value) => !value) || !(time > 0) || !(amps > 0)) return "";
  const checksOk = statuses.every((value) => value === "OK");
  const timeOk = Math.abs(time - REF_SECONDS) <= TOL_SECONDS;
  const ampsOk = Math.abs(amps - REF_AMPS) <= TOL_AMPS + 0.0001;
  return checksOk && timeOk && ampsOk ? "OK" : "Revisar";
};
const readRecordForm = () => ({
  fecha: $("#recordDate").value,
  hora: $("#recordHour").value,
  realizadoPor: $("#recordBy").value.trim(),
  pruebaAlarma: $("#recordAlarm").value,
  boyaParo: $("#recordStop").value,
  forzarMarcha: $("#recordRun").value,
  vaciadoAutomatico: $("#recordDrain").value,
  modoManual: $("#recordManual").value,
  tiempoRemanenteReal: Number($("#recordTime").value),
  intensidadReal: Number($("#recordAmps").value),
  observaciones: $("#recordNotes").value.trim()
});
const buildRecord = () => {
  const record = readRecordForm();
  return { ...record, resultadoGlobal: calculateRecordResult(record) };
};
const setRecordResultVisual = (result) => {
  const el = $("#recordResult");
  el.textContent = result || "Pendiente";
  el.className = `record-result ${result === "OK" ? "ok" : result === "Revisar" ? "review" : "pending"}`;
};
const setMeasurementVisual = (selector, value, reference, tolerance, unit) => {
  const el = $(selector);
  const raw = el.value.trim();
  el.classList.remove("field-ok", "field-review");
  el.removeAttribute("aria-invalid");
  el.title = `Rango OK: ${formatConfigNumber(reference - tolerance)}–${formatConfigNumber(reference + tolerance)} ${unit}`;
  if (!raw) return;
  const ok = Number.isFinite(value) && value > 0 && Math.abs(value - reference) <= tolerance + 0.0001;
  el.classList.add(ok ? "field-ok" : "field-review");
  el.setAttribute("aria-invalid", String(!ok));
};
const updateRecordResult = () => {
  const record = readRecordForm();
  setMeasurementVisual("#recordTime", record.tiempoRemanenteReal, REF_SECONDS, TOL_SECONDS, "s");
  setMeasurementVisual("#recordAmps", record.intensidadReal, REF_AMPS, TOL_AMPS, "A");
  setRecordResultVisual(calculateRecordResult(record));
};
const syncStatusToggle = (toggle, value) => {
  const input = document.getElementById(toggle.dataset.input);
  input.value = value;
  toggle.querySelectorAll(".status-option").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
};
const resetRecordToggles = () => document.querySelectorAll(".status-toggle").forEach((toggle) => syncStatusToggle(toggle, ""));
const setRecordMessage = (text = "", type = "") => {
  const message = $("#recordMessage");
  message.textContent = text;
  message.className = `form-message${type ? ` ${type}` : ""}`;
};
const prepareRecordForm = () => {
  if (!$("#recordDate").value) $("#recordDate").value = localDateValue();
  setRecordMessage();
  updateRecordResult();
};
const downloadRecord = (record) => {
  const now = new Date();
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const filename = `${record.fecha}_${time}.json`;
  const blob = new Blob([JSON.stringify(record, null, 2) + "\n"], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
};
const validateRecord = (record) => {
  const statuses = recordStatusKeys.map((key) => record[key]);
  if (!record.fecha || !HOUR_RE.test(record.hora || "") || !record.realizadoPor || statuses.some((value) => !value)) return "Completa todos los campos obligatorios.";
  if (!(record.tiempoRemanenteReal > 0) || !(record.intensidadReal > 0)) return "Tiempo e intensidad deben ser valores mayores que cero.";
  const expectedResult = calculateRecordResult(record);
  if (!expectedResult || record.resultadoGlobal !== expectedResult) return "No se ha podido calcular correctamente el resultado global.";
  return "";
};
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const parseRecordTimestamp = (path, record) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(record.fecha || "") && HOUR_RE.test(record.hora || "")) {
    const [y, m, d] = record.fecha.split("-").map(Number);
    const [hh, mm] = record.hora.split(":").map(Number);
    return Date.UTC(y, m - 1, d, hh, mm);
  }
  const name = path.split("/").pop() || "";
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})?\.json$/);
  if (match) {
    const [, y, m, d, hh, mm, ss = "00"] = match;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  const parts = String(record.fecha || "").split("-").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }
  return 0;
};
const formatRecordMoment = (item) => {
  if (!item.timestamp) return item.record.fecha || "Sin fecha";
  const d = new Date(item.timestamp);
  const date = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  if (HOUR_RE.test(item.record.hora || "")) return `${date} ${item.record.hora}`;
  const name = item.path.split("/").pop() || "";
  const hasTime = /_\d{4,6}\.json$/.test(name);
  return hasTime ? `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : date;
};
const showRecord = (item) => {
  const r = item.record;
  const rows = [
    ["Fecha", r.fecha],
    ["Hora", r.hora || "No registrada"],
    ["Realizado por", r.realizadoPor],
    ["Prueba ALARMA", r.pruebaAlarma, true],
    ["Boya PARO flotando", r.boyaParo, true],
    ["Forzar MARCHA con PARO flotando", r.forzarMarcha, true],
    ["Vaciado automático / parada al caer PARO", r.vaciadoAutomatico, true],
    ["Modo manual preparado", r.modoManual, true],
    ["Tiempo remanente real", `${Number(r.tiempoRemanenteReal).toFixed(1)} s`],
    ["Intensidad real", `${Number(r.intensidadReal).toFixed(1)} A`],
    ["Resultado global", r.resultadoGlobal, true],
    ["Observaciones", r.observaciones || "—"]
  ];
  $("#recordModalTitle").textContent = `Prueba · ${formatRecordMoment(item)}`;
  $("#recordModalBody").innerHTML = rows
    .map(([label, value, status]) => {
      const cls = status
        ? value === "OK"
          ? "status-ok"
          : "status-review"
        : "";
      return `<dt>${escapeHtml(label)}</dt><dd class="${cls}">${escapeHtml(value)}</dd>`;
    })
    .join("");
  $("#recordModal").classList.remove("hidden");
  $("#closeRecordModal").focus();
};
const hideRecord = () => $("#recordModal").classList.add("hidden");
const renderChart = (container, items, key, unit, reference, tolerance) => {
  const values = items.map((item) => Number(item.record[key])).filter(Number.isFinite);
  if (!values.length) {
    container.innerHTML = "";
    return;
  }
  const width = 960, height = 320, left = 66, right = 24, top = 22, bottom = 56;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const lowerRef = reference - tolerance, upperRef = reference + tolerance;
  let yMin = Math.min(...values, lowerRef);
  let yMax = Math.max(...values, upperRef);
  const span = Math.max(yMax - yMin, key === "intensidadReal" ? 0.4 : 8);
  yMin -= span * 0.18;
  yMax += span * 0.18;
  const times = items.map((item) => item.timestamp);
  const minT = Math.min(...times), maxT = Math.max(...times);
  const xAt = (item, index) => {
    if (maxT === minT) return left + (items.length === 1 ? plotW / 2 : (index / (items.length - 1)) * plotW);
    return left + ((item.timestamp - minT) / (maxT - minT)) * plotW;
  };
  const yAt = (value) => top + ((yMax - value) / (yMax - yMin)) * plotH;
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  const labelIndexes = new Set();
  const tickCount = Math.min(6, items.length);
  for (let i = 0; i < tickCount; i++) {
    labelIndexes.add(Math.round((i * (items.length - 1)) / Math.max(1, tickCount - 1)));
  }
  const points = items.map((item, i) => [xAt(item, i), yAt(Number(item.record[key]))]);
  const path = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const bandTop = yAt(upperRef), bandBottom = yAt(lowerRef);
  const grid = yTicks
    .map((v) => {
      const y = yAt(v);
      const label = key === "intensidadReal" ? v.toFixed(1) : v.toFixed(0);
      return `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"></line><text class="chart-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${label}</text>`;
    })
    .join("");
  const xLabels = items
    .map((item, i) => {
      if (!labelIndexes.has(i)) return "";
      const x = xAt(item, i);
      const d = new Date(item.timestamp);
      const label = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
      return `<text class="chart-label" x="${x}" y="${height - 20}" text-anchor="middle">${label}</text>`;
    })
    .join("");
  const circles = items
    .map((item, i) => {
      const [x, y] = points[i];
      const value = Number(item.record[key]);
      return `<circle class="chart-point" tabindex="0" role="button" aria-label="${escapeHtml(formatRecordMoment(item))}: ${value.toFixed(1)} ${unit}" data-record-index="${i}" cx="${x}" cy="${y}" r="6"><title>${escapeHtml(formatRecordMoment(item))} · ${value.toFixed(1)} ${unit}</title></circle>`;
    })
    .join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-label="Gráfica histórica"><rect class="chart-band" x="${left}" y="${bandTop}" width="${plotW}" height="${Math.max(0, bandBottom - bandTop)}"></rect>${grid}<line class="chart-axis" x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}"></line><line class="chart-axis" x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}"></line><line class="chart-ref" x1="${left}" x2="${width - right}" y1="${yAt(reference)}" y2="${yAt(reference)}"></line><path class="chart-line" d="${path}"></path>${circles}${xLabels}</svg>`;
  container.querySelectorAll(".chart-point").forEach((point) => {
    const open = () => showRecord(items[Number(point.dataset.recordIndex)]);
    point.addEventListener("click", open);
    point.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
};
const loadHistory = async () => {
  const status = $("#historyStatus");
  const charts = $("#historyCharts");
  status.textContent = "Cargando registros…";
  charts.classList.add("hidden");
  try {
    const indexResponse = await fetch(`./data/index.json?t=${Date.now()}`, { cache: "no-store" });
    if (!indexResponse.ok) throw new Error("No se ha podido cargar data/index.json");
    const indexData = await indexResponse.json();
    const files = Array.isArray(indexData) ? indexData : indexData.files;
    if (!Array.isArray(files)) throw new Error("El índice de registros no es válido");
    if (!files.length) {
      status.textContent = "Todavía no hay registros en data/pruebas/.";
      return;
    }
    const loaded = await Promise.all(
      files.map(async (path) => {
        const response = await fetch(`./${path}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`No se ha podido cargar ${path}`);
        const record = await response.json();
        return { path, record, timestamp: parseRecordTimestamp(path, record) };
      })
    );
    const items = loaded
      .filter((item) => Number.isFinite(Number(item.record.intensidadReal)) && Number.isFinite(Number(item.record.tiempoRemanenteReal)))
      .sort((a, b) => a.timestamp - b.timestamp || a.path.localeCompare(b.path));
    if (!items.length) {
      status.textContent = "No hay registros válidos para representar.";
      return;
    }
    status.textContent = `${items.length} ${items.length === 1 ? "registro cargado" : "registros cargados"}. Pulsa cualquier punto para ver la prueba completa.`;
    renderChart($("#ampsChart"), items, "intensidadReal", "A", REF_AMPS, TOL_AMPS);
    renderChart($("#timeChart"), items, "tiempoRemanenteReal", "s", REF_SECONDS, TOL_SECONDS);
    charts.classList.remove("hidden");
  } catch (error) {
    status.textContent = `No se ha podido cargar el histórico: ${error.message}`;
  }
};
const resetApp = (switchMode = true) => {
  stopTimer();
  stopSimDrain();
  Object.assign(state, {
    step: 0,
    pump: false,
    alarm: false,
    alarmPhase: 0,
    start: 0,
    waterLevel: levels.initial
  });
  Object.assign(sim, createSimState());
  if (switchMode) state.mode = "guide";
  setPump(false);
  setDryRun(false);
  setAlarm(false);
  setWater(levels.initial);
  setFloat(ui.stop, true);
  setFloat(ui.run, false);
  setFloat(ui.alarm, false);
  ui.timer.textContent = "0.0 s";
  ui.amps.textContent = "—";
  $("#measuredTime").value = "";
  $("#measuredAmp").value = "";
  syncModeUi();
  state.mode === "sim" ? renderSim() : state.mode === "guide" && render();
};
[["guideBtn", "guide"], ["simBtn", "sim"], ["registerBtn", "register"], ["historyBtn", "history"]].forEach(([id, mode]) => on(`#${id}`, "click", () => enterMode(mode)));
on("#resetBtn", "click", () => resetApp());
on("#reloadHistory", "click", loadHistory);
on("#closeRecordModal", "click", hideRecord);
on("#recordModal", "click", (event) => {
  if (event.target === $("#recordModal")) hideRecord();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#recordModal").classList.contains("hidden")) hideRecord();
});
document.querySelectorAll(".status-toggle").forEach((toggle) => {
  toggle.addEventListener("click", (event) => {
    const button = event.target.closest(".status-option");
    if (!button) return;
    syncStatusToggle(toggle, button.dataset.value);
    updateRecordResult();
  });
});
on("#recordHour", "input", (event) => {
  const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
  event.target.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
});
on("#recordHour", "blur", (event) => {
  const digits = event.target.value.replace(/\D/g, "");
  if (digits.length === 3) event.target.value = `0${digits[0]}:${digits.slice(1)}`;
});
on("#recordForm", "input", updateRecordResult);
on("#recordForm", "change", updateRecordResult);
on("#recordForm", "submit", (event) => {
  event.preventDefault();
  const record = buildRecord();
  const error = validateRecord(record);
  if (error) return setRecordMessage(error, "bad");
  const filename = downloadRecord(record);
  setRecordMessage(`Registro generado: ${filename}`, "ok");
});
on("#recordForm", "reset", () => {
  setTimeout(() => {
    $("#recordDate").value = localDateValue();
    setRecordMessage();
    resetRecordToggles();
    updateRecordResult();
  }, 0);
});
on("#simLevel", "input", (e) => setSimLevel(e.target.value));
const setSimControl = (control) => {
  if (sim.control === control) return;
  sim.control = control;
  sim.latched = false;
  setDryRun(false);
  setPump(false);
  sim.elapsed = 0;
  ui.timer.textContent = "0.0 s";
  renderSim();
};
[
  ["simStop", "stop"],
  ["simRun", "run"],
  ["simAlarm", "alarm"]
].forEach(([id, name]) => {
  $("#" + id).addEventListener("change", (e) => {
    sim.overrides[name] = e.target.value;
    syncSimFloats();
    ensureSimDrain();
  });
});
on("#simAuto", "click", () => setSimControl("auto"));
on("#simManual", "click", () => setSimControl("manual"));
on("#simPumpOn", "click", () => {
  if (sim.control !== "manual") return;
  setDryRun(sim.level <= 0);
  setPump(true);
  renderSim();
});
on("#simPumpOff", "click", () => {
  if (sim.control !== "manual") return;
  setPump(false);
  setDryRun(false);
  stopSimDrain();
  renderSim();
});
[
  ["stopFloat", "stop"],
  ["runFloat", "run"],
  ["alarmFloat", "alarm"]
].forEach(([id, name]) => {
  $("#" + id).addEventListener("click", () => {
    if (state.mode !== "sim") return;
    sim.overrides[name] =
      simFloatAngle(name) > simulation.floatAngle * 0.5 ? "down" : "up";
    $("#sim" + name[0].toUpperCase() + name.slice(1)).value =
      sim.overrides[name];
    syncSimFloats();
    ensureSimDrain();
  });
});
setWater(levels.initial);
setFloat(ui.stop, true);
setFloat(ui.run, false);
setFloat(ui.alarm, false);
render();
})().catch((error) => {
  const app = document.querySelector(".app");
  if (app) app.innerHTML = `<div class="card" style="padding:16px"><b>Error de configuración</b><div>${String(error.message || error)}</div></div>`;
});
