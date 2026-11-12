/**
 * ==============================================================================
 * APLICACIÓN DE CONTROL DE PISO TEXTIL - SaaS EN LA NUBE (V2.0)
 * Lógica Completa: Navegación Superior, Buscadores Mágicos, Calidad, Barras Apiladas,
 * Calculadora de Capacidad y Edición de SAMs
 * ==============================================================================
 */

// Helper para obtener la instancia de base de datos garantizada
function getDb() {
  const client = window.supabaseClient || window.supabase;
  if (!client || typeof client.from !== "function") {
    throw new Error("El cliente de Supabase no está listo. Recarga la página.");
  }
  return client;
}

// Paleta de colores para Órdenes en la Gráfica de Barras Apiladas
const OP_COLORS = [
  "#4f46e5", "#059669", "#d97706", "#0284c7", 
  "#dc2626", "#7c3aed", "#db2777", "#0891b2"
];

// Estado global de la aplicación
const appState = {
  empresa: null,
  bloquesHorarios: [],
  ordenes: [],
  prendas: [],
  operaciones: [],
  operarias: [],
  registrosCostura: [],
  registrosTerminadas: [], // Prendas finalizadas hora a hora
  subRegistroActivo: "costura", // "costura" o "terminadas"
  isAdmin: false,
  adminPin: "1234",
  isGerente: false,
  gerentePin: "2026",
  charts: {},
  prendasImportBuffer: null,
  operariasImportBuffer: null
};

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    showLoader(true, "Iniciando sistema textil...");
    await cargarDatosEmpresa();
    await cargarMaestros();
    generarBloquesHorarios();
    autoDetectHoraTurno();
    inicializarFiltrosDashboard();
    configurarTodosLosBuscadoresMagicos();
    
    if (localStorage.getItem("retoos_is_admin") === "true") {
      activarModoAdmin(true, false);
    }
    if (localStorage.getItem("retoos_is_gerente") === "true") {
      appState.isGerente = true;
    }

    // Listener para botón flotante "Volver Arriba" en Admin
    window.addEventListener("scroll", () => {
      const btnFloat = document.getElementById("btn-floating-top");
      if (!btnFloat) return;
      if (window.scrollY > 350 && document.body.classList.contains("theme-admin")) {
        btnFloat.classList.add("visible");
      } else {
        btnFloat.classList.remove("visible");
      }
    });

    switchView("registro");
    lucide.createIcons();
    showLoader(false);
  } catch (error) {
    showLoader(false);
    console.error("Error al iniciar aplicación:", error);
    showToast("Error de conexión: " + error.message, "error");
  }
});

// ==============================================================================
// 1. NAVEGACIÓN ENTRE MÓDULOS (Punto 1 y 10: Temas Diferenciados)
// ==============================================================================
function switchView(viewId) {
  if (viewId === "admin" && !appState.isAdmin) {
    abrirModalAdminPin();
    return;
  }
  if (viewId === "gerencial" && !appState.isGerente) {
    abrirModalGerencialPin();
    return;
  }

  // Actualizar vistas
  document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".top-nav-btn").forEach(b => b.classList.remove("active"));

  const targetView = document.getElementById("view-" + viewId);
  const targetBtn = document.getElementById("nav-btn-" + viewId);

  if (targetView) targetView.classList.add("active");
  if (targetBtn) targetBtn.classList.add("active");

  // Punto 10: Cambiar clase del body para activar paleta cromática del módulo
  document.body.className = "theme-" + viewId;

  if (viewId === "dashboard") {
    // Rendimiento instantáneo: si ya existen registros en memoria, pintar de inmediato (0ms lag)
    const ordenFiltro = document.getElementById("dash-filter-orden")?.value || "";
    renderizarProgresoOrdenes(ordenFiltro);
    renderizarBarrasApiladasHorarias(ordenFiltro);
    renderizarTablaEficiencias();
    renderizarDetalleOperaciones();

    // Actualización silenciosa en segundo plano sin congelar la pantalla
    actualizarDashboard(false);
  } else if (viewId === "gerencial") {
    cargarDatosGerenciales();
  } else if (viewId === "admin") {
    cargarDatosAdmin();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
  lucide.createIcons();
}

// Alternar entre Avance de Costura y Salida de Prendas (Punto 2)
function switchSubRegistro(subMode) {
  appState.subRegistroActivo = subMode;
  document.querySelectorAll(".reg-mode-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".reg-panel").forEach(p => p.classList.remove("active"));

  document.getElementById(`btn-subreg-${subMode}`).classList.add("active");
  document.getElementById(`panel-subreg-${subMode}`).classList.add("active");
  lucide.createIcons();
}

// ==============================================================================
// 2. CARGA DE DATOS DE BASE DE DATOS
// ==============================================================================
async function cargarDatosEmpresa() {
  const { data, error } = await getDb()
    .from("empresas")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error("No se pudo cargar la información de la empresa.");
  }

  appState.empresa = data;
  document.getElementById("header-company-name").textContent = `${data.nombre_empresa} • Planta Activa`;
}

async function cargarMaestros() {
  const empresaId = appState.empresa.id;

  const { data: ordenesData } = await getDb()
    .from("ordenes_produccion")
    .select("*, prendas(id, referencia, descripcion, sam_total)")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false });
  appState.ordenes = ordenesData || [];

  const { data: prendasData } = await getDb()
    .from("prendas")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("referencia");
  appState.prendas = prendasData || [];

  const { data: opsData } = await getDb()
    .from("operaciones_prenda")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("codigo_operacion");
  appState.operaciones = opsData || [];

  const { data: operariasData } = await getDb()
    .from("operarias")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("nombre");
  appState.operarias = operariasData || [];
}

// ==============================================================================
// 3. HORARIOS DINÁMICOS & DETECCIÓN AUTOMÁTICA
// ==============================================================================
function generarBloquesHorarios() {
  const cfg = appState.empresa.config_turnos || {
    hora_inicio: "06:00",
    duracion_bloque_min: 60,
    total_horas: 10,
    hora_almuerzo: 4,
    minutos_almuerzo: 30
  };

  const [hIni, mIni] = cfg.hora_inicio.split(":").map(Number);
  let minutoActual = hIni * 60 + mIni;

  appState.bloquesHorarios = [];

  for (let h = 1; h <= cfg.total_horas; h++) {
    const inicioMin = minutoActual;
    const finMin = inicioMin + cfg.duracion_bloque_min;

    const formatoHora = (min) => {
      const hh = Math.floor(min / 60) % 24;
      const mm = min % 60;
      const ampm = hh >= 12 ? "pm" : "am";
      const h12 = hh % 12 || 12;
      return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
    };

    const label = `H${h} — ${formatoHora(inicioMin)} a ${formatoHora(finMin)}`;
    appState.bloquesHorarios.push({
      valor: h,
      inicio: inicioMin,
      fin: finMin,
      duracion: cfg.duracion_bloque_min,
      label
    });

    minutoActual = finMin;
    if (h === cfg.hora_almuerzo && cfg.minutos_almuerzo > 0) {
      minutoActual += cfg.minutos_almuerzo;
    }
  }
}

function autoDetectHoraTurno() {
  const ahora = new Date();
  const minutosDesdeMedianoche = ahora.getHours() * 60 + ahora.getMinutes();
  let bloqueDetectado = 1;

  for (const bloque of appState.bloquesHorarios) {
    if (minutosDesdeMedianoche >= bloque.inicio && minutosDesdeMedianoche < bloque.fin) {
      bloqueDetectado = bloque.valor;
      break;
    }
  }

  // Establecer en ambos formularios
  const bloqueObj = appState.bloquesHorarios.find(b => b.valor === bloqueDetectado);
  const labelDetectada = bloqueObj ? bloqueObj.label : `H${bloqueDetectado}`;

  const inputHoraCostura = document.getElementById("ss-reg-hora-input");
  const hiddenHoraCostura = document.getElementById("reg-hora");
  if (inputHoraCostura && hiddenHoraCostura) {
    inputHoraCostura.value = labelDetectada;
    hiddenHoraCostura.value = bloqueDetectado;
  }

  const inputHoraTerm = document.getElementById("ss-reg-term-hora-input");
  const hiddenHoraTerm = document.getElementById("reg-term-hora");
  if (inputHoraTerm && hiddenHoraTerm) {
    inputHoraTerm.value = labelDetectada;
    hiddenHoraTerm.value = bloqueDetectado;
  }
}

// ==============================================================================
// 4. CONFIGURACIÓN DE BUSCADORES MÁGICOS UNIVERSALES (Punto 5)
// ==============================================================================
function configurarTodosLosBuscadoresMagicos() {
  // 1. Selector Horas Turno (Costura)
  const itemsHoras = appState.bloquesHorarios.map(b => ({ value: b.valor, label: b.label }));
  initSearchableSelect("ss-reg-hora", "ss-reg-hora-input", "ss-reg-hora-list", "reg-hora", itemsHoras, "Seleccionar hora...");

  // 2. Selector Horas Turno (Prendas Terminadas)
  initSearchableSelect("ss-reg-term-hora", "ss-reg-term-hora-input", "ss-reg-term-hora-list", "reg-term-hora", itemsHoras, "Seleccionar hora...");

  // 3. Órdenes Activas
  const ordenesActivas = appState.ordenes
    .filter(o => o.estado === "activa")
    .map(o => ({
      value: o.id,
      label: `${o.numero_op} — Ref: ${o.prendas?.referencia || 'Sin ref'} (Meta: ${o.cantidad_programada})`,
      prenda_id: o.prenda_id
    }));

  initSearchableSelect("ss-reg-orden", "ss-reg-orden-input", "ss-reg-orden-list", "reg-orden", ordenesActivas, "Buscar orden activa...", alSeleccionarOrdenCostura);
  initSearchableSelect("ss-reg-term-orden", "ss-reg-term-orden-input", "ss-reg-term-orden-list", "reg-term-orden", ordenesActivas, "Buscar orden activa...");

  // 4. Operarias Activas
  const operariasActivas = appState.operarias
    .filter(op => op.estado === "activa")
    .map(op => ({
      value: op.id,
      label: `${op.codigo_operaria ? '[' + op.codigo_operaria + '] ' : ''}${op.nombre}`
    }));
  initSearchableSelect("ss-operaria", "ss-operaria-input", "ss-operaria-list", "reg-operaria", operariasActivas, "Buscar operaria...");

  // 5. Operaciones (Inicialmente vacías hasta que elija OP)
  initSearchableSelect("ss-operacion", "ss-operacion-input", "ss-operacion-list", "reg-operacion", [], "Primero seleccione una orden...");

  // 6. Motivos de Defecto (Punto 4)
  const motivosDefecto = [
    { value: "Sin defectos", label: "✓ Sin defectos (100% Conforme)" },
    { value: "Costura torcida", label: "⚠️ Costura torcida / desalineada" },
    { value: "Salto de puntada", label: "⚠️ Salto de puntada / hilo reventado" },
    { value: "Medida incorrecta", label: "⚠️ Medida fuera de tolerancia" },
    { value: "Tela picada", label: "⚠️ Tela picada / aguja rota" },
    { value: "Mancha / suciedad", label: "⚠️ Mancha de aceite / suciedad" },
    { value: "Descalce de piezas", label: "⚠️ Descalce de piezas / corte defectuoso" },
    { value: "Otro defecto", label: "⚠️ Otro defecto de confección" }
  ];
  initSearchableSelect("ss-term-defecto-motivo", "ss-term-defecto-input", "ss-term-defecto-list", "reg-term-motivo", motivosDefecto, "Seleccionar defecto...");

  // 7. Filtro OP en Dashboard
  const itemsFiltroOP = [
    { value: "", label: "Todas las órdenes" },
    ...appState.ordenes.map(o => ({ value: o.id, label: `${o.numero_op} — Ref: ${o.prendas?.referencia || ''}` }))
  ];
  initSearchableSelect("ss-dash-orden", "ss-dash-orden-input", "ss-dash-orden-list", "dash-filter-orden", itemsFiltroOP, "Todas las órdenes");

  // 8. Selectores de Prendas en Admin
  const itemsPrendas = appState.prendas.map(p => ({
    value: p.id,
    label: `${p.referencia} — ${p.descripcion || ''}`,
    sam_total: p.sam_total
  }));
  initSearchableSelect("ss-admin-op-prenda", "ss-admin-op-prenda-input", "ss-admin-op-prenda-list", "admin-op-prenda", itemsPrendas, "Buscar prenda...", calcularProyeccionEntregaEnForm);
  initSearchableSelect("ss-admin-op-add-prenda", "ss-admin-op-add-prenda-input", "ss-admin-op-add-prenda-list", "admin-operacion-prenda", itemsPrendas, "Buscar prenda...");
}

// Al seleccionar OP en registro de costura, filtrar operaciones de esa prenda
function alSeleccionarOrdenCostura(itemSeleccionado) {
  const orden = appState.ordenes.find(o => o.id === itemSeleccionado.value);
  const containerInfoPrenda = document.getElementById("reg-prenda-info");

  if (!orden || !orden.prenda_id) {
    if (containerInfoPrenda) containerInfoPrenda.style.display = "none";
    return;
  }

  // Filtrar operaciones de esa prenda específica
  const opsPrenda = appState.operaciones
    .filter(op => op.prenda_id === orden.prenda_id)
    .map(op => ({
      value: op.id,
      label: `[${op.codigo_operacion}] ${op.nombre_operacion} (SAM: ${op.sam} min)`,
      sam: op.sam
    }));

  const wrapper = document.getElementById("ss-operacion");
  const input = document.getElementById("ss-operacion-input");
  const list = document.getElementById("ss-operacion-list");
  const hidden = document.getElementById("reg-operacion");

  hidden.value = "";
  input.value = "";
  wrapper._items = opsPrenda;
  renderDropdownItems(list, hidden, input, opsPrenda, "");

  if (containerInfoPrenda) {
    containerInfoPrenda.style.display = "block";
    const ref = orden.prendas ? orden.prendas.referencia : "Prenda";
    containerInfoPrenda.innerHTML = `<i data-lucide="tag"></i> Prenda: <strong>${ref}</strong> &bull; Total Operaciones: <strong>${opsPrenda.length}</strong>`;
    lucide.createIcons();
  }
}

// Componente Searchable Select Reutilizable
function initSearchableSelect(wrapperId, inputId, listId, hiddenId, items, placeholder, onSelectCallback) {
  const wrapper = document.getElementById(wrapperId);
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const hidden = document.getElementById(hiddenId);

  if (!wrapper || !input || !list || !hidden) return;

  wrapper._items = items;
  input.placeholder = placeholder || "Buscar...";

  renderDropdownItems(list, hidden, input, items, "", onSelectCallback);

  input.addEventListener("focus", () => {
    closeAllDropdowns(listId);
    wrapper.classList.add("open");
    list.classList.add("open");
    renderDropdownItems(list, hidden, input, wrapper._items || [], "", onSelectCallback);
  });

  input.addEventListener("input", () => {
    if (!list.classList.contains("open")) {
      list.classList.add("open");
    }
    renderDropdownItems(list, hidden, input, wrapper._items || [], input.value, onSelectCallback);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      list.classList.remove("open");
      wrapper.classList.remove("open");
      const currentVal = hidden.value;
      const found = (wrapper._items || []).find(i => String(i.value) === String(currentVal));
      if (found) input.value = found.label;
      else if (!currentVal) input.value = "";
    }, 250);
  });
}

function renderDropdownItems(list, hidden, input, items, query, onSelectCallback) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(item => item.label.toLowerCase().includes(q))
    : items;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="ss-empty">No se encontraron resultados</div>';
    return;
  }

  let html = "";
  filtered.forEach(item => {
    const isActive = hidden.value === String(item.value) ? " active" : "";
    html += `<div class="ss-option${isActive}" data-value="${item.value}" data-label="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>`;
  });
  list.innerHTML = html;

  list.querySelectorAll(".ss-option").forEach(opt => {
    opt.addEventListener("mousedown", (e) => {
      e.preventDefault();
      hidden.value = opt.dataset.value;
      input.value = opt.dataset.label;
      list.classList.remove("open");
      list.querySelectorAll(".ss-option").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");

      const itemObj = (items || []).find(i => String(i.value) === String(opt.dataset.value));
      if (typeof onSelectCallback === "function" && itemObj) {
        onSelectCallback(itemObj);
      }
    });
  });
}

function closeAllDropdowns(exceptId) {
  document.querySelectorAll(".ss-dropdown.open").forEach(d => {
    if (d.id !== exceptId) d.classList.remove("open");
  });
}

// ==============================================================================
// 5. REGISTRO DE AVANCE (COSTURA & PRENDAS TERMINADAS)
// ==============================================================================

// 5.1 Enviar Formulario de Costura (Puestos)
async function enviarFormularioCostura(event) {
  event.preventDefault();

  const horaTurno = parseInt(document.getElementById("reg-hora").value);
  const ordenId = document.getElementById("reg-orden").value;
  const operariaId = document.getElementById("reg-operaria").value;
  const operacionId = document.getElementById("reg-operacion").value;
  const cantidad = parseInt(document.getElementById("reg-cantidad").value);
  const observaciones = document.getElementById("reg-observaciones").value;

  if (!ordenId) { showToast("Seleccione una orden de producción.", "error"); return; }
  if (!operariaId) { showToast("Seleccione la operaria.", "error"); return; }
  if (!operacionId) { showToast("Seleccione la operación realizada.", "error"); return; }
  if (!cantidad || cantidad <= 0) { showToast("Ingrese una cantidad válida mayor a cero.", "error"); return; }

  const submitBtn = document.getElementById("btn-submit-costura");
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Guardando...';

  try {
    const opInfo = appState.operaciones.find(o => o.id === operacionId);
    const sam = opInfo ? Number(opInfo.sam) : 0;
    const minutosGanados = Number((cantidad * sam).toFixed(3));

    const { error: regError } = await getDb()
      .from("registros_produccion")
      .insert({
        empresa_id: appState.empresa.id,
        orden_id: ordenId,
        operaria_id: operariaId,
        operacion_id: operacionId,
        hora_turno: horaTurno,
        cantidad: cantidad,
        minutos_ganados: minutosGanados,
        observaciones: observaciones
      });

    if (regError) throw regError;

    showToast(`✓ Avance guardado: ${cantidad} uds (${minutosGanados} min SAM)`, "success");
    document.getElementById("reg-cantidad").value = "";
    document.getElementById("reg-observaciones").value = "";
  } catch (error) {
    console.error("Error al guardar avance:", error);
    showToast("Error al guardar: " + error.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i data-lucide="check-circle-2"></i> Registrar Avance de Costura';
    lucide.createIcons();
  }
}

// 5.2 Enviar Formulario de Prendas Terminadas & Calidad (Puntos 2 y 4)
async function enviarFormularioTerminadas(event) {
  event.preventDefault();

  const horaTurno = parseInt(document.getElementById("reg-term-hora").value);
  const ordenId = document.getElementById("reg-term-orden").value;
  const cantidadPrimeras = parseInt(document.getElementById("reg-term-primeras").value) || 0;
  const cantidadDefectos = parseInt(document.getElementById("reg-term-defectos").value) || 0;
  const motivoDefecto = document.getElementById("reg-term-motivo").value || "Sin defectos";
  const observaciones = document.getElementById("reg-term-observaciones").value;

  if (!ordenId) { showToast("Seleccione una orden de producción.", "error"); return; }
  if (cantidadPrimeras <= 0 && cantidadDefectos <= 0) {
    showToast("Debe registrar al menos una prenda terminada o un defecto.", "error");
    return;
  }

  const submitBtn = document.getElementById("btn-submit-terminadas");
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Guardando salida...';

  try {
    // 1. Actualizar prendas_terminadas en la tabla ordenes_produccion
    const orden = appState.ordenes.find(o => o.id === ordenId);
    const previas = orden ? (orden.prendas_terminadas || 0) : 0;
    const nuevasTerminadas = previas + cantidadPrimeras;

    await getDb()
      .from("ordenes_produccion")
      .update({ prendas_terminadas: nuevasTerminadas })
      .eq("id", ordenId);

    if (orden) orden.prendas_terminadas = nuevasTerminadas;

    // 2. Intentar guardar en tabla registros_prendas_terminadas (si existe en BD)
    try {
      await getDb()
        .from("registros_prendas_terminadas")
        .insert({
          empresa_id: appState.empresa.id,
          orden_id: ordenId,
          hora_turno: horaTurno,
          cantidad_primeras: cantidadPrimeras,
          cantidad_defectos: cantidadDefectos,
          motivo_defecto: motivoDefecto,
          observaciones: observaciones
        });
    } catch (e) {
      // Si la tabla no está creada aún, guardamos localmente en appState para no bloquear
      console.warn("Tabla registros_prendas_terminadas no encontrada. Guardando en memoria local.");
    }

    // Guardar en estado local para reflejar inmediatamente en gráficas apiladas
    appState.registrosTerminadas.push({
      orden_id: ordenId,
      hora_turno: horaTurno,
      cantidad_primeras: cantidadPrimeras,
      cantidad_defectos: cantidadDefectos,
      motivo_defecto: motivoDefecto
    });

    const msgDefecto = cantidadDefectos > 0 ? ` (+${cantidadDefectos} defectos reportados)` : " (100% Primera)";
    showToast(`✓ Salida de módulo: ${cantidadPrimeras} prendas terminadas${msgDefecto}`, "success");

    document.getElementById("reg-term-primeras").value = "";
    document.getElementById("reg-term-defectos").value = "0";
    document.getElementById("reg-term-observaciones").value = "";
  } catch (error) {
    console.error("Error al registrar prendas terminadas:", error);
    showToast("Error: " + error.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i data-lucide="check-check"></i> Registrar Salida de Módulo & Calidad';
    lucide.createIcons();
  }
}

// ==============================================================================
// 6. TABLERO DE CONTROL (GRÁFICAS APILADAS & EFICIENCIA)
// ==============================================================================
function inicializarFiltrosDashboard() {
  const hoy = new Date().toISOString().split("T")[0];
  document.getElementById("dash-filter-date").value = hoy;
}

async function actualizarDashboard(mostrarOverlay = false) {
  const btnSync = document.getElementById("btn-sync");
  if (btnSync) btnSync.classList.add("spinning");

  if (mostrarOverlay) {
    showLoader(true, "Actualizando tablero...");
  }

  try {
    const fechaFiltro = document.getElementById("dash-filter-date")?.value;
    const ordenFiltro = document.getElementById("dash-filter-orden")?.value;
    const modoHistorico = document.getElementById("dash-filter-all-dates")?.checked;
    const empresaId = appState.empresa?.id;

    if (!empresaId) return;

    // 1. Preparar consulta de Costura
    let queryCostura = getDb()
      .from("registros_produccion")
      .select(`
        id, fecha, hora_turno, cantidad, minutos_ganados, observaciones,
        orden_id,
        ordenes_produccion(numero_op, cantidad_programada, prendas_terminadas, prendas(referencia)),
        operaria_id,
        operarias(codigo_operaria, nombre),
        operacion_id,
        operaciones_prenda(codigo_operacion, nombre_operacion, sam)
      `)
      .eq("empresa_id", empresaId);

    if (!modoHistorico && fechaFiltro) {
      queryCostura = queryCostura.eq("fecha", fechaFiltro);
    }
    if (ordenFiltro) {
      queryCostura = queryCostura.eq("orden_id", ordenFiltro);
    }

    // 2. Preparar consulta de Prendas Terminadas
    let queryTerm = getDb()
      .from("registros_prendas_terminadas")
      .select("*")
      .eq("empresa_id", empresaId);

    if (!modoHistorico && fechaFiltro) {
      queryTerm = queryTerm.eq("fecha", fechaFiltro);
    }
    if (ordenFiltro) {
      queryTerm = queryTerm.eq("orden_id", ordenFiltro);
    }

    // 3. Ejecutar AMBAS consultas EN PARALELO (Promise.all) para máxima velocidad
    const fetchCostura = async () => {
      try {
        return await queryCostura.order("hora_turno", { ascending: true });
      } catch (e) {
        console.error("Error al cargar registros de costura:", e);
        return { data: [], error: e };
      }
    };

    const fetchTerminadas = async () => {
      try {
        return await queryTerm;
      } catch (e) {
        console.warn("Tabla registros_prendas_terminadas no accesible aún:", e);
        return { data: null };
      }
    };

    const [resCostura, resTerm] = await Promise.all([
      fetchCostura(),
      fetchTerminadas()
    ]);

    if (resCostura && !resCostura.error) {
      appState.registrosCostura = resCostura.data || [];
    }

    if (resTerm && resTerm.data) {
      appState.registrosTerminadas = resTerm.data;
    }

    // 4. Renderizar Componentes del Tablero con datos actualizados
    renderizarProgresoOrdenes(ordenFiltro);
    renderizarBarrasApiladasHorarias(ordenFiltro); // Punto 6
    renderizarTablaEficiencias();                   // Punto 8
    renderizarDetalleOperaciones();                 // Punto 9

  } catch (error) {
    console.error("Error al actualizar dashboard:", error);
    showToast("Error al cargar dashboard: " + error.message, "error");
  } finally {
    if (btnSync) btnSync.classList.remove("spinning");
    if (mostrarOverlay) showLoader(false);
    lucide.createIcons();
  }
}

function renderizarProgresoOrdenes(ordenFiltro) {
  const container = document.getElementById("dashboard-orders-container");
  container.innerHTML = "";

  const ordenesAMostrar = ordenFiltro
    ? appState.ordenes.filter(o => o.id === ordenFiltro)
    : appState.ordenes.filter(o => o.estado === "activa");

  if (ordenesAMostrar.length === 0) {
    container.innerHTML = '<p class="empty-message">No hay órdenes para mostrar con este filtro.</p>';
    return;
  }

  ordenesAMostrar.forEach(ord => {
    const meta = ord.cantidad_programada || 1;
    const terminadas = ord.prendas_terminadas || 0;
    const pct = Math.round((terminadas / meta) * 100);
    const pctCapped = Math.min(pct, 100);

    container.insertAdjacentHTML("beforeend", `
      <div class="order-progress-card" style="margin-bottom:14px;">
        <div class="order-meta-info">
          <h4>${escapeHtml(ord.numero_op)} &bull; <span class="order-ref">${escapeHtml(ord.prendas?.referencia || "Sin ref")}</span></h4>
          <span class="status-pill ${ord.estado}">${ord.estado.toUpperCase()}</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${pctCapped}%"></div>
        </div>
        <div class="order-stats">
          <span>Progreso: <strong>${pct}%</strong></span>
          <span><span class="stat-completed">${terminadas}</span> / ${meta} prendas finalizadas</span>
        </div>
      </div>
    `);
  });
}

// Punto 6: Gráfico de Barras Apiladas por Hora (Prendas Terminadas por Orden)
function renderizarBarrasApiladasHorarias(ordenFiltro) {
  const containerBars = document.getElementById("stacked-hourly-bars");
  const containerLegend = document.getElementById("stacked-chart-legend");
  containerBars.innerHTML = "";
  containerLegend.innerHTML = "";

  // 1. Identificar órdenes activas y asignarles un color único
  const mapaColoresOP = {};
  const ordenesEnJuego = ordenFiltro
    ? appState.ordenes.filter(o => o.id === ordenFiltro)
    : appState.ordenes.filter(o => o.estado === "activa");

  ordenesEnJuego.forEach((ord, idx) => {
    mapaColoresOP[ord.id] = {
      color: OP_COLORS[idx % OP_COLORS.length],
      numero_op: ord.numero_op,
      referencia: ord.prendas?.referencia || ""
    };
  });

  // Generar leyenda
  Object.values(mapaColoresOP).forEach(opInfo => {
    containerLegend.insertAdjacentHTML("beforeend", `
      <div class="legend-item">
        <div class="legend-color" style="background:${opInfo.color};"></div>
        <span>${escapeHtml(opInfo.numero_op)} (${escapeHtml(opInfo.referencia)})</span>
      </div>
    `);
  });

  // 2. Estructurar matriz: matriz[hora][orden_id] = cantidad
  const matrizHoras = {};
  let maxTotalHora = 10;

  appState.bloquesHorarios.forEach(b => {
    matrizHoras[b.valor] = { total: 0, porOrden: {} };
    ordenesEnJuego.forEach(o => { matrizHoras[b.valor].porOrden[o.id] = 0; });
  });

  appState.registrosTerminadas.forEach(r => {
    const hora = r.hora_turno;
    const opId = r.orden_id;
    const cant = Number(r.cantidad_primeras) || 0;

    if (matrizHoras[hora] && matrizHoras[hora].porOrden[opId] !== undefined) {
      matrizHoras[hora].porOrden[opId] += cant;
      matrizHoras[hora].total += cant;
      if (matrizHoras[hora].total > maxTotalHora) {
        maxTotalHora = matrizHoras[hora].total;
      }
    }
  });

  // 3. Renderizar columnas apiladas
  appState.bloquesHorarios.forEach(b => {
    const dataHora = matrizHoras[b.valor];
    let segmentosHtml = "";

    ordenesEnJuego.forEach(o => {
      const cantOP = dataHora.porOrden[o.id] || 0;
      if (cantOP > 0) {
        const pctHeight = (cantOP / maxTotalHora) * 100;
        const color = mapaColoresOP[o.id]?.color || "#4f46e5";
        segmentosHtml += `
          <div class="bar-segment" style="height:${pctHeight}%; background:${color};" title="${mapaColoresOP[o.id]?.numero_op}: ${cantOP} uds"></div>
        `;
      }
    });

    containerBars.insertAdjacentHTML("beforeend", `
      <div class="stacked-bar-col">
        ${dataHora.total > 0 ? `<span class="stacked-bar-total">${dataHora.total}</span>` : ''}
        <div class="stacked-bar-track">
          ${segmentosHtml}
        </div>
        <span class="stacked-bar-label">H${b.valor}</span>
      </div>
    `);
  });
}

// Punto 8: Tabla de Eficiencia con Totales de Unidades y % Eficiencia Día
function renderizarTablaEficiencias() {
  const tbody = document.getElementById("efficiency-tbody");
  tbody.innerHTML = "";

  if (appState.registrosCostura.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="empty-message">No hay registros de costura con los filtros seleccionados.</td></tr>';
    return;
  }

  const operariasStats = {};

  appState.registrosCostura.forEach(r => {
    const opId = r.operaria_id;
    const nombre = r.operarias?.nombre || "Operaria";
    const codigo = r.operarias?.codigo_operaria ? `[${r.operarias.codigo_operaria}] ` : "";

    if (!operariasStats[opId]) {
      operariasStats[opId] = {
        nombre: codigo + nombre,
        horas: {},
        prendasHora: {},
        totalUnidades: 0,
        totalMinutosGanados: 0
      };
      appState.bloquesHorarios.forEach(b => {
        operariasStats[opId].horas[b.valor] = 0;
        operariasStats[opId].prendasHora[b.valor] = 0;
      });
    }

    const minGanados = Number(r.minutos_ganados) || 0;
    const cant = Number(r.cantidad) || 0;

    operariasStats[opId].horas[r.hora_turno] += minGanados;
    operariasStats[opId].prendasHora[r.hora_turno] += cant;
    operariasStats[opId].totalUnidades += cant;
    operariasStats[opId].totalMinutosGanados += minGanados;
  });

  const duracionHoraMin = appState.empresa.config_turnos?.duracion_bloque_min || 60;

  Object.values(operariasStats).forEach(op => {
    let horasConActividad = 0;
    let trHtml = `<tr><td><strong>${escapeHtml(op.nombre)}</strong></td>`;

    appState.bloquesHorarios.forEach(b => {
      const minProducidos = op.horas[b.valor];
      const cantPrendas = op.prendasHora[b.valor];

      if (cantPrendas > 0) {
        horasConActividad++;
        const efHora = Math.round((minProducidos / duracionHoraMin) * 100);
        let badgeClass = "badge-medium";
        if (efHora >= 85) badgeClass = "badge-high";
        else if (efHora < 70) badgeClass = "badge-low";

        trHtml += `
          <td>
            <span class="badge-efficiency ${badgeClass}">${efHora}%</span>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${cantPrendas} uds</div>
          </td>
        `;
      } else {
        trHtml += `<td><span class="badge-efficiency badge-none">-</span></td>`;
      }
    });

    trHtml += `<td class="col-total"><strong style="color:var(--mod-reg-primary); font-size:0.9rem;">${op.totalUnidades} uds</strong></td>`;

    const minutosDisponiblesJornada = (horasConActividad || 1) * duracionHoraMin;
    const efDia = Math.round((op.totalMinutosGanados / minutosDisponiblesJornada) * 100);
    let badgeDiaClass = "badge-medium";
    if (efDia >= 85) badgeDiaClass = "badge-high";
    else if (efDia < 70) badgeDiaClass = "badge-low";

    trHtml += `
      <td class="col-total">
        <span class="badge-efficiency ${badgeDiaClass}" style="font-size:0.85rem; padding:6px 10px;">${efDia}%</span>
      </td>
    </tr>`;

    tbody.insertAdjacentHTML("beforeend", trHtml);
  });
}

// Punto 9: Detalle de Operaciones y Resumen Totalizador por Operaria
function renderizarDetalleOperaciones() {
  const selectOperariaFiltro = document.getElementById("detail-filter-operaria");
  const filtroActual = selectOperariaFiltro.value;

  const operariasMap = {};
  appState.registrosCostura.forEach(r => {
    if (r.operarias) {
      operariasMap[r.operaria_id] = r.operarias.nombre;
    }
  });

  const itemsOps = [
    { value: "", label: "Todas las operarias" },
    ...Object.keys(operariasMap).sort().map(id => ({ value: id, label: operariasMap[id] }))
  ];
  initSearchableSelect("ss-detail-operaria", "ss-detail-operaria-input", "ss-detail-operaria-list", "detail-filter-operaria", itemsOps, "Todas las operarias", filtrarDetalleOperaciones);

  filtrarDetalleOperaciones();
}

function filtrarDetalleOperaciones() {
  const opIdFiltro = document.getElementById("detail-filter-operaria").value;
  const tbody = document.getElementById("detalles-operaciones-tbody");
  tbody.innerHTML = "";

  const registrosFiltrados = opIdFiltro
    ? appState.registrosCostura.filter(r => r.operaria_id === opIdFiltro)
    : appState.registrosCostura;

  let totalUnidadesSumadas = 0;
  let totalMinutosSamSumados = 0;

  registrosFiltrados.forEach(r => {
    totalUnidadesSumadas += Number(r.cantidad) || 0;
    totalMinutosSamSumados += Number(r.minutos_ganados) || 0;
  });

  document.getElementById("kpi-total-unidades-detalle").textContent = `${totalUnidadesSumadas} unidades`;
  document.getElementById("kpi-total-sam-detalle").textContent = `${totalMinutosSamSumados.toFixed(1)} min`;

  if (registrosFiltrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-message">No hay operaciones registradas para este filtro.</td></tr>';
    return;
  }

  registrosFiltrados.forEach(r => {
    const nombreOp = r.operaciones_prenda ? r.operaciones_prenda.nombre_operacion : "Operación";
    const codOp = r.operaciones_prenda ? r.operaciones_prenda.codigo_operacion : "";

    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td style="text-align: left !important; font-weight: 600;">${escapeHtml(r.operarias?.nombre || "")}</td>
        <td><span class="badge-efficiency badge-none">H${r.hora_turno}</span></td>
        <td style="text-align: left !important;">
          <strong style="color:var(--mod-dash-primary);">[${codOp}]</strong> ${escapeHtml(nombreOp)}
        </td>
        <td><strong style="color:var(--text-main); font-size:0.9rem;">${r.cantidad} uds</strong></td>
        <td>${Number(r.minutos_ganados || 0).toFixed(2)} min</td>
      </tr>
    `);
  });
}

// Exportar datos actuales a CSV (Compatible con Excel)
function exportarReporteCSV() {
  if (appState.registrosCostura.length === 0 && appState.registrosTerminadas.length === 0) {
    showToast("No hay registros para exportar.", "error");
    return;
  }

  const encabezados = ["ID_Registro", "Fecha", "Hora_Turno", "Orden", "Operaria", "Operacion", "Cantidad", "Minutos_SAM", "Observaciones"];
  const filas = appState.registrosCostura.map(r => [
    r.id,
    r.fecha,
    `H${r.hora_turno}`,
    `"${r.ordenes_produccion?.numero_op || ''}"`,
    `"${r.operarias?.nombre || ''}"`,
    `"${r.operaciones_prenda?.nombre_operacion || ''}"`,
    r.cantidad,
    r.minutos_ganados,
    `"${(r.observaciones || '').replace(/"/g, '""')}"`
  ]);

  const contenidoCSV = "\uFEFF" + [encabezados.join(";"), ...filas.map(f => f.join(";"))].join("\r\n");
  const blob = new Blob([contenidoCSV], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Reporte_Produccion_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Archivo CSV descargado con éxito.", "success");
}

// ==============================================================================
// 7. PANEL ADMINISTRADOR, MAESTROS & PROYECCIÓN (Puntos 8 y 9)
// ==============================================================================
function abrirModalAdminPin() {
  document.getElementById("modal-admin-pin").classList.add("open");
  document.getElementById("admin-pin-input").value = "";
  document.getElementById("admin-pin-input").focus();
}

function cerrarModalAdminPin() {
  document.getElementById("modal-admin-pin").classList.remove("open");
}

function validarAdminPin() {
  const pin = document.getElementById("admin-pin-input").value;
  if (pin === appState.adminPin) {
    cerrarModalAdminPin();
    activarModoAdmin(true, true);
    switchView("admin");
    showToast("✓ Modo Administrador Activado", "success");
  } else {
    showToast("PIN incorrecto. (Por defecto: 1234)", "error");
  }
}

function activarModoAdmin(activar, guardar = true) {
  appState.isAdmin = activar;
  if (guardar) localStorage.setItem("retoos_is_admin", activar ? "true" : "false");

  const badge = document.getElementById("header-role-badge");
  if (badge) {
    if (activar) {
      badge.className = "badge-role badge-role-admin";
      badge.innerHTML = '<i data-lucide="shield-check"></i> Admin';
    } else {
      badge.className = "badge-role badge-role-floor";
      badge.innerHTML = '<i data-lucide="tablet"></i> Piso';
    }
    lucide.createIcons();
  }
}

function salirModoAdmin() {
  activarModoAdmin(false);
  switchView("registro");
  showToast("Regresando a Modo Piso", "success");
}

// Navegación con Scroll Suave e Iluminación Bento a la sección elegida
function irASeccionAdmin(seccionId) {
  const elem = document.getElementById(seccionId);
  if (!elem) return;
  elem.scrollIntoView({ behavior: "smooth", block: "start" });
  if (elem.classList.contains("admin-section-box")) {
    elem.classList.add("highlight");
    setTimeout(() => {
      elem.classList.remove("highlight");
    }, 1800);
  }
}

function switchAdminTab(tabId) {
  irASeccionAdmin("seccion-admin-" + tabId);
}

async function cargarDatosAdmin() {
  renderAdminOrdenes();
  renderAdminOperarias();
  renderAdminPrendas();
  renderAdminTurnos();
}

// Punto 9: Calculadora de Capacidad y Tiempos de Entrega en el Formulario
function calcularProyeccionEntregaEnForm() {
  const prendaId = document.getElementById("admin-op-prenda").value;
  const meta = parseInt(document.getElementById("admin-op-meta").value) || 0;
  const operarias = parseInt(document.getElementById("admin-op-operarias").value) || 10;
  const eficiencia = parseInt(document.getElementById("admin-op-eficiencia").value) || 80;

  const cardPreview = document.getElementById("capacity-form-preview");
  if (!prendaId || meta <= 0) {
    cardPreview.style.display = "none";
    return;
  }

  const prenda = appState.prendas.find(p => p.id === prendaId);
  const samPrenda = prenda ? Number(prenda.sam_total) : 0;

  if (samPrenda <= 0) {
    cardPreview.style.display = "none";
    return;
  }

  const totalMinutosRequeridos = meta * samPrenda;
  const duracionHoraMin = appState.empresa.config_turnos?.duracion_bloque_min || 60;
  const totalHorasTurno = appState.empresa.config_turnos?.total_horas || 9;
  const minutosJornadaPlanta = totalHorasTurno * duracionHoraMin;

  const capacidadDiariaMinutos = Math.round(operarias * minutosJornadaPlanta * (eficiencia / 100));
  const diasEstimados = capacidadDiariaMinutos > 0 ? (totalMinutosRequeridos / capacidadDiariaMinutos).toFixed(1) : 0;

  cardPreview.style.display = "block";
  document.getElementById("cap-calc-minutos").textContent = `${totalMinutosRequeridos.toLocaleString()} min`;
  document.getElementById("cap-calc-diaria").textContent = `${capacidadDiariaMinutos.toLocaleString()} min/día`;
  document.getElementById("cap-calc-dias").textContent = `${diasEstimados} días hábiles`;
}

// 7.1 Órdenes de Producción (Listado Horizontal Compacto - 1 Sola Fila)
function renderAdminOrdenes(filtroTexto = "") {
  const list = document.getElementById("admin-ordenes-list");
  if (!list) return;
  list.innerHTML = "";

  let ordenes = appState.ordenes;
  if (filtroTexto && filtroTexto.trim()) {
    const q = filtroTexto.trim().toLowerCase();
    ordenes = ordenes.filter(ord => 
      (ord.numero_op && ord.numero_op.toLowerCase().includes(q)) ||
      (ord.prendas?.referencia && ord.prendas.referencia.toLowerCase().includes(q))
    );
  }

  if (ordenes.length === 0) {
    list.innerHTML = '<p class="empty-message">No se encontraron órdenes registradas.</p>';
    return;
  }

  ordenes.forEach(ord => {
    const meta = ord.cantidad_programada || 0;
    const terminadas = ord.prendas_terminadas || 0;
    const samTotal = ord.prendas?.sam_total || 0;
    const minTotales = (meta * samTotal).toFixed(0);
    const pct = meta > 0 ? Math.round((terminadas / meta) * 100) : 0;
    const estado = ord.estado || "activa";

    list.insertAdjacentHTML("beforeend", `
      <div class="admin-strip-row">
        <div class="admin-strip-left">
          <span class="admin-strip-badge">[${escapeHtml(ord.numero_op)}]</span>
          <span class="admin-strip-title">${escapeHtml(ord.prendas?.referencia || "Sin prenda")}</span>
          <div class="admin-strip-metrics">
            <span>&bull; Meta: <strong>${meta.toLocaleString()}</strong></span>
            <span>&bull; Uds: <strong>${terminadas.toLocaleString()}</strong> (${pct}%)</span>
            <span>&bull; SAM: <strong>${samTotal} min</strong></span>
            <span>&bull; Carga: <strong>${Number(minTotales).toLocaleString()} min</strong></span>
          </div>
          <span class="admin-strip-status ${estado}">${estado.toUpperCase()}</span>
        </div>
        <div class="admin-strip-actions">
          ${estado !== 'activa' ? `
            <button class="btn-strip-action btn-action-activate" onclick="cambiarEstadoOP('${ord.id}', 'activa')">
              <i data-lucide="play" style="width:13px;height:13px;"></i> Iniciar / Activar
            </button>
          ` : ''}
          ${estado === 'activa' ? `
            <button class="btn-strip-action btn-action-pause" onclick="cambiarEstadoOP('${ord.id}', 'pausada')">
              <i data-lucide="pause" style="width:13px;height:13px;"></i> Pausar
            </button>
          ` : ''}
          ${estado !== 'finalizada' ? `
            <button class="btn-strip-action btn-action-finish" onclick="cambiarEstadoOP('${ord.id}', 'finalizada')">
              <i data-lucide="check" style="width:13px;height:13px;"></i> Finalizar
            </button>
          ` : ''}
        </div>
      </div>
    `);
  });
  lucide.createIcons();
}

function filtrarListaAdminOrdenes(val) {
  renderAdminOrdenes(val);
}

async function crearNuevaOP(event) {
  event.preventDefault();
  const numOP = document.getElementById("admin-op-num").value.trim();
  const prendaId = document.getElementById("admin-op-prenda").value;
  const meta = parseInt(document.getElementById("admin-op-meta").value);

  if (!numOP || !prendaId || !meta) {
    showToast("Complete todos los campos de la orden.", "error");
    return;
  }

  showLoader(true, "Creando orden...");
  try {
    const { data, error } = await getDb()
      .from("ordenes_produccion")
      .insert({
        empresa_id: appState.empresa.id,
        numero_op: numOP,
        prenda_id: prendaId,
        cantidad_programada: meta,
        estado: "activa"
      })
      .select("*, prendas(id, referencia, descripcion, sam_total)")
      .single();

    if (error) throw error;

    appState.ordenes.unshift(data);
    configurarTodosLosBuscadoresMagicos();
    renderAdminOrdenes();
    document.getElementById("admin-op-num").value = "";
    document.getElementById("admin-op-meta").value = "";
    document.getElementById("capacity-form-preview").style.display = "none";
    showToast(`✓ Orden ${numOP} creada con éxito`, "success");
  } catch (err) {
    showToast("Error al crear OP: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

async function cambiarEstadoOP(id, nuevoEstado) {
  try {
    const { error } = await getDb()
      .from("ordenes_produccion")
      .update({ estado: nuevoEstado })
      .eq("id", id);

    if (error) throw error;

    const op = appState.ordenes.find(o => o.id === id);
    if (op) op.estado = nuevoEstado;

    configurarTodosLosBuscadoresMagicos();
    renderAdminOrdenes();
    showToast(`Orden actualizada a ${nuevoEstado}`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
}

// 7.2 Personal / Operarias (Listado Horizontal Compacto - 1 Sola Fila)
function renderAdminOperarias(filtroTexto = "") {
  const list = document.getElementById("admin-operarias-list");
  if (!list) return;
  list.innerHTML = "";

  let operarias = appState.operarias;
  if (filtroTexto && filtroTexto.trim()) {
    const q = filtroTexto.trim().toLowerCase();
    operarias = operarias.filter(op => 
      (op.nombre && op.nombre.toLowerCase().includes(q)) ||
      (op.codigo_operaria && op.codigo_operaria.toLowerCase().includes(q)) ||
      (op.modulo_linea && op.modulo_linea.toLowerCase().includes(q))
    );
  }

  if (operarias.length === 0) {
    list.innerHTML = '<p class="empty-message">No se encontraron operarias registradas.</p>';
    return;
  }

  operarias.forEach(op => {
    const esActiva = op.estado === "activa";
    const codigo = op.codigo_operaria || "S/C";
    const modulo = op.modulo_linea || "Línea 1";

    list.insertAdjacentHTML("beforeend", `
      <div class="admin-strip-row">
        <div class="admin-strip-left">
          <span class="admin-strip-badge">[${escapeHtml(codigo)}]</span>
          <span class="admin-strip-title">${escapeHtml(op.nombre)}</span>
          <div class="admin-strip-metrics">
            <span>&bull; Módulo: <strong>${escapeHtml(modulo)}</strong></span>
          </div>
          <span class="admin-strip-status ${op.estado}">${op.estado.toUpperCase()}</span>
        </div>
        <div class="admin-strip-actions">
          <button class="btn-strip-action ${esActiva ? 'btn-action-danger' : 'btn-action-activate'}" 
                  onclick="toggleEstadoOperaria('${op.id}', '${esActiva ? 'inactiva' : 'activa'}')">
            <i data-lucide="${esActiva ? 'user-x' : 'user-check'}" style="width:13px;height:13px;"></i> 
            ${esActiva ? 'Inactivar' : 'Reactivar'}
          </button>
        </div>
      </div>
    `);
  });
  lucide.createIcons();
}

function filtrarListaAdminOperarias(val) {
  renderAdminOperarias(val);
}

async function crearNuevaOperaria(event) {
  event.preventDefault();
  const nombre = document.getElementById("admin-operaria-nombre").value.trim();
  const codigo = document.getElementById("admin-operaria-codigo").value.trim();
  const modulo = document.getElementById("admin-operaria-modulo").value.trim();

  if (!nombre) { showToast("El nombre de la operaria es requerido.", "error"); return; }

  showLoader(true, "Guardando operaria...");
  try {
    const { data, error } = await getDb()
      .from("operarias")
      .insert({
        empresa_id: appState.empresa.id,
        nombre: nombre,
        codigo_operaria: codigo || `OP-${appState.operarias.length + 101}`,
        modulo_linea: modulo || "Módulo 1",
        estado: "activa"
      })
      .select()
      .single();

    if (error) throw error;

    appState.operarias.push(data);
    configurarTodosLosBuscadoresMagicos();
    renderAdminOperarias();
    document.getElementById("admin-operaria-nombre").value = "";
    document.getElementById("admin-operaria-codigo").value = "";
    showToast(`✓ Operaria ${nombre} creada exitosamente`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

async function toggleEstadoOperaria(id, nuevoEstado) {
  try {
    const { error } = await getDb()
      .from("operarias")
      .update({ estado: nuevoEstado })
      .eq("id", id);

    if (error) throw error;

    const op = appState.operarias.find(o => o.id === id);
    if (op) op.estado = nuevoEstado;

    configurarTodosLosBuscadoresMagicos();
    renderAdminOperarias();
    showToast(`Operaria ${op.nombre} ahora está ${nuevoEstado}`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
}

// 7.3 Prendas & Fichas SAM (Punto 8: Modificar SAM y Auto-código)
function renderAdminPrendas() {
  const list = document.getElementById("admin-prendas-list");
  list.innerHTML = "";

  appState.prendas.forEach(p => {
    const opsDePrenda = appState.operaciones.filter(o => o.prenda_id === p.id);
    const samTotal = opsDePrenda.reduce((sum, o) => sum + Number(o.sam || 0), 0);

    list.insertAdjacentHTML("beforeend", `
      <div class="data-list-item" style="flex-direction: column; align-items: flex-start; gap: 10px; margin-bottom:16px;">
        <div style="display: flex; justify-content: space-between; width: 100%;">
          <h5><i data-lucide="shirt" style="width:18px;height:18px;display:inline;"></i> <strong>${escapeHtml(p.referencia)}</strong></h5>
          <strong style="color: var(--mod-adm-primary); font-size:1rem;">${samTotal.toFixed(3)} min SAM Total</strong>
        </div>
        <p style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(p.descripcion || 'Sin descripción')} &bull; ${opsDePrenda.length} operaciones creadas</p>
        
        <div style="width: 100%; font-size: 0.82rem; background: #fff; padding: 8px 12px; border-radius: 10px; border: 1.5px solid var(--border-color);">
          ${opsDePrenda.map(o => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom:1px solid #f1f5f9;">
              <div>
                <strong style="color:var(--mod-adm-primary);">[${o.codigo_operacion}]</strong> ${escapeHtml(o.nombre_operacion)} 
                <span style="color:var(--text-muted); margin-left:6px;">(${o.sam} min)</span>
              </div>
              <button class="btn btn-secondary btn-sm" style="height:28px; font-size:0.75rem; padding:0 8px;" onclick="abrirModalEditSAM('${o.id}', '${escapeHtml(o.nombre_operacion)}', ${o.sam})">
                <i data-lucide="edit-2"></i> Editar SAM
              </button>
            </div>
          `).join('') || '<em style="color:var(--text-muted);">No tiene operaciones en su ruta aún</em>'}
        </div>
      </div>
    `);
  });
  lucide.createIcons();
}

async function crearNuevaPrenda(event) {
  event.preventDefault();
  const ref = document.getElementById("admin-prenda-ref").value.trim();
  const desc = document.getElementById("admin-prenda-desc").value.trim();

  if (!ref) { showToast("La referencia de la prenda es requerida.", "error"); return; }

  showLoader(true, "Creando prenda...");
  try {
    const { data, error } = await getDb()
      .from("prendas")
      .insert({
        empresa_id: appState.empresa.id,
        referencia: ref,
        descripcion: desc,
        estado: "activa"
      })
      .select()
      .single();

    if (error) throw error;

    appState.prendas.push(data);
    configurarTodosLosBuscadoresMagicos();
    renderAdminPrendas();
    document.getElementById("admin-prenda-ref").value = "";
    document.getElementById("admin-prenda-desc").value = "";
    showToast(`✓ Prenda ${ref} registrada`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

// Agregar Operación Manual a Prenda (Punto 8: Auto-código si está vacío)
async function agregarOperacionAPrenda(event) {
  event.preventDefault();
  const prendaId = document.getElementById("admin-operacion-prenda").value;
  let codOp = document.getElementById("admin-operacion-codigo").value.trim();
  const nombreOp = document.getElementById("admin-operacion-nombre").value.trim();
  const sam = parseFloat(document.getElementById("admin-operacion-sam").value);

  if (!prendaId || !nombreOp || isNaN(sam)) {
    showToast("Complete los datos requeridos de la operación.", "error");
    return;
  }

  // Punto 8: Si no escribió código, auto-generar OP-01, OP-02...
  if (!codOp) {
    const opsActualesPrenda = appState.operaciones.filter(o => o.prenda_id === prendaId);
    codOp = `OP-${String(opsActualesPrenda.length + 1).padStart(2, '0')}`;
  }

  showLoader(true, "Guardando operación...");
  try {
    const { data, error } = await getDb()
      .from("operaciones_prenda")
      .insert({
        empresa_id: appState.empresa.id,
        prenda_id: prendaId,
        codigo_operacion: codOp,
        nombre_operacion: nombreOp,
        sam: sam
      })
      .select()
      .single();

    if (error) throw error;

    appState.operaciones.push(data);

    // Recalcular sam_total de la prenda
    const opsActualizadas = appState.operaciones.filter(o => o.prenda_id === prendaId);
    const nuevoSamTotal = opsActualizadas.reduce((s, o) => s + Number(o.sam || 0), 0);
    await getDb().from("prendas").update({ sam_total: nuevoSamTotal }).eq("id", prendaId);

    const prendaObj = appState.prendas.find(p => p.id === prendaId);
    if (prendaObj) prendaObj.sam_total = nuevoSamTotal;

    renderAdminPrendas();
    document.getElementById("admin-operacion-codigo").value = "";
    document.getElementById("admin-operacion-nombre").value = "";
    document.getElementById("admin-operacion-sam").value = "";
    showToast(`✓ Operación ${codOp} agregada a la ficha`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

// Punto 8: Modal para Editar SAM in-situ
function abrirModalEditSAM(opId, opNombre, samActual) {
  document.getElementById("edit-sam-op-id").value = opId;
  document.getElementById("edit-sam-desc").textContent = `Operación: ${opNombre}`;
  document.getElementById("edit-sam-valor").value = samActual;
  document.getElementById("modal-edit-sam").classList.add("open");
}

function cerrarModalEditSAM() {
  document.getElementById("modal-edit-sam").classList.remove("open");
}

async function guardarEdicionSAM() {
  const opId = document.getElementById("edit-sam-op-id").value;
  const nuevoSAM = parseFloat(document.getElementById("edit-sam-valor").value);

  if (isNaN(nuevoSAM) || nuevoSAM <= 0) {
    showToast("Ingrese un valor de SAM válido mayor a 0.", "error");
    return;
  }

  showLoader(true, "Actualizando SAM...");
  try {
    const { error } = await getDb()
      .from("operaciones_prenda")
      .update({ sam: nuevoSAM })
      .eq("id", opId);

    if (error) throw error;

    const op = appState.operaciones.find(o => o.id === opId);
    if (op) {
      op.sam = nuevoSAM;
      // Recalcular SAM total de esa prenda
      const prendaId = op.prenda_id;
      const opsPrenda = appState.operaciones.filter(o => o.prenda_id === prendaId);
      const totalSam = opsPrenda.reduce((s, o) => s + Number(o.sam || 0), 0);
      await getDb().from("prendas").update({ sam_total: totalSam }).eq("id", prendaId);

      const pr = appState.prendas.find(p => p.id === prendaId);
      if (pr) pr.sam_total = totalSam;
    }

    cerrarModalEditSAM();
    renderAdminPrendas();
    showToast("✓ SAM actualizado correctamente", "success");
  } catch (err) {
    showToast("Error al actualizar SAM: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

// Punto 8: Exportar Catálogo Completo de Prendas y SAMs a Excel
function exportarCatalogoCompletoExcel() {
  if (appState.prendas.length === 0) {
    showToast("No hay prendas en el catálogo para exportar.", "error");
    return;
  }

  const filas = [["Referencia", "Descripcion_Prenda", "SAM_Total_Prenda", "Codigo_Operacion", "Nombre_Operacion", "SAM_Operacion"]];

  appState.prendas.forEach(p => {
    const ops = appState.operaciones.filter(o => o.prenda_id === p.id);
    if (ops.length === 0) {
      filas.push([p.referencia, p.descripcion || "", p.sam_total, "", "Sin operaciones", ""]);
    } else {
      ops.forEach(op => {
        filas.push([
          p.referencia,
          p.descripcion || "",
          p.sam_total,
          op.codigo_operacion,
          op.nombre_operacion,
          op.sam
        ]);
      });
    }
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, "Catalogo_Prendas_SAM");
  XLSX.writeFile(wb, `Catalogo_Prendas_SAM_${new Date().toISOString().split("T")[0]}.xlsx`);
  showToast("Catálogo completo descargado en Excel.", "success");
}

// Descargar Plantilla Excel de Fichas
function descargarPlantillaPrendasExcel() {
  const datos = [
    ["Referencia", "Codigo_Operacion", "Nombre_Operacion", "SAM"],
    ["CAMISETA CUELLO REDONDO", "OP-01", "Unir Hombros", 0.550],
    ["CAMISETA CUELLO REDONDO", "OP-02", "Pegar Cuello Rib", 1.800],
    ["CAMISETA CUELLO REDONDO", "OP-03", "Dobladillo Mangas y Ruedo", 1.250],
    ["JEAN SLIM 5 BOLSILLOS", "OP-01", "Cerrar Costado Fileteadora", 2.100],
    ["JEAN SLIM 5 BOLSILLOS", "OP-02", "Pegar Pretina", 2.450]
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(datos);
  XLSX.utils.book_append_sheet(wb, ws, "Fichas_SAM");
  XLSX.writeFile(wb, "Plantilla_Fichas_Tecnicas_SAM.xlsx");
  showToast("Plantilla descargada: completa tus datos y súbela.", "success");
}

// Procesar Archivo Excel Prendas y SAMs
function alSeleccionarArchivoExcelPrendas(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);

      if (!json || json.length === 0) {
        showToast("El archivo de Excel parece estar vacío.", "error");
        return;
      }

      const prendasMap = {};

      json.forEach((row, idx) => {
        const ref = row["Referencia"] || row["referencia"] || row["REFERENCIA"] || row["Prenda"] || row["PRENDA"] || row["Ref"];
        const cod = row["Codigo_Operacion"] || row["Codigo"] || row["codigo"] || row["CODIGO"] || `OP-${String(idx + 1).padStart(2, '0')}`;
        const nombreOp = row["Nombre_Operacion"] || row["Operacion"] || row["operacion"] || row["OPERACION"] || row["Nombre"] || row["Descripcion"];
        const samVal = parseFloat(row["SAM"] || row["sam"] || row["Sam"] || row["Minutos"] || row["Tiempo"] || 0.0);

        if (ref && nombreOp && !isNaN(samVal)) {
          const refClean = String(ref).trim();
          if (!prendasMap[refClean]) {
            prendasMap[refClean] = { referencia: refClean, operaciones: [] };
          }
          prendasMap[refClean].operaciones.push({
            codigo_operacion: String(cod).trim(),
            nombre_operacion: String(nombreOp).trim(),
            sam: samVal
          });
        }
      });

      const prendasEncontradas = Object.values(prendasMap);
      if (prendasEncontradas.length === 0) {
        showToast("No se encontraron columnas compatibles ('Referencia', 'Nombre_Operacion', 'SAM').", "error");
        return;
      }

      appState.prendasImportBuffer = prendasEncontradas;

      const totalOps = prendasEncontradas.reduce((s, p) => s + p.operaciones.length, 0);
      const previewBox = document.getElementById("preview-import-prendas");
      const title = document.getElementById("preview-prendas-title");
      const content = document.getElementById("preview-prendas-content");

      title.textContent = `Se detectaron ${prendasEncontradas.length} prendas y ${totalOps} operaciones:`;
      content.innerHTML = prendasEncontradas.map(p => `
        <div style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #e2e8f0;">
          <strong style="color:var(--mod-adm-primary); font-size:0.88rem;">${escapeHtml(p.referencia)}</strong> (${p.operaciones.length} ops)
          <div style="color:var(--text-muted); font-size:0.75rem;">
            ${p.operaciones.slice(0, 3).map(o => `${o.codigo_operacion}: ${o.nombre_operacion} (${o.sam}m)`).join(" &bull; ")}
            ${p.operaciones.length > 3 ? ` ...y ${p.operaciones.length - 3} operaciones más` : ''}
          </div>
        </div>
      `).join("");

      previewBox.style.display = "block";
      showToast(`${prendasEncontradas.length} prendas listas para importar`, "success");
    } catch (err) {
      showToast("Error al leer Excel: " + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

// Confirmar Importación Masiva de Prendas a Supabase
async function confirmarImportacionPrendas() {
  if (!appState.prendasImportBuffer || appState.prendasImportBuffer.length === 0) {
    showToast("No hay fichas pendientes por importar.", "error");
    return;
  }

  const empresaId = appState.empresa.id;
  showLoader(true, "Importando fichas técnicas a la base de datos...");

  try {
    let prendasCreadas = 0;
    let operacionesCreadas = 0;

    for (const item of appState.prendasImportBuffer) {
      let prendaObj = appState.prendas.find(p => p.referencia.toUpperCase() === item.referencia.toUpperCase());

      if (!prendaObj) {
        const samTotalCalc = item.operaciones.reduce((s, o) => s + Number(o.sam || 0), 0);
        const { data: nuevaPrenda, error: errP } = await getDb()
          .from("prendas")
          .insert({
            empresa_id: empresaId,
            referencia: item.referencia,
            descripcion: `Importada desde Excel (${item.operaciones.length} ops)`,
            sam_total: samTotalCalc,
            estado: "activa"
          })
          .select()
          .single();

        if (errP) throw errP;
        prendaObj = nuevaPrenda;
        appState.prendas.push(nuevaPrenda);
        prendasCreadas++;
      }

      const opsParaInsertar = item.operaciones.map(op => ({
        empresa_id: empresaId,
        prenda_id: prendaObj.id,
        codigo_operacion: op.codigo_operacion,
        nombre_operacion: op.nombre_operacion,
        sam: op.sam
      }));

      const { data: nuevasOps, error: errOps } = await getDb()
        .from("operaciones_prenda")
        .insert(opsParaInsertar)
        .select();

      if (errOps) throw errOps;
      if (nuevasOps) {
        appState.operaciones.push(...nuevasOps);
        operacionesCreadas += nuevasOps.length;
      }
    }

    configurarTodosLosBuscadoresMagicos();
    renderAdminPrendas();

    document.getElementById("preview-import-prendas").style.display = "none";
    document.getElementById("excel-file-prendas").value = "";
    appState.prendasImportBuffer = null;

    showToast(`✓ Importación lista: ${prendasCreadas} prendas y ${operacionesCreadas} operaciones`, "success");
  } catch (err) {
    showToast("Error al importar a base de datos: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

// Descargar Plantilla Excel Operarias
function descargarPlantillaOperariasExcel() {
  const datos = [
    ["Nombre", "Codigo", "Modulo"],
    ["María González", "OP-101", "Módulo 1"],
    ["Luz Stella Pérez", "OP-102", "Módulo 1"],
    ["Carmen Elena Rodríguez", "OP-103", "Módulo 2"]
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(datos);
  XLSX.utils.book_append_sheet(wb, ws, "Operarias");
  XLSX.writeFile(wb, "Plantilla_Operarias_Confeccion.xlsx");
  showToast("Plantilla descargada: completa tus datos y súbela.", "success");
}

function alSeleccionarArchivoExcelOperarias(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);

      if (!json || json.length === 0) {
        showToast("El archivo de Excel parece estar vacío.", "error");
        return;
      }

      appState.operariasImportBuffer = [];

      json.forEach(row => {
        const nombre = row["Nombre"] || row["nombre"] || row["OPERARIA"] || row["Operaria"] || row["NOMBRE COMPLETO"];
        const codigo = row["Codigo"] || row["codigo"] || row["CODIGO"] || "";
        const modulo = row["Modulo"] || row["modulo"] || row["MODULO"] || "Módulo 1";

        if (nombre && String(nombre).trim()) {
          appState.operariasImportBuffer.push({
            nombre: String(nombre).trim(),
            codigo_operaria: String(codigo).trim(),
            modulo_linea: String(modulo).trim()
          });
        }
      });

      const previewBox = document.getElementById("preview-import-operarias");
      const title = document.getElementById("preview-operarias-title");
      const content = document.getElementById("preview-operarias-content");

      title.textContent = `Se detectaron ${appState.operariasImportBuffer.length} operarias listas:`;
      content.innerHTML = appState.operariasImportBuffer.slice(0, 8).map(o => 
        `<div>&bull; <strong>${escapeHtml(o.nombre)}</strong> ${o.codigo_operaria ? `(${o.codigo_operaria})` : ''} - ${escapeHtml(o.modulo_linea)}</div>`
      ).join("") + (appState.operariasImportBuffer.length > 8 ? `<div style="color:var(--text-muted);margin-top:4px;">... y ${appState.operariasImportBuffer.length - 8} más</div>` : "");

      previewBox.style.display = "block";
      showToast(`${appState.operariasImportBuffer.length} operarias listas para confirmar`, "success");
    } catch (err) {
      showToast("Error al leer Excel: " + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmarImportacionOperarias() {
  if (!appState.operariasImportBuffer || appState.operariasImportBuffer.length === 0) {
    showToast("No hay datos para importar.", "error");
    return;
  }

  showLoader(true, `Guardando ${appState.operariasImportBuffer.length} operarias...`);
  try {
    const filas = appState.operariasImportBuffer.map(o => ({
      empresa_id: appState.empresa.id,
      nombre: o.nombre,
      codigo_operaria: o.codigo_operaria || `OP-${Math.floor(100 + Math.random() * 900)}`,
      modulo_linea: o.modulo_linea || "Módulo 1",
      estado: "activa"
    }));

    const { data, error } = await getDb()
      .from("operarias")
      .insert(filas)
      .select();

    if (error) throw error;

    appState.operarias.push(...(data || []));
    configurarTodosLosBuscadoresMagicos();
    renderAdminOperarias();

    document.getElementById("preview-import-operarias").style.display = "none";
    document.getElementById("excel-file-operarias").value = "";
    appState.operariasImportBuffer = null;

    showToast(`✓ Se importaron ${data.length} operarias con éxito`, "success");
  } catch (err) {
    showToast("Error al importar: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

// 7.4 Turnos y Costo Minuto Planta
function renderAdminTurnos() {
  const cfg = appState.empresa.config_turnos || {};
  document.getElementById("admin-cfg-hora-inicio").value = cfg.hora_inicio || "06:00";
  document.getElementById("admin-cfg-duracion").value = cfg.duracion_bloque_min || 60;
  document.getElementById("admin-cfg-total-horas").value = cfg.total_horas || 10;
  document.getElementById("admin-cfg-almuerzo-hora").value = cfg.hora_almuerzo || 4;
  document.getElementById("admin-cfg-almuerzo-min").value = cfg.minutos_almuerzo || 30;
  document.getElementById("admin-cfg-costo-minuto").value = appState.empresa.costo_minuto_planta || 0.15;
}

async function guardarConfiguracionTurnos(event) {
  event.preventDefault();
  const nuevaConfig = {
    hora_inicio: document.getElementById("admin-cfg-hora-inicio").value,
    duracion_bloque_min: parseInt(document.getElementById("admin-cfg-duracion").value),
    total_horas: parseInt(document.getElementById("admin-cfg-total-horas").value),
    hora_almuerzo: parseInt(document.getElementById("admin-cfg-almuerzo-hora").value),
    minutos_almuerzo: parseInt(document.getElementById("admin-cfg-almuerzo-min").value)
  };
  const costoMinuto = parseFloat(document.getElementById("admin-cfg-costo-minuto").value) || 0.00;

  showLoader(true, "Guardando configuración...");
  try {
    const { error } = await getDb()
      .from("empresas")
      .update({
        config_turnos: nuevaConfig,
        costo_minuto_planta: costoMinuto
      })
      .eq("id", appState.empresa.id);

    if (error) throw error;

    appState.empresa.config_turnos = nuevaConfig;
    appState.empresa.costo_minuto_planta = costoMinuto;
    generarBloquesHorarios();
    configurarTodosLosBuscadoresMagicos();
    showToast("✓ Configuración de turnos y costeo guardada", "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

// ==============================================================================
// UTILIDADES (TOAST, LOADER, ESCAPE HTML)
// ==============================================================================
function showLoader(visible, mensaje = "Cargando...") {
  const loader = document.getElementById("loading-overlay");
  const text = document.getElementById("loading-text");
  if (text) text.textContent = mensaje;
  if (visible) loader.classList.remove("hidden");
  else loader.classList.add("hidden");
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast show toast-${type}`;
  setTimeout(() => { toast.classList.remove("show"); }, 3800);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ==============================================================================
// 8. MÓDULO DE ANALÍTICA GERENCIAL & BI (PROTEGIDO CON CONTRASEÑA)
// ==============================================================================
function abrirModalGerencialPin() {
  const modal = document.getElementById("modal-gerencial-pin");
  if (modal) {
    modal.classList.add("open");
    const input = document.getElementById("gerencial-pin-input");
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

function cerrarModalGerencialPin() {
  const modal = document.getElementById("modal-gerencial-pin");
  if (modal) modal.classList.remove("open");
}

function validarGerencialPin() {
  const pin = document.getElementById("gerencial-pin-input")?.value;
  if (pin === appState.gerentePin) {
    cerrarModalGerencialPin();
    appState.isGerente = true;
    localStorage.setItem("retoos_is_gerente", "true");
    switchView("gerencial");
    showToast("✓ Acceso Gerencial y BI Desbloqueado", "success");
  } else {
    showToast("PIN incorrecto. (Por defecto: 2026)", "error");
  }
}

function bloquearModoGerencial() {
  appState.isGerente = false;
  localStorage.removeItem("retoos_is_gerente");
  switchView("dashboard");
  showToast("Modo Gerencial bloqueado con éxito", "info");
}

function switchGerencialSubTab(subTab) {
  document.querySelectorAll(".ger-pane").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".ger-subnav-btn").forEach(b => b.classList.remove("active"));

  const targetPane = document.getElementById(`ger-pane-${subTab}`);
  const targetBtn = document.getElementById(`btn-ger-tab-${subTab}`);

  if (targetPane) targetPane.classList.add("active");
  if (targetBtn) targetBtn.classList.add("active");
  lucide.createIcons();
}

function aplicarFiltrosGerenciales() {
  cargarDatosGerenciales();
}

async function cargarDatosGerenciales() {
  try {
    const periodo = document.getElementById("ger-filter-periodo")?.value || "semana";
    const operariaFiltro = document.getElementById("ger-filter-operaria")?.value || "";
    const empresaId = appState.empresa?.id;

    if (!empresaId) return;

    // Calcular fecha inicial según periodo
    const hoy = new Date();
    let fechaInicioStr = null;

    if (periodo === "hoy") {
      fechaInicioStr = hoy.toISOString().split("T")[0];
    } else if (periodo === "semana") {
      const d = new Date(hoy);
      const diaSemana = d.getDay(); // 0 dom, 1 lun...
      const diff = d.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1);
      const lunes = new Date(d.setDate(diff));
      fechaInicioStr = lunes.toISOString().split("T")[0];
    } else if (periodo === "mes") {
      const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      fechaInicioStr = primerDia.toISOString().split("T")[0];
    }

    // Consulta de registros de producción en el periodo
    let qRegistros = getDb()
      .from("registros_produccion")
      .select(`
        id, fecha, hora_turno, cantidad, minutos_ganados,
        orden_id,
        ordenes_produccion(numero_op, cantidad_programada, prendas_terminadas, created_at, estado, prendas(referencia)),
        operaria_id,
        operarias(id, codigo_operaria, nombre, modulo_linea),
        operaciones_prenda(codigo_operacion, nombre_operacion, sam)
      `)
      .eq("empresa_id", empresaId);

    if (fechaInicioStr) {
      qRegistros = qRegistros.gte("fecha", fechaInicioStr);
    }
    if (operariaFiltro) {
      qRegistros = qRegistros.eq("operaria_id", operariaFiltro);
    }

    // Consulta de órdenes maestras
    let qOrdenes = getDb()
      .from("ordenes_produccion")
      .select("*, prendas(referencia, sam_total)")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false });

    const [resReg, resOrd] = await Promise.all([
      qRegistros.order("fecha", { ascending: true }),
      qOrdenes
    ]);

    const registros = resReg.data || [];
    const ordenes = resOrd.data || appState.ordenes || [];

    // Llenar select de operarias si está vacío
    poblarSelectOperariasGerencial();

    // 1. Renderizar Pantalla 1: Control de Operaciones
    renderizarPantallaOperacionesGerencial(registros);

    // 2. Renderizar Pantalla 2: Control de Órdenes
    renderizarPantallaOrdenesGerencial(ordenes);

  } catch (err) {
    console.error("Error al cargar analítica gerencial:", err);
    showToast("Error al cargar BI: " + err.message, "error");
  } finally {
    lucide.createIcons();
  }
}

function poblarSelectOperariasGerencial() {
  const sel = document.getElementById("ger-filter-operaria");
  if (!sel || sel.children.length > 1) return;

  appState.operarias.forEach(op => {
    const opt = document.createElement("option");
    opt.value = op.id;
    opt.textContent = `${op.nombre} (${op.codigo_operaria || op.modulo_linea || ''})`;
    sel.appendChild(opt);
  });
}

function renderizarPantallaOperacionesGerencial(registros) {
  // Cálculos consolidados
  const totalMinSAM = registros.reduce((acc, r) => acc + Number(r.minutos_ganados || 0), 0);
  const totalPrendas = registros.reduce((acc, r) => acc + Number(r.cantidad || 0), 0);
  
  const operariasIds = new Set(registros.map(r => r.operaria_id).filter(Boolean));
  const operariasActivas = operariasIds.size;

  // Horas/Hombre reales por bloques trabajados (cada bloque fecha_hora es 1 hora de labor)
  const bloquesSet = new Set(registros.map(r => `${r.operaria_id}_${r.fecha}_${r.hora_turno}`));
  const horasHombre = bloquesSet.size || (operariasActivas * 8);
  const minutosDisponibles = horasHombre * 60;

  const eficienciaGlobal = minutosDisponibles > 0 ? (totalMinSAM / minutosDisponibles) * 100 : 0;
  const minutosPerdidos = Math.max(0, minutosDisponibles - totalMinSAM);
  const prendasHora = horasHombre > 0 ? (totalPrendas / horasHombre) : 0;

  // Actualizar Scorecards en DOM
  const kpiEfic = document.getElementById("kpi-ger-eficiencia");
  const cardBig = document.getElementById("card-ger-eficiencia-global");

  if (kpiEfic) kpiEfic.textContent = `${eficienciaGlobal.toFixed(1)} %`;
  if (cardBig) {
    cardBig.className = "ger-big-kpi-card";
    if (eficienciaGlobal >= 85) cardBig.classList.add("alta");
    else if (eficienciaGlobal >= 60) cardBig.classList.add("media");
    else cardBig.classList.add("baja");
  }

  const kpiMinSam = document.getElementById("kpi-ger-min-sam");
  if (kpiMinSam) {
    kpiMinSam.textContent = totalMinSAM >= 1000 
      ? `${(totalMinSAM / 1000).toFixed(1)} mil` 
      : `${totalMinSAM.toFixed(0)} min`;
  }

  const kpiPrendas = document.getElementById("kpi-ger-prendas-tot");
  if (kpiPrendas) kpiPrendas.textContent = totalPrendas.toLocaleString();

  const kpiOpsAct = document.getElementById("kpi-ger-operarias-act");
  if (kpiOpsAct) kpiOpsAct.textContent = operariasActivas.toString();

  const kpiMinPerd = document.getElementById("kpi-ger-min-perdidos");
  if (kpiMinPerd) {
    kpiMinPerd.textContent = minutosPerdidos >= 1000 
      ? `${(minutosPerdidos / 1000).toFixed(1)} mil` 
      : `${minutosPerdidos.toFixed(0)} min`;
  }

  const kpiHorasHombre = document.getElementById("kpi-ger-horas-hombre");
  if (kpiHorasHombre) {
    kpiHorasHombre.textContent = horasHombre >= 1000 
      ? `${(horasHombre / 1000).toFixed(1)} mil` 
      : horasHombre.toFixed(1);
  }

  const kpiPrendasHora = document.getElementById("kpi-ger-prendas-hora");
  if (kpiPrendasHora) kpiPrendasHora.textContent = prendasHora.toFixed(1);

  // Calcular eficiencias por operaria para Gráfica 1 y Semáforo Dona
  const statsPorOperaria = {};
  registros.forEach(r => {
    const id = r.operaria_id;
    if (!id) return;
    if (!statsPorOperaria[id]) {
      const opInfo = appState.operarias.find(o => o.id === id);
      statsPorOperaria[id] = {
        nombre: opInfo?.nombre || r.operarias?.nombre || "Operaria",
        minSAM: 0,
        bloques: new Set()
      };
    }
    statsPorOperaria[id].minSAM += Number(r.minutos_ganados || 0);
    statsPorOperaria[id].bloques.add(`${r.fecha}_${r.hora_turno}`);
  });

  const rankingOperarias = Object.values(statsPorOperaria).map(item => {
    const horas = item.bloques.size || 1;
    const disp = horas * 60;
    const eff = disp > 0 ? (item.minSAM / disp) * 100 : 0;
    return {
      nombre: item.nombre.split(" ")[0], // primer nombre para que quepa limpio como en la imagen
      nombreCompleto: item.nombre,
      eficiencia: Math.min(Math.round(eff * 10) / 10, 150)
    };
  }).sort((a, b) => b.eficiencia - a.eficiencia);

  // Renderizar Gráfica 1: Eficiencia por Operario con Línea Meta 85%
  renderChartOperarias(rankingOperarias);

  // Renderizar Gráfica 2: Tendencia Diaria con Meta 85%
  renderChartTendenciaDiaria(registros);

  // Renderizar Gráfica 3: Semáforo de Desempeño (Dona)
  renderChartSemaforo(rankingOperarias);
}

function renderChartOperarias(ranking) {
  const canvas = document.getElementById("chart-ger-operarias");
  if (!canvas || typeof Chart === "undefined") return;

  if (appState.charts.operarias) {
    appState.charts.operarias.destroy();
  }

  const labels = ranking.map(r => r.nombre);
  const data = ranking.map(r => r.eficiencia);
  const metaLine = labels.map(() => 85);

  appState.charts.operarias = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Meta 85%",
          data: metaLine,
          type: "line",
          borderColor: "#ef4444",
          borderWidth: 2,
          borderDash: [6, 6],
          pointRadius: 0,
          fill: false,
          order: 1
        },
        {
          label: "Eficiencia %",
          data: data,
          backgroundColor: "#38bdf8",
          hoverBackgroundColor: "#0284c7",
          borderRadius: 4,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}%`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => v + "%" },
          grid: { color: "#f1f5f9" }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, family: "Outfit" } }
        }
      }
    }
  });
}

function renderChartTendenciaDiaria(registros) {
  const canvas = document.getElementById("chart-ger-tendencia");
  if (!canvas || typeof Chart === "undefined") return;

  if (appState.charts.tendencia) {
    appState.charts.tendencia.destroy();
  }

  // Agrupar por fecha
  const porFecha = {};
  registros.forEach(r => {
    const f = r.fecha;
    if (!f) return;
    if (!porFecha[f]) {
      porFecha[f] = { minSAM: 0, bloques: new Set() };
    }
    porFecha[f].minSAM += Number(r.minutos_ganados || 0);
    porFecha[f].bloques.add(`${r.operaria_id}_${r.hora_turno}`);
  });

  const fechasOrdenadas = Object.keys(porFecha).sort();
  const labels = fechasOrdenadas.map(f => {
    const parts = f.split("-");
    return `${parts[2]}/${parts[1]}`;
  });

  const dataEff = fechasOrdenadas.map(f => {
    const item = porFecha[f];
    const horas = item.bloques.size || 1;
    const disp = horas * 60;
    return disp > 0 ? Math.round(((item.minSAM / disp) * 100) * 10) / 10 : 0;
  });

  const metaLine = labels.map(() => 85);

  appState.charts.tendencia = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Meta 85%",
          data: metaLine,
          borderColor: "#ef4444",
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false
        },
        {
          label: "Eficiencia Diaria %",
          data: dataEff,
          borderColor: "#ec4899",
          backgroundColor: "rgba(236, 72, 153, 0.12)",
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: "#ec4899"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}%`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => v + "%" },
          grid: { color: "#f1f5f9" }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

function renderChartSemaforo(ranking) {
  const canvas = document.getElementById("chart-ger-semaforo");
  if (!canvas || typeof Chart === "undefined") return;

  if (appState.charts.semaforo) {
    appState.charts.semaforo.destroy();
  }

  let baja = 0;   // < 60%
  let media = 0;  // 60% - 84.9%
  let alta = 0;   // >= 85%

  ranking.forEach(r => {
    if (r.eficiencia >= 85) alta++;
    else if (r.eficiencia >= 60) media++;
    else baja++;
  });

  const total = ranking.length || 1;

  appState.charts.semaforo = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Baja (<60%)", "Media (60%-84%)", "Alta (>=85%)"],
      datasets: [
        {
          data: [baja, media, alta],
          backgroundColor: ["#f87171", "#fbbf24", "#34d399"],
          borderWidth: 2,
          borderColor: "#ffffff"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { size: 11, family: "Outfit" }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.raw;
              const pct = Math.round((val / total) * 100);
              return `${ctx.label}: ${val} operarias (${pct}%)`;
            }
          }
        }
      },
      cutout: "68%"
    }
  });
}

function renderizarPantallaOrdenesGerencial(ordenes) {
  // Scorecards de Pantalla 2
  const totalMeta = ordenes.reduce((acc, o) => acc + Number(o.cantidad_programada || 0), 0);
  const totalTerm = ordenes.reduce((acc, o) => acc + Number(o.prendas_terminadas || 0), 0);
  const cumplimiento = totalMeta > 0 ? (totalTerm / totalMeta) * 100 : 0;

  // Lead Time promedio en días
  const ahora = new Date();
  let sumaDias = 0;
  let ordenesConFecha = 0;

  ordenes.forEach(o => {
    if (o.created_at) {
      const creada = new Date(o.created_at);
      const diffMs = ahora - creada;
      const dias = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      sumaDias += dias;
      ordenesConFecha++;
    }
  });

  const leadTimePromedio = ordenesConFecha > 0 ? (sumaDias / ordenesConFecha).toFixed(1) : "0.0";
  const ritmoDiario = (Number(leadTimePromedio) > 0 ? (totalTerm / Number(leadTimePromedio)) : totalTerm).toFixed(1);

  document.getElementById("kpi-ger-cumplimiento").textContent = `${cumplimiento.toFixed(1)} %`;
  document.getElementById("kpi-ger-leadtime").textContent = `${leadTimePromedio} días`;
  document.getElementById("kpi-ger-finalizadas").textContent = totalTerm >= 1000 
    ? `${(totalTerm / 1000).toFixed(1)} mil` 
    : totalTerm.toLocaleString();
  document.getElementById("kpi-ger-ritmo-diario").textContent = `${ritmoDiario} uds/d`;

  document.getElementById("badge-total-ordenes-ger").textContent = `${ordenes.length} órdenes registradas`;

  // Tabla Maestra de Órdenes (con barra in-cell)
  const tbody = document.getElementById("tbody-ger-ordenes");
  tbody.innerHTML = "";

  if (ordenes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-message">No hay órdenes para mostrar.</td></tr>';
  } else {
    ordenes.forEach(ord => {
      const meta = ord.cantidad_programada || 1;
      const term = ord.prendas_terminadas || 0;
      const pct = Math.round((term / meta) * 100);
      const pctCapped = Math.min(pct, 100);

      let duracionTexto = "1 d";
      if (ord.created_at) {
        const diffD = Math.max(1, Math.round((ahora - new Date(ord.created_at)) / (1000 * 60 * 60 * 24)));
        duracionTexto = `${diffD} d`;
      }

      tbody.insertAdjacentHTML("beforeend", `
        <tr>
          <td style="font-weight:700; color:var(--mod-ger-primary);">${escapeHtml(ord.numero_op)}</td>
          <td style="font-weight:600;">${escapeHtml(ord.prendas?.referencia || "Sin ref")}</td>
          <td><span class="status-pill ${ord.estado}">${ord.estado.toUpperCase()}</span></td>
          <td>${duracionTexto}</td>
          <td>${meta.toLocaleString()}</td>
          <td>${term.toLocaleString()}</td>
          <td>
            <div class="table-progress-cell">
              <div class="table-progress-bar">
                <div class="table-progress-fill" style="width:${pctCapped}%;"></div>
              </div>
              <span style="font-size:0.8rem; font-weight:700; width:45px; text-align:right;">${pct}%</span>
            </div>
          </td>
        </tr>
      `);
    });
  }

  // Gráfica Días por Referencia (Barras Horizontales)
  renderChartDiasReferencia(ordenes);

  // Gráfica Distribución por Estado (Dona)
  renderChartEstadosOrdenes(ordenes);
}

function renderChartDiasReferencia(ordenes) {
  const canvas = document.getElementById("chart-ger-dias-ref");
  if (!canvas || typeof Chart === "undefined") return;

  if (appState.charts.diasRef) {
    appState.charts.diasRef.destroy();
  }

  const ahora = new Date();
  const diasPorRef = {};

  ordenes.forEach(o => {
    const ref = o.prendas?.referencia || "Sin ref";
    const diffD = o.created_at 
      ? Math.max(1, Math.round((ahora - new Date(o.created_at)) / (1000 * 60 * 60 * 24)))
      : 1;

    if (!diasPorRef[ref] || diffD > diasPorRef[ref]) {
      diasPorRef[ref] = diffD;
    }
  });

  const refsOrdenadas = Object.keys(diasPorRef)
    .sort((a, b) => diasPorRef[b] - diasPorRef[a])
    .slice(0, 7); // Top 7 prendas

  const labels = refsOrdenadas.map(r => r.length > 20 ? r.substring(0, 18) + "..." : r);
  const data = refsOrdenadas.map(r => diasPorRef[r]);

  appState.charts.diasRef = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Días de Fabricación",
          data: data,
          backgroundColor: "#1e3a8a",
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { callback: (v) => v + " d" },
          grid: { color: "#f1f5f9" }
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 10, family: "Outfit" } }
        }
      }
    }
  });
}

function renderChartEstadosOrdenes(ordenes) {
  const canvas = document.getElementById("chart-ger-estados");
  if (!canvas || typeof Chart === "undefined") return;

  if (appState.charts.estados) {
    appState.charts.estados.destroy();
  }

  let finalizadas = 0;
  let activas = 0;
  let pausadas = 0;

  ordenes.forEach(o => {
    if (o.estado === "finalizada") finalizadas++;
    else if (o.estado === "activa") activas++;
    else pausadas++;
  });

  const total = ordenes.length || 1;

  appState.charts.estados = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Finalizada", "Activa", "Pausada"],
      datasets: [
        {
          data: [finalizadas, activas, pausadas],
          backgroundColor: ["#10b981", "#ec4899", "#f59e0b"],
          borderWidth: 2,
          borderColor: "#ffffff"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { size: 11, family: "Outfit" }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.raw;
              const pct = Math.round((val / total) * 100);
              return `${ctx.label}: ${val} (${pct}%)`;
            }
          }
        }
      },
      cutout: "68%"
    }
  });
}

// Exportar Reporte Ejecutivo a Excel
function exportarReporteGerencialExcel() {
  try {
    const eficTexto = document.getElementById("kpi-ger-eficiencia")?.textContent || "0%";
    const minSamTexto = document.getElementById("kpi-ger-min-sam")?.textContent || "0";
    const prendasTotTexto = document.getElementById("kpi-ger-prendas-tot")?.textContent || "0";
    const opsActTexto = document.getElementById("kpi-ger-operarias-act")?.textContent || "0";
    const minPerdTexto = document.getElementById("kpi-ger-min-perdidos")?.textContent || "0";

    const kpiData = [
      ["REPORTE EJECUTIVO GERENCIAL - RETOOS TEX"],
      ["Generado:", new Date().toLocaleString()],
      [],
      ["Indicador", "Valor"],
      ["Eficiencia Global de Planta", eficTexto],
      ["Minutos SAM Ganados", minSamTexto],
      ["Prendas Totales Confeccionadas", prendasTotTexto],
      ["Operarias Activas", opsActTexto],
      ["Minutos Perdidos", minPerdTexto]
    ];

    const wb = XLSX.utils.book_new();
    const wsKpis = XLSX.utils.aoa_to_sheet(kpiData);
    XLSX.utils.book_append_sheet(wb, wsKpis, "KPIs_Generales");

    // Hoja de Órdenes
    const ordenesFilas = [["Numero_OP", "Referencia", "Estado", "Meta", "Terminadas", "% Avance"]];
    appState.ordenes.forEach(o => {
      const meta = o.cantidad_programada || 0;
      const term = o.prendas_terminadas || 0;
      const pct = meta > 0 ? ((term / meta) * 100).toFixed(1) + "%" : "0%";
      ordenesFilas.push([
        o.numero_op,
        o.prendas?.referencia || "Sin ref",
        o.estado,
        meta,
        term,
        pct
      ]);
    });
    const wsOrdenes = XLSX.utils.aoa_to_sheet(ordenesFilas);
    XLSX.utils.book_append_sheet(wb, wsOrdenes, "Control_Ordenes");

    XLSX.writeFile(wb, `Reporte_Gerencial_RetoOS_Tex_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✓ Reporte ejecutivo descargado en Excel", "success");
  } catch (err) {
    showToast("Error al exportar reporte: " + err.message, "error");
  }
}
