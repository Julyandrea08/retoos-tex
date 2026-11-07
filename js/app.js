/**
 * ==============================================================================
 * APLICACIÓN DE CONTROL DE PISO TEXTIL - SaaS EN LA NUBE
 * Conexión nativa con Supabase y arquitectura multi-empresa
 * ==============================================================================
 */

// Estado global de la aplicación
const appState = {
  empresa: null,
  bloquesHorarios: [],
  ordenes: [],
  prendas: [],
  operaciones: [],
  operarias: [],
  registros: [],
  isAdmin: false,
  adminPin: "1234"
};

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    showLoader(true, "Conectando con la nube...");
    await cargarDatosEmpresa();
    await cargarMaestros();
    generarBloquesHorarios();
    autoDetectHoraTurno();
    inicializarFiltrosDashboard();
    configurarSearchableSelects();
    
    // Si ya tenía sesión de admin guardada
    if (localStorage.getItem("texflow_is_admin") === "true") {
      activarModoAdmin(true, false);
    }

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
// NAVEGACIÓN ENTRE PANTALLAS
// ==============================================================================
function switchView(viewId) {
  if (viewId === "admin" && !appState.isAdmin) {
    abrirModalAdminPin();
    return;
  }

  document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  const targetView = document.getElementById("view-" + viewId);
  const targetNav = document.getElementById("nav-" + viewId);

  if (targetView) targetView.classList.add("active");
  if (targetNav) targetNav.classList.add("active");

  if (viewId === "dashboard") {
    actualizarDashboard();
  } else if (viewId === "admin") {
    cargarDatosAdmin();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
  lucide.createIcons();
}

// ==============================================================================
// 1. CARGA DE DATOS DESDE SUPABASE
// ==============================================================================
async function cargarDatosEmpresa() {
  const { data, error } = await supabase
    .from("empresas")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error("No se pudo cargar la información de la empresa.");
  }

  appState.empresa = data;
  document.getElementById("header-company-name").textContent = data.nombre_empresa;
}

async function cargarMaestros() {
  const empresaId = appState.empresa.id;

  // Cargar Órdenes activas
  const { data: ordenesData } = await supabase
    .from("ordenes_produccion")
    .select("*, prendas(id, referencia, descripcion, sam_total)")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false });
  appState.ordenes = ordenesData || [];

  // Cargar Prendas
  const { data: prendasData } = await supabase
    .from("prendas")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("referencia");
  appState.prendas = prendasData || [];

  // Cargar Operaciones
  const { data: opsData } = await supabase
    .from("operaciones_prenda")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("codigo_operacion");
  appState.operaciones = opsData || [];

  // Cargar Operarias
  const { data: operariasData } = await supabase
    .from("operarias")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("nombre");
  appState.operarias = operariasData || [];

  poblarSelectOrdenesRegistro();
}

// ==============================================================================
// 2. CONFIGURACIÓN DINÁMICA DE HORAS Y TURNOS (Punto 1)
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
  const selectHora = document.getElementById("reg-hora");
  selectHora.innerHTML = "";

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

    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = label;
    selectHora.appendChild(opt);

    // Sumar el almuerzo si aplica en este bloque
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

  const selectHora = document.getElementById("reg-hora");
  if (selectHora) selectHora.value = bloqueDetectado;
}

// ==============================================================================
// 3. SEARCHABLE SELECTS & FILTRO DE OPERACIONES POR PRENDA (Punto 4)
// ==============================================================================
function poblarSelectOrdenesRegistro() {
  const select = document.getElementById("reg-orden");
  select.innerHTML = '<option value="" disabled selected>Seleccione una orden...</option>';

  const ordenesActivas = appState.ordenes.filter(o => o.estado === "activa");
  if (ordenesActivas.length === 0) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "No hay órdenes activas. Activa una en Admin.";
    select.appendChild(opt);
    return;
  }

  ordenesActivas.forEach(ord => {
    const opt = document.createElement("option");
    opt.value = ord.id;
    const ref = ord.prendas ? ord.prendas.referencia : "Sin ref";
    opt.textContent = `${ord.numero_op} — Ref: ${ref} (Meta: ${ord.cantidad_programada})`;
    select.appendChild(opt);
  });
}

function configurarSearchableSelects() {
  // Operarias activas
  const operariasActivas = appState.operarias
    .filter(op => op.estado === "activa")
    .map(op => ({
      value: op.id,
      label: `${op.codigo_operaria ? '[' + op.codigo_operaria + '] ' : ''}${op.nombre}`
    }));

  initSearchableSelect(
    "ss-operaria",
    "ss-operaria-input",
    "ss-operaria-list",
    "reg-operaria",
    operariasActivas,
    "Buscar operaria..."
  );

  // Operaciones vacías hasta que elija una orden
  initSearchableSelect(
    "ss-operacion",
    "ss-operacion-input",
    "ss-operacion-list",
    "reg-operacion",
    [],
    "Primero seleccione una orden..."
  );
}

// Al cambiar la orden, filtrar SOLO operaciones de la prenda asociada (Punto 4)
function alCambiarOrden() {
  const ordenId = document.getElementById("reg-orden").value;
  const orden = appState.ordenes.find(o => o.id === ordenId);
  const containerInfoPrenda = document.getElementById("reg-prenda-info");

  if (!orden || !orden.prenda_id) {
    if (containerInfoPrenda) containerInfoPrenda.style.display = "none";
    return;
  }

  // Filtrar operaciones de esa prenda
  const opsPrenda = appState.operaciones
    .filter(op => op.prenda_id === orden.prenda_id)
    .map(op => ({
      value: op.id,
      label: `${op.codigo_operacion} — ${op.nombre_operacion} (SAM: ${op.sam})${op.es_operacion_final ? ' ⭐ [SALIDA FINAL]' : ''}`,
      sam: op.sam,
      es_final: op.es_operacion_final
    }));

  // Actualizar el buscador de operaciones
  const wrapper = document.getElementById("ss-operacion");
  const input = document.getElementById("ss-operacion-input");
  const list = document.getElementById("ss-operacion-list");
  const hidden = document.getElementById("reg-operacion");

  hidden.value = "";
  input.value = "";
  wrapper._items = opsPrenda;

  if (containerInfoPrenda) {
    containerInfoPrenda.style.display = "block";
    const refPrenda = orden.prendas ? orden.prendas.referencia : "";
    containerInfoPrenda.innerHTML = `<i data-lucide="tag"></i> Prenda: <strong>${refPrenda}</strong> &bull; Total Operaciones: <strong>${opsPrenda.length}</strong>`;
    lucide.createIcons();
  }

  showToast(`Operaciones cargadas para ${orden.prendas?.referencia || "la orden"}`, "success");
}

function initSearchableSelect(wrapperId, inputId, listId, hiddenId, items, placeholder) {
  const wrapper = document.getElementById(wrapperId);
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const hidden = document.getElementById(hiddenId);

  if (!wrapper || !input || !list || !hidden) return;

  wrapper._items = items;
  input.placeholder = placeholder || "Buscar...";

  renderDropdownItems(list, hidden, input, items, "");

  input.addEventListener("focus", () => {
    closeAllDropdowns(listId);
    wrapper.classList.add("open");
    list.classList.add("open");
    renderDropdownItems(list, hidden, input, wrapper._items || [], "");
  });

  input.addEventListener("input", () => {
    if (!list.classList.contains("open")) {
      list.classList.add("open");
    }
    renderDropdownItems(list, hidden, input, wrapper._items || [], input.value);
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

function renderDropdownItems(list, hidden, input, items, query) {
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
    });
  });
}

function closeAllDropdowns(exceptId) {
  document.querySelectorAll(".ss-dropdown.open").forEach(d => {
    if (d.id !== exceptId) d.classList.remove("open");
  });
}

// ==============================================================================
// 4. REGISTRAR AVANCE EN SUPABASE (Punto 5: Salida Finalizada)
// ==============================================================================
function cambiarCantidad(delta) {
  const input = document.getElementById("reg-cantidad");
  let val = parseInt(input.value) || 0;
  val = Math.max(1, val + delta);
  input.value = val;
}

function fijarCantidad(val) {
  document.getElementById("reg-cantidad").value = val;
}

async function enviarFormulario(event) {
  event.preventDefault();

  const horaTurno = parseInt(document.getElementById("reg-hora").value);
  const ordenId = document.getElementById("reg-orden").value;
  const operariaId = document.getElementById("reg-operaria").value;
  const operacionId = document.getElementById("reg-operacion").value;
  const cantidad = parseInt(document.getElementById("reg-cantidad").value);
  const observaciones = document.getElementById("reg-observaciones").value;

  if (!ordenId) {
    showToast("Seleccione una orden de producción.", "error");
    return;
  }
  if (!operariaId) {
    showToast("Seleccione la operaria.", "error");
    return;
  }
  if (!operacionId) {
    showToast("Seleccione la operación realizada.", "error");
    return;
  }
  if (!cantidad || cantidad <= 0) {
    showToast("La cantidad debe ser mayor a cero.", "error");
    return;
  }

  const submitBtn = document.getElementById("btn-submit-registro");
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Guardando...';

  try {
    // 1. Obtener datos de la operación (SAM y si es finalizadora)
    const opInfo = appState.operaciones.find(o => o.id === operacionId);
    const sam = opInfo ? Number(opInfo.sam) : 0;
    const esFinal = opInfo ? opInfo.es_operacion_final : false;
    const minutosGanados = Number((cantidad * sam).toFixed(3));

    // 2. Insertar en tabla registros_produccion
    const { data: nuevoReg, error: regError } = await supabase
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
      })
      .select()
      .single();

    if (regError) throw regError;

    // 3. Si la operación es finalizadora, actualizar prendas terminadas en la OP (Punto 5)
    if (esFinal) {
      const ordenActual = appState.ordenes.find(o => o.id === ordenId);
      const prendasPrevias = ordenActual ? (ordenActual.prendas_terminadas || 0) : 0;
      const nuevasPrendas = prendasPrevias + cantidad;

      await supabase
        .from("ordenes_produccion")
        .update({ prendas_terminadas: nuevasPrendas })
        .eq("id", ordenId);

      // Actualizar en el estado local
      if (ordenActual) ordenActual.prendas_terminadas = nuevasPrendas;
    }

    showToast(`✓ Avance guardado: ${cantidad} uds (${minutosGanados} min SAM)`, "success");

    // Limpieza de campos
    document.getElementById("reg-cantidad").value = 10;
    document.getElementById("reg-observaciones").value = "";
    
    // Auto avanzar si se requiere o mantener operaria
  } catch (error) {
    console.error("Error al guardar registro:", error);
    showToast("Error al guardar: " + error.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i data-lucide="check-circle-2"></i> Registrar Avance';
    lucide.createIcons();
  }
}

// ==============================================================================
// 5. TABLERO DE CONTROL (DASHBOARD) - PUNTOS 7, 8 Y 9
// ==============================================================================
function inicializarFiltrosDashboard() {
  const hoy = new Date().toISOString().split("T")[0];
  document.getElementById("dash-filter-date").value = hoy;
}

async function actualizarDashboard() {
  showLoader(true, "Actualizando tablero...");
  try {
    const fechaFiltro = document.getElementById("dash-filter-date").value;
    const ordenFiltro = document.getElementById("dash-filter-orden").value;
    const modoHistorico = document.getElementById("dash-filter-all-dates").checked;

    const empresaId = appState.empresa.id;

    // Poblar dropdown de órdenes en el filtro
    poblarFiltroOrdenesDashboard(ordenFiltro);

    // Consulta de registros con joins
    let query = supabase
      .from("registros_produccion")
      .select(`
        id, fecha, hora_turno, cantidad, minutos_ganados, observaciones,
        orden_id,
        ordenes_produccion(numero_op, cantidad_programada, prendas_terminadas, prendas(referencia)),
        operaria_id,
        operarias(codigo_operaria, nombre),
        operacion_id,
        operaciones_prenda(codigo_operacion, nombre_operacion, sam, es_operacion_final)
      `)
      .eq("empresa_id", empresaId);

    // Filtro por fecha (a menos que haya marcado ver histórico completo - Punto 7)
    if (!modoHistorico && fechaFiltro) {
      query = query.eq("fecha", fechaFiltro);
    }

    // Filtro por orden específica (Punto 7)
    if (ordenFiltro) {
      query = query.eq("orden_id", ordenFiltro);
    }

    const { data: registros, error } = await query.order("hora_turno", { ascending: true });
    if (error) throw error;

    appState.registros = registros || [];

    // 1. Renderizar Progreso de Órdenes
    renderizarProgresoOrdenes(ordenFiltro);

    // 2. Renderizar Barras Hora a Hora
    renderizarBarrasHorarias();

    // 3. Renderizar Tabla de Eficiencia de Operarias con Totales (Punto 8)
    renderizarTablaEficiencias();

    // 4. Renderizar Detalle de Operaciones y Resumen Totalizador (Punto 9)
    renderizarDetalleOperaciones();

  } catch (error) {
    console.error("Error al actualizar dashboard:", error);
    showToast("Error al cargar dashboard: " + error.message, "error");
  } finally {
    showLoader(false);
    lucide.createIcons();
  }
}

function poblarFiltroOrdenesDashboard(seleccionada) {
  const select = document.getElementById("dash-filter-orden");
  select.innerHTML = '<option value="">Todas las órdenes</option>';

  appState.ordenes.forEach(ord => {
    const opt = document.createElement("option");
    opt.value = ord.id;
    const ref = ord.prendas ? ord.prendas.referencia : "";
    opt.textContent = `${ord.numero_op} — Ref: ${ref}`;
    if (ord.id === seleccionada) opt.selected = true;
    select.appendChild(opt);
  });
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
      <div class="order-progress-card">
        <div class="order-meta-info">
          <h4>${escapeHtml(ord.numero_op)} &bull; <span class="order-ref">${escapeHtml(ord.prendas?.referencia || "Sin ref")}</span></h4>
          <span class="status-pill ${ord.estado}">${ord.estado.toUpperCase()}</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${pctCapped}%"></div>
        </div>
        <div class="order-stats">
          <span>Progreso: <strong>${pct}%</strong></span>
          <span><span class="stat-completed">${terminadas}</span> / ${meta} prendas terminadas</span>
        </div>
      </div>
    `);
  });
}

function renderizarBarrasHorarias() {
  const container = document.getElementById("hourly-bars");
  container.innerHTML = "";

  const horasMap = {};
  appState.bloquesHorarios.forEach(b => { horasMap[b.valor] = 0; });

  // Sumar unidades producidas por hora
  appState.registros.forEach(r => {
    if (horasMap[r.hora_turno] !== undefined) {
      horasMap[r.hora_turno] += Number(r.cantidad) || 0;
    }
  });

  const maxCant = Math.max(...Object.values(horasMap), 10);

  appState.bloquesHorarios.forEach(b => {
    const cant = horasMap[b.valor] || 0;
    const pctHeight = (cant / maxCant) * 100;

    container.insertAdjacentHTML("beforeend", `
      <div class="bar-wrapper">
        <div class="bar" style="height: ${Math.max(pctHeight, 4)}%">
          <span class="bar-value">${cant > 0 ? cant : ''}</span>
        </div>
        <span class="bar-label">H${b.valor}</span>
      </div>
    `);
  });
}

// Punto 8: Tabla de Eficiencia con Total Unidades y % Eficiencia Día
function renderizarTablaEficiencias() {
  const tbody = document.getElementById("efficiency-tbody");
  tbody.innerHTML = "";

  if (appState.registros.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="empty-message">No hay registros con los filtros seleccionados.</td></tr>';
    return;
  }

  // Agrupar registros por operaria
  const operariasStats = {};

  appState.registros.forEach(r => {
    const opId = r.operaria_id;
    const nombre = r.operarias?.nombre || "Operaria";
    const codigo = r.operarias?.codigo_operaria ? `[${r.operarias.codigo_operaria}] ` : "";

    if (!operariasStats[opId]) {
      operariasStats[opId] = {
        nombre: codigo + nombre,
        horas: {},
        prendasHora: {},
        totalUnidades: 0,
        totalMinutosGanados: 0,
        horasTrabajadasCount: 0
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
            <div class="efficiency-qty">${cantPrendas} uds</div>
          </td>
        `;
      } else {
        trHtml += `<td><span class="badge-efficiency badge-none">-</span></td>`;
      }
    });

    // Punto 8: Columna Total Unidades
    trHtml += `<td class="col-total"><strong style="color: var(--primary); font-size: 0.9rem;">${op.totalUnidades} uds</strong></td>`;

    // Punto 8: Columna % Eficiencia Total del Día
    const minutosDisponiblesJornada = (horasConActividad || 1) * duracionHoraMin;
    const efDia = Math.round((op.totalMinutosGanados / minutosDisponiblesJornada) * 100);
    let badgeDiaClass = "badge-medium";
    if (efDia >= 85) badgeDiaClass = "badge-high";
    else if (efDia < 70) badgeDiaClass = "badge-low";

    trHtml += `
      <td class="col-total">
        <span class="badge-efficiency ${badgeDiaClass}" style="font-size: 0.85rem; padding: 6px 8px;">${efDia}%</span>
        <div class="efficiency-qty">${op.totalMinutosGanados.toFixed(1)} min SAM</div>
      </td>
    </tr>`;

    tbody.insertAdjacentHTML("beforeend", trHtml);
  });
}

// Punto 9: Detalle de Operaciones y Resumen Totalizador por Operaria
function renderizarDetalleOperaciones() {
  const selectOperariaFiltro = document.getElementById("detail-filter-operaria");
  const filtroActual = selectOperariaFiltro.value;

  // Poblar dropdown con operarias presentes en los registros
  const operariasMap = {};
  appState.registros.forEach(r => {
    if (r.operarias) {
      operariasMap[r.operaria_id] = r.operarias.nombre;
    }
  });

  selectOperariaFiltro.innerHTML = '<option value="">Todas las operarias</option>';
  Object.keys(operariasMap).sort().forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = operariasMap[id];
    if (id === filtroActual) opt.selected = true;
    selectOperariaFiltro.appendChild(opt);
  });

  filtrarDetalleOperaciones();
}

function filtrarDetalleOperaciones() {
  const opIdFiltro = document.getElementById("detail-filter-operaria").value;
  const tbody = document.getElementById("detalles-operaciones-tbody");
  tbody.innerHTML = "";

  const registrosFiltrados = opIdFiltro
    ? appState.registros.filter(r => r.operaria_id === opIdFiltro)
    : appState.registros;

  // Punto 9: Sumar unidades totales sin importar la operación realizada
  let totalUnidadesSumadas = 0;
  let totalMinutosSamSumados = 0;

  registrosFiltrados.forEach(r => {
    totalUnidadesSumadas += Number(r.cantidad) || 0;
    totalMinutosSamSumados += Number(r.minutos_ganados) || 0;
  });

  // Actualizar Tarjeta KPI Resumen (Punto 9)
  document.getElementById("kpi-total-unidades-detalle").textContent = `${totalUnidadesSumadas} unidades`;
  document.getElementById("kpi-total-sam-detalle").textContent = `${totalMinutosSamSumados.toFixed(1)} min`;

  if (registrosFiltrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-message">No hay operaciones registradas para este filtro.</td></tr>';
    return;
  }

  registrosFiltrados.forEach(r => {
    const nombreOp = r.operaciones_prenda ? r.operaciones_prenda.nombre_operacion : "Operación";
    const codOp = r.operaciones_prenda ? r.operaciones_prenda.codigo_operacion : "";
    const esFinal = r.operaciones_prenda?.es_operacion_final;

    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td style="text-align: left !important; font-weight: 500;">${escapeHtml(r.operarias?.nombre || "")}</td>
        <td><span class="badge-efficiency badge-none">H${r.hora_turno}</span></td>
        <td style="text-align: left !important;">
          <strong>[${codOp}]</strong> ${escapeHtml(nombreOp)}
          ${esFinal ? '<span class="status-pill activa" style="margin-left: 4px;">Fin</span>' : ''}
        </td>
        <td><strong style="color: var(--primary);">${r.cantidad} uds</strong></td>
        <td>${Number(r.minutos_ganados || 0).toFixed(2)} min</td>
      </tr>
    `);
  });
}

// Exportar datos actuales a CSV (Compatible con Excel - Punto 6)
function exportarReporteCSV() {
  if (appState.registros.length === 0) {
    showToast("No hay registros para exportar.", "error");
    return;
  }

  const encabezados = ["ID_Registro", "Fecha", "Hora_Turno", "Orden", "Operaria", "Operacion", "Cantidad", "Minutos_SAM", "Observaciones"];
  const filas = appState.registros.map(r => [
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
// 6. PANEL ADMINISTRADOR / MAESTROS (PUNTOS 2, 3, 4 Y 6)
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
    showToast("PIN incorrecto. (Por defecto es 1234)", "error");
  }
}

function activarModoAdmin(activar, guardar = true) {
  appState.isAdmin = activar;
  if (guardar) localStorage.setItem("texflow_is_admin", activar ? "true" : "false");

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

function switchAdminTab(tabId) {
  document.querySelectorAll(".admin-subnav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".admin-pane").forEach(p => p.classList.remove("active"));

  document.getElementById(`btn-admin-${tabId}`).classList.add("active");
  document.getElementById(`admin-pane-${tabId}`).classList.add("active");
  lucide.createIcons();
}

async function cargarDatosAdmin() {
  renderAdminOrdenes();
  renderAdminOperarias();
  renderAdminPrendas();
  renderAdminTurnos();
}

// --- SUBMÓDULO: ÓRDENES DE PRODUCCIÓN (Punto 2) ---
function renderAdminOrdenes() {
  const selectPrenda = document.getElementById("admin-op-prenda");
  selectPrenda.innerHTML = '<option value="" disabled selected>Seleccione prenda...</option>';
  appState.prendas.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.referencia} — ${p.descripcion || ''}`;
    selectPrenda.appendChild(opt);
  });

  const list = document.getElementById("admin-ordenes-list");
  list.innerHTML = "";

  if (appState.ordenes.length === 0) {
    list.innerHTML = '<p class="empty-message">No hay órdenes registradas.</p>';
    return;
  }

  appState.ordenes.forEach(ord => {
    list.insertAdjacentHTML("beforeend", `
      <div class="data-list-item">
        <div class="data-list-info">
          <h5>${escapeHtml(ord.numero_op)} &bull; <span style="color: var(--primary);">${escapeHtml(ord.prendas?.referencia || '')}</span></h5>
          <p>Meta: <strong>${ord.cantidad_programada} uds</strong> &bull; Terminadas: <strong>${ord.prendas_terminadas || 0}</strong> &bull; Estado: <span class="status-pill ${ord.estado}">${ord.estado}</span></p>
        </div>
        <div style="display:flex; gap:6px;">
          ${ord.estado !== 'activa' ? `<button class="btn btn-secondary btn-sm" onclick="cambiarEstadoOP('${ord.id}', 'activa')">Activar</button>` : ''}
          ${ord.estado === 'activa' ? `<button class="btn btn-secondary btn-sm" onclick="cambiarEstadoOP('${ord.id}', 'pausada')">Pausar</button>` : ''}
          ${ord.estado !== 'finalizada' ? `<button class="btn btn-secondary btn-sm" onclick="cambiarEstadoOP('${ord.id}', 'finalizada')">Finalizar</button>` : ''}
        </div>
      </div>
    `);
  });
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
    const { data, error } = await supabase
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
    poblarSelectOrdenesRegistro();
    renderAdminOrdenes();
    document.getElementById("admin-op-num").value = "";
    document.getElementById("admin-op-meta").value = "";
    showToast(`✓ Orden ${numOP} creada con éxito`, "success");
  } catch (err) {
    showToast("Error al crear OP: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

async function cambiarEstadoOP(id, nuevoEstado) {
  try {
    const { error } = await supabase
      .from("ordenes_produccion")
      .update({ estado: nuevoEstado })
      .eq("id", id);

    if (error) throw error;

    const op = appState.ordenes.find(o => o.id === id);
    if (op) op.estado = nuevoEstado;

    poblarSelectOrdenesRegistro();
    renderAdminOrdenes();
    showToast(`Orden actualizada a ${nuevoEstado}`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
}

// --- SUBMÓDULO: OPERARIAS / MÁSTER PERSONAL (Punto 3) ---
function renderAdminOperarias() {
  const list = document.getElementById("admin-operarias-list");
  list.innerHTML = "";

  if (appState.operarias.length === 0) {
    list.innerHTML = '<p class="empty-message">No hay operarias registradas.</p>';
    return;
  }

  appState.operarias.forEach(op => {
    const esActiva = op.estado === "activa";
    list.insertAdjacentHTML("beforeend", `
      <div class="data-list-item">
        <div class="data-list-info">
          <h5>${escapeHtml(op.nombre)} ${op.codigo_operaria ? `(${op.codigo_operaria})` : ''}</h5>
          <p>Módulo: <strong>${escapeHtml(op.modulo_linea || 'Línea 1')}</strong> &bull; Estado: <span class="status-pill ${op.estado}">${op.estado}</span></p>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="toggleEstadoOperaria('${op.id}', '${esActiva ? 'inactiva' : 'activa'}')">
          ${esActiva ? 'Inactivar' : 'Reactivar'}
        </button>
      </div>
    `);
  });
}

async function crearNuevaOperaria(event) {
  event.preventDefault();
  const nombre = document.getElementById("admin-operaria-nombre").value.trim();
  const codigo = document.getElementById("admin-operaria-codigo").value.trim();
  const modulo = document.getElementById("admin-operaria-modulo").value.trim();

  if (!nombre) {
    showToast("El nombre de la operaria es requerido.", "error");
    return;
  }

  showLoader(true, "Guardando operaria...");
  try {
    const { data, error } = await supabase
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
    configurarSearchableSelects();
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
    const { error } = await supabase
      .from("operarias")
      .update({ estado: nuevoEstado })
      .eq("id", id);

    if (error) throw error;

    const op = appState.operarias.find(o => o.id === id);
    if (op) op.estado = nuevoEstado;

    configurarSearchableSelects();
    renderAdminOperarias();
    showToast(`Operaria ${op.nombre} ahora está ${nuevoEstado}`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
}

// --- SUBMÓDULO: PRENDAS Y OPERACIONES (Punto 4) ---
function renderAdminPrendas() {
  const selectPrendaOps = document.getElementById("admin-operacion-prenda");
  selectPrendaOps.innerHTML = '<option value="" disabled selected>Seleccione prenda para asignarle operaciones...</option>';

  const list = document.getElementById("admin-prendas-list");
  list.innerHTML = "";

  appState.prendas.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.referencia} — ${p.descripcion || ''}`;
    selectPrendaOps.appendChild(opt);

    const opsDePrenda = appState.operaciones.filter(o => o.prenda_id === p.id);
    const samTotal = opsDePrenda.reduce((sum, o) => sum + Number(o.sam || 0), 0);

    list.insertAdjacentHTML("beforeend", `
      <div class="data-list-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <div style="display: flex; justify-content: space-between; width: 100%;">
          <h5><i data-lucide="shirt" style="width:16px;height:16px;display:inline;"></i> ${escapeHtml(p.referencia)}</h5>
          <strong style="color: var(--primary);">${samTotal.toFixed(3)} min SAM Total</strong>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(p.descripcion || 'Sin descripción')} &bull; ${opsDePrenda.length} operaciones</p>
        <div style="width: 100%; font-size: 0.78rem; background: #fff; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border-color);">
          ${opsDePrenda.map(o => `<div>&bull; <strong>[${o.codigo_operacion}]</strong> ${escapeHtml(o.nombre_operacion)} (${o.sam} min) ${o.es_operacion_final ? '⭐' : ''}</div>`).join('') || '<em>No tiene operaciones creadas aún</em>'}
        </div>
      </div>
    `);
  });
}

async function crearNuevaPrenda(event) {
  event.preventDefault();
  const ref = document.getElementById("admin-prenda-ref").value.trim();
  const desc = document.getElementById("admin-prenda-desc").value.trim();

  if (!ref) {
    showToast("La referencia de la prenda es requerida.", "error");
    return;
  }

  showLoader(true, "Creando prenda...");
  try {
    const { data, error } = await supabase
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
    renderAdminPrendas();
    renderAdminOrdenes();
    document.getElementById("admin-prenda-ref").value = "";
    document.getElementById("admin-prenda-desc").value = "";
    showToast(`✓ Prenda ${ref} registrada`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

async function agregarOperacionAPrenda(event) {
  event.preventDefault();
  const prendaId = document.getElementById("admin-operacion-prenda").value;
  const codOp = document.getElementById("admin-operacion-codigo").value.trim();
  const nombreOp = document.getElementById("admin-operacion-nombre").value.trim();
  const sam = parseFloat(document.getElementById("admin-operacion-sam").value);
  const esFinal = document.getElementById("admin-operacion-final").checked;

  if (!prendaId || !codOp || !nombreOp || isNaN(sam)) {
    showToast("Complete todos los datos de la operación.", "error");
    return;
  }

  showLoader(true, "Guardando operación...");
  try {
    const { data, error } = await supabase
      .from("operaciones_prenda")
      .insert({
        empresa_id: appState.empresa.id,
        prenda_id: prendaId,
        codigo_operacion: codOp,
        nombre_operacion: nombreOp,
        sam: sam,
        es_operacion_final: esFinal
      })
      .select()
      .single();

    if (error) throw error;

    appState.operaciones.push(data);
    renderAdminPrendas();
    document.getElementById("admin-operacion-codigo").value = "";
    document.getElementById("admin-operacion-nombre").value = "";
    document.getElementById("admin-operacion-sam").value = "";
    document.getElementById("admin-operacion-final").checked = false;
    showToast(`✓ Operación ${codOp} agregada a la ficha`, "success");
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    showLoader(false);
  }
}

// --- SUBMÓDULO: CONFIGURACIÓN DE TURNOS Y COSTEO (Puntos 1 y Costo Minuto) ---
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
    const { error } = await supabase
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
  setTimeout(() => { toast.classList.remove("show"); }, 3500);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
