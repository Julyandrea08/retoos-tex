/**
 * Google Apps Script - Backend Control de Producción MAINTEGRAL
 */

const SPREADSHEET_ID = '18ZoKaYG5AbiJ7XkR7IxUgnJhuKxp4fNmj5NAUrM_Fg4';

const TABS = {
  ORDENES:     'Ordenes',
  OPERACIONES: 'Operaciones_SAM',
  OPERARIAS:   'Operarias',
  REGISTRO:    'Registro_Produccion',
  CONSOLIDADO: 'Consolidado_Diario',
  ORDENES_KPI: 'Consolidado_Ordenes'
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Control de Producción - Confección')
    .addMetaTag('viewport','width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function inicializarBaseDeDatos() {
  const ss = getSpreadsheet();
  if (!ss.getSheetByName(TABS.ORDENES)) {
    ss.insertSheet(TABS.ORDENES)
      .appendRow(['ID_Orden','Referencia','Cantidad_Total','Estado','Fecha_Inicio']);
  }
  if (!ss.getSheetByName(TABS.OPERACIONES)) {
    ss.insertSheet(TABS.OPERACIONES)
      .appendRow(['ID_Operacion','Nombre_Operacion','SAM']);
  }
  if (!ss.getSheetByName(TABS.OPERARIAS)) {
    ss.insertSheet(TABS.OPERARIAS)
      .appendRow(['ID_Operaria','Nombre','Estado']);
  }
  if (!ss.getSheetByName(TABS.REGISTRO)) {
    ss.insertSheet(TABS.REGISTRO)
      .appendRow(['ID_Registro','Timestamp','Fecha','Hora_Turno','ID_Orden','ID_Operaria','ID_Operacion','Cantidad','Observaciones']);
  }
}

function getInitialData() {
  try {
    var ss = SpreadsheetApp.openById('18ZoKaYG5AbiJ7XkR7IxUgnJhuKxp4fNmj5NAUrM_Fg4');
    // Órdenes activas
    var ordenes = [];
    var shOrd = ss.getSheetByName('Ordenes');
    if (shOrd) {
      var rowsOrd = shOrd.getDataRange().getValues();
      for (var i = 1; i < rowsOrd.length; i++) {
        if (String(rowsOrd[i][3]).trim() === 'Activa') {
          ordenes.push({
            id:         String(rowsOrd[i][0] || ''),
            referencia: String(rowsOrd[i][1] || ''),
            meta:       Number(rowsOrd[i][2]) || 0
          });
        }
      }
    }
    // Operarias activas
    var operarias = [];
    var shOpe = ss.getSheetByName('Operarias');
    if (shOpe) {
      var rowsOpe = shOpe.getDataRange().getValues();
      for (var i = 1; i < rowsOpe.length; i++) {
        if (String(rowsOpe[i][2]).trim() === 'Activa') {
          operarias.push({
            id:     String(rowsOpe[i][0] || ''),
            nombre: String(rowsOpe[i][1] || '')
          });
        }
      }
    }
    // Operaciones SAM
    var operaciones = [];
    var shOps = ss.getSheetByName('Operaciones_SAM');
    if (shOps) {
      var rowsOps = shOps.getDataRange().getValues();
      for (var i = 1; i < rowsOps.length; i++) {
        if (rowsOps[i][0]) {
          operaciones.push({
            id:     String(rowsOps[i][0] || ''),
            nombre: String(rowsOps[i][1] || ''),
            sam:    Number(rowsOps[i][2]) || 0
          });
        }
      }
    }
    Logger.log('OK — Ordenes:' + ordenes.length + ' Operarias:' + operarias.length + ' Operaciones:' + operaciones.length);
    return {
      success:    true,
      ordenes:    ordenes,
      operarias:  operarias,
      operaciones: operaciones
    };
  } catch (e) {
    Logger.log('ERROR getInitialData: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

function guardarRegistro(formData) {
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.REGISTRO);
    if (!sheet) return { success:false, error:'No existe: ' + TABS.REGISTRO };

    const lastRow   = sheet.getLastRow();
    const idRegistro = 'REG-' + String(lastRow + 1000).padStart(5,'0');
    const timestamp  = new Date();
    const fecha      = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    sheet.appendRow([
      idRegistro, timestamp, fecha,
      Number(formData.horaTurno), formData.idOrden,
      formData.idOperaria || '', formData.idOperacion,
      Number(formData.cantidad), formData.observaciones || ''
    ]);

    if (formData.idOperacion === 'OP30') {
      const lr2 = sheet.getLastRow();
      sheet.appendRow([
        'REG-' + String(lr2 + 1000).padStart(5,'0'),
        timestamp, fecha, Number(formData.horaTurno), formData.idOrden,
        '', 'PRENDAS_FINALIZADAS', Number(formData.cantidad), 'Automático por OP30'
      ]);
    }

    return { success:true, id:idRegistro };
  } catch(e) {
    return { success:false, error:e.toString() };
  }
}

function getDashboardData(filtroFecha, filtroOrden) {
  try {
    const ss      = getSpreadsheet();
    const shReg   = ss.getSheetByName(TABS.REGISTRO);
    const shOrd   = ss.getSheetByName(TABS.ORDENES);
    const shOps   = ss.getSheetByName(TABS.OPERACIONES);
    const shOpe   = ss.getSheetByName(TABS.OPERARIAS);

    const rawReg  = shReg ? shReg.getDataRange().getValues() : [[]];
    const rawOrd  = shOrd ? shOrd.getDataRange().getValues() : [[]];
    const rawOps  = shOps ? shOps.getDataRange().getValues() : [[]];

    // Mapa operaciones
    const opsMap = {};
    for (let i = 1; i < rawOps.length; i++) {
      opsMap[rawOps[i][0]] = { nombre: rawOps[i][1], sam: Number(rawOps[i][2]) };
    }

    // Mapa nombres operarias (cargado una vez)
    const operariasNombres = {};
    if (shOpe) {
      const rawOpe = shOpe.getDataRange().getValues();
      for (let i = 1; i < rawOpe.length; i++) {
        operariasNombres[String(rawOpe[i][0])] = String(rawOpe[i][1]);
      }
    }

    // Órdenes activas
    const activeOrders = {};
    for (let i = 1; i < rawOrd.length; i++) {
      if (String(rawOrd[i][3]).trim() === 'Activa') {
        activeOrders[rawOrd[i][0]] = {
          id: rawOrd[i][0], referencia: rawOrd[i][1],
          meta: Number(rawOrd[i][2]), prendasTerminadas: 0,
          horasTrabajadasTotales: 0, minutosEstandarGanados: 0
        };
      }
    }

    const listaOrdenesActivas = Object.values(activeOrders)
      .map(o => ({ id: o.id, referencia: o.referencia }));

    if (filtroOrden) {
      Object.keys(activeOrders).forEach(k => {
        if (k !== filtroOrden) delete activeOrders[k];
      });
    }

    const produccionPorHora  = {1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0,10:0,11:0};
    const detallesActividad  = [];
    const operariasEficiencia = {};

    for (let i = 1; i < rawReg.length; i++) {
      if (filtroFecha) {
        const fr  = rawReg[i][2];
        const fStr = (fr instanceof Date)
          ? Utilities.formatDate(fr, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(fr);
        if (fStr !== filtroFecha) continue;
      }

      const idOrden    = rawReg[i][4];
      if (!activeOrders[idOrden]) continue;

      const hora       = Number(rawReg[i][3]);
      const idOperaria = String(rawReg[i][5] || '');
      const idOperacion= rawReg[i][6];
      const cantidad   = Number(rawReg[i][7]);

      if (idOperacion === 'PRENDAS_FINALIZADAS') {
        activeOrders[idOrden].prendasTerminadas += cantidad;
        if (produccionPorHora[hora] !== undefined) produccionPorHora[hora] += cantidad;
      } else {
        const opData = opsMap[idOperacion];
        if (opData) {
          const mins = cantidad * opData.sam;
          activeOrders[idOrden].minutosEstandarGanados += mins;

          if (idOperaria) {
            if (!operariasEficiencia[idOperaria]) {
              operariasEficiencia[idOperaria] = {
                nombre: operariasNombres[idOperaria] || idOperaria,
                minutosGanadosPorHora:  {1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0,10:0,11:0},
                prendasPorHora:         {1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0,10:0,11:0},
                tieneRegistroEnHora:    {1:false,2:false,3:false,4:false,5:false,6:false,7:false,8:false,9:false,10:false,11:false}
              };
            }
            if (operariasEficiencia[idOperaria].minutosGanadosPorHora[hora] !== undefined) {
              operariasEficiencia[idOperaria].minutosGanadosPorHora[hora] += mins;
              operariasEficiencia[idOperaria].prendasPorHora[hora]        += cantidad;
              operariasEficiencia[idOperaria].tieneRegistroEnHora[hora]    = true;
            }
          }

          detallesActividad.push({
            idOperaria: idOperaria,
            operaria:   operariasNombres[idOperaria] || idOperaria,
            hora:       'H' + hora,
            operacion:  opData.nombre,
            cantidad:   cantidad
          });
        }
      }
    }

    const listadoEficiencia = Object.keys(operariasEficiencia).map(id => {
      const op = operariasEficiencia[id];
      const horasEficiencia = {};
      for (let h = 1; h <= 11; h++) {
        horasEficiencia[h] = op.tieneRegistroEnHora[h]
          ? Math.round((op.minutosGanadosPorHora[h] / 60) * 100)
          : null;
      }
      return { id:id, nombre:op.nombre, horas:horasEficiencia, prendas:op.prendasPorHora };
    });

    detallesActividad.sort((a,b) => {
      const c = a.operaria.localeCompare(b.operaria);
      return c !== 0 ? c : a.hora.localeCompare(b.hora);
    });

    return {
      ordenes:           Object.values(activeOrders),
      listaOrdenesActivas: listaOrdenesActivas,
      produccionPorHora: Object.keys(produccionPorHora)
        .map(h => ({ hora:'H'+h, cantidad:produccionPorHora[h] })),
      eficiencias:       listadoEficiencia.sort((a,b) => a.nombre.localeCompare(b.nombre)),
      detallesActividad: detallesActividad
    };

  } catch(e) {
    Logger.log('ERROR getDashboardData: ' + e.toString());
    return { ordenes:[], listaOrdenesActivas:[], produccionPorHora:[], eficiencias:[], detallesActividad:[] };
  }
}

/**
 * ============================================================
 * CONSOLIDADO DIARIO POR OPERARIA (LOOKER STUDIO)
 * ============================================================
 * Jornada laboral Colombia: 42 horas/semana (Lunes a Sábado = 7h diarias = 420 min).
 * Descuento de desayuno: 20 minutos.
 * Minutos efectivos diarios de producción: 420 - 20 = 400 minutos.
 */
function actualizarConsolidadoDiario() {
  try {
    const ss = getSpreadsheet();
    const shReg = ss.getSheetByName(TABS.REGISTRO);
    const shOps = ss.getSheetByName(TABS.OPERACIONES);
    const shOpe = ss.getSheetByName(TABS.OPERARIAS);
    const shOrd = ss.getSheetByName(TABS.ORDENES);

    if (!shReg) {
      Logger.log("No existe la pestaña " + TABS.REGISTRO);
      return { success: false, error: "No existe pestaña Registro" };
    }

    // 1. Catálogo de Operaciones y su respectivo SAM
    const opsSAM = {};
    if (shOps) {
      const rawOps = shOps.getDataRange().getValues();
      for (let i = 1; i < rawOps.length; i++) {
        const idOp = String(rawOps[i][0] || '').trim();
        const sam = Number(rawOps[i][2]) || 0;
        if (idOp) opsSAM[idOp] = sam;
      }
    }

    // 2. Nombres de operarias
    const operariasNombres = {};
    if (shOpe) {
      const rawOpe = shOpe.getDataRange().getValues();
      for (let i = 1; i < rawOpe.length; i++) {
        const idOp = String(rawOpe[i][0] || '').trim();
        const nom = String(rawOpe[i][1] || '').trim();
        if (idOp) operariasNombres[idOp] = nom;
      }
    }

    // 3. Referencias de órdenes
    const ordenesRef = {};
    if (shOrd) {
      const rawOrd = shOrd.getDataRange().getValues();
      for (let i = 1; i < rawOrd.length; i++) {
        const idOrd = String(rawOrd[i][0] || '').trim();
        const ref = String(rawOrd[i][1] || '').trim();
        if (idOrd) ordenesRef[idOrd] = ref;
      }
    }

    // 4. Parámetros de jornada laboral (Colombia 42h: Lunes a Sábado)
    const MINUTOS_TURNO_BRUTO = 420; // 7 horas diarias
    const MINUTOS_DESAYUNO    = 20;  // 20 minutos de desayuno
    const MINUTOS_EFECTIVOS   = 400; // 400 minutos productivos netos

    // 5. Agrupar registros por Fecha y Operaria
    const rawReg = shReg.getDataRange().getValues();
    const consolidado = {};

    for (let i = 1; i < rawReg.length; i++) {
      const row = rawReg[i];
      const rawFecha = row[2];
      const horaTurno = Number(row[3]) || 0;
      const idOrden = String(row[4] || '').trim();
      const idOperaria = String(row[5] || '').trim();
      const idOperacion = String(row[6] || '').trim();
      const cantidad = Number(row[7]) || 0;

      // Omitir prendas finalizadas automáticas globales o registros sin operaria
      if (!idOperaria || idOperacion === 'PRENDAS_FINALIZADAS') continue;

      // Convertir fecha a texto YYYY-MM-DD estándar para Looker Studio
      let fechaStr = '';
      if (rawFecha instanceof Date) {
        fechaStr = Utilities.formatDate(rawFecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else if (rawFecha) {
        fechaStr = String(rawFecha).trim().substring(0, 10);
      }
      if (!fechaStr) continue;

      const key = fechaStr + '___' + idOperaria;

      if (!consolidado[key]) {
        consolidado[key] = {
          fecha: fechaStr,
          idOperaria: idOperaria,
          nombre: operariasNombres[idOperaria] || idOperaria,
          ordenes: {},
          horas: {},
          prendasTotales: 0,
          minutosSAM: 0
        };
      }

      const sam = opsSAM[idOperacion] || 0;
      consolidado[key].prendasTotales += cantidad;
      consolidado[key].minutosSAM += (cantidad * sam);
      if (idOrden) {
        const refTexto = ordenesRef[idOrden] ? idOrden + ' (' + ordenesRef[idOrden] + ')' : idOrden;
        consolidado[key].ordenes[refTexto] = true;
      }
      if (horaTurno > 0) consolidado[key].horas[horaTurno] = true;
    }

    // 6. Estructurar filas para la hoja
    const salida = [];
    for (const k in consolidado) {
      const item = consolidado[k];
      const minGanados = Math.round(item.minutosSAM * 100) / 100;
      const cantHoras = Object.keys(item.horas).length;
      
      // Prendas por hora registradas
      const prendasPorHora = cantHoras > 0 ? Math.round((item.prendasTotales / cantHoras) * 10) / 10 : 0;

      // Eficiencia diaria basada en los 400 minutos netos
      const eficiencia = Math.round((item.minutosSAM / MINUTOS_EFECTIVOS) * 1000) / 10;

      // Clasificación de desempeño
      let rango = 'Baja (<60%)';
      if (eficiencia >= 85) {
        rango = 'Alta (>=85%)';
      } else if (eficiencia >= 60) {
        rango = 'Media (60%-84%)';
      }

      const listaOrdenes = Object.keys(item.ordenes).join(', ');

      salida.push([
        item.fecha,
        item.idOperaria,
        item.nombre,
        listaOrdenes,
        item.prendasTotales,
        cantHoras,
        prendasPorHora,
        minGanados,
        MINUTOS_TURNO_BRUTO,
        MINUTOS_DESAYUNO,
        MINUTOS_EFECTIVOS,
        eficiencia / 100, // Formato decimal (0.885) para Looker Studio
        rango
      ]);
    }

    // 7. Ordenar cronológicamente (Fecha más reciente primero, luego operaria)
    salida.sort((a, b) => {
      const cmpFecha = b[0].localeCompare(a[0]);
      if (cmpFecha !== 0) return cmpFecha;
      return a[2].localeCompare(b[2]);
    });

    // 8. Escribir datos en la pestaña Consolidado_Diario
    let shConsol = ss.getSheetByName(TABS.CONSOLIDADO);
    if (!shConsol) {
      shConsol = ss.insertSheet(TABS.CONSOLIDADO);
    }

    shConsol.clearContents();

    const encabezados = [
      'Fecha',
      'ID_Operaria',
      'Nombre_Operaria',
      'Ordenes_Trabajadas',
      'Prendas_Totales',
      'Horas_Con_Registro',
      'Prendas_Por_Hora',
      'Minutos_SAM_Ganados',
      'Minutos_Turno_Bruto',
      'Minutos_Desayuno',
      'Minutos_Efectivos',
      'Eficiencia_Diaria',
      'Rango_Eficiencia'
    ];

    shConsol.getRange(1, 1, 1, encabezados.length)
      .setValues([encabezados])
      .setFontWeight('bold')
      .setBackground('#1e3a8a')
      .setFontColor('#ffffff');

    if (salida.length > 0) {
      shConsol.getRange(2, 1, salida.length, encabezados.length).setValues(salida);
      // Formatear columnas
      shConsol.getRange(2, 1, salida.length, 1).setNumberFormat('yyyy-mm-dd');
      shConsol.getRange(2, 5, salida.length, 1).setNumberFormat('#,##0');
      shConsol.getRange(2, 6, salida.length, 1).setNumberFormat('#,##0');
      shConsol.getRange(2, 7, salida.length, 1).setNumberFormat('#,##0.0');
      shConsol.getRange(2, 8, salida.length, 1).setNumberFormat('#,##0.00');
      shConsol.getRange(2, 9, salida.length, 1).setNumberFormat('#,##0');
      shConsol.getRange(2, 10, salida.length, 1).setNumberFormat('#,##0');
      shConsol.getRange(2, 11, salida.length, 1).setNumberFormat('#,##0');
      shConsol.getRange(2, 12, salida.length, 1).setNumberFormat('0.0%');
    }

    Logger.log("✅ Consolidado Diario generado: " + salida.length + " filas.");
    return { success: true, filas: salida.length };

  } catch (error) {
    Logger.log("❌ Error en actualizarConsolidadoDiario: " + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * ============================================================
 * CONSOLIDADO Y LEAD TIME DE ÓRDENES (LOOKER STUDIO)
 * ============================================================
 * Calcula cuánto tiempo tardó una orden desde el primer registro
 * hasta el último, prendas terminadas, días en planta y avance %.
 */
function actualizarConsolidadoOrdenes() {
  try {
    const ss = getSpreadsheet();
    const shReg = ss.getSheetByName(TABS.REGISTRO);
    const shOrd = ss.getSheetByName(TABS.ORDENES);
    const shOps = ss.getSheetByName(TABS.OPERACIONES);

    if (!shReg) return { success: false, error: "No existe pestaña Registro" };

    // 1. Obtener SAM de operaciones
    const opsSAM = {};
    if (shOps) {
      const rawOps = shOps.getDataRange().getValues();
      for (let i = 1; i < rawOps.length; i++) {
        const idOp = String(rawOps[i][0] || '').trim();
        const sam = Number(rawOps[i][2]) || 0;
        if (idOp) opsSAM[idOp] = sam;
      }
    }

    // 2. Mapear órdenes base
    const ordenesData = {};
    if (shOrd) {
      const rawOrd = shOrd.getDataRange().getValues();
      for (let i = 1; i < rawOrd.length; i++) {
        const idOrd = String(rawOrd[i][0] || '').trim();
        if (!idOrd) continue;
        ordenesData[idOrd] = {
          idOrden: idOrd,
          referencia: String(rawOrd[i][1] || '').trim(),
          meta: Number(rawOrd[i][2]) || 0,
          estado: String(rawOrd[i][3] || 'Activa').trim(),
          fechaInicioConfig: rawOrd[i][4] instanceof Date ? rawOrd[i][4] : null,
          primerTimestamp: null,
          ultimoTimestamp: null,
          diasSet: {},
          horasSet: {},
          operariasSet: {},
          prendasTerminadas: 0,
          minutosSAM: 0
        };
      }
    }

    // 3. Procesar registros de producción para medir tiempos reales
    const rawReg = shReg.getDataRange().getValues();

    for (let i = 1; i < rawReg.length; i++) {
      const row = rawReg[i];
      const rawTimestamp = row[1];
      const rawFecha = row[2];
      const horaTurno = Number(row[3]) || 0;
      const idOrden = String(row[4] || '').trim();
      const idOperaria = String(row[5] || '').trim();
      const idOperacion = String(row[6] || '').trim();
      const cantidad = Number(row[7]) || 0;

      if (!idOrden) continue;

      if (!ordenesData[idOrden]) {
        ordenesData[idOrden] = {
          idOrden: idOrden,
          referencia: '',
          meta: 0,
          estado: 'Activa',
          fechaInicioConfig: null,
          primerTimestamp: null,
          ultimoTimestamp: null,
          diasSet: {},
          horasSet: {},
          operariasSet: {},
          prendasTerminadas: 0,
          minutosSAM: 0
        };
      }

      // Convertir y rastrear timestamp para tiempo transcurrido
      let ts = null;
      if (rawTimestamp instanceof Date) {
        ts = rawTimestamp;
      } else if (rawFecha instanceof Date) {
        ts = rawFecha;
      }

      if (ts) {
        if (!ordenesData[idOrden].primerTimestamp || ts < ordenesData[idOrden].primerTimestamp) {
          ordenesData[idOrden].primerTimestamp = ts;
        }
        if (!ordenesData[idOrden].ultimoTimestamp || ts > ordenesData[idOrden].ultimoTimestamp) {
          ordenesData[idOrden].ultimoTimestamp = ts;
        }
      }

      // Rastrear días y horas de producción
      let fechaStr = '';
      if (rawFecha instanceof Date) {
        fechaStr = Utilities.formatDate(rawFecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else if (rawFecha) {
        fechaStr = String(rawFecha).trim().substring(0, 10);
      }
      if (fechaStr) {
        ordenesData[idOrden].diasSet[fechaStr] = true;
        if (horaTurno > 0) {
          ordenesData[idOrden].horasSet[fechaStr + '_H' + horaTurno] = true;
        }
      }

      if (idOperaria) {
        ordenesData[idOrden].operariasSet[idOperaria] = true;
      }

      // Conteo de prendas terminadas y SAM
      if (idOperacion === 'PRENDAS_FINALIZADAS') {
        ordenesData[idOrden].prendasTerminadas += cantidad;
      } else {
        const sam = opsSAM[idOperacion] || 0;
        ordenesData[idOrden].minutosSAM += (cantidad * sam);
      }
    }

    // 4. Formatear salida de órdenes
    const salidaOrdenes = [];

    for (const id in ordenesData) {
      const ord = ordenesData[id];
      const tz = Session.getScriptTimeZone();

      let fechaInicioTexto = ord.primerTimestamp
        ? Utilities.formatDate(ord.primerTimestamp, tz, 'yyyy-MM-dd HH:mm')
        : (ord.fechaInicioConfig ? Utilities.formatDate(ord.fechaInicioConfig, tz, 'yyyy-MM-dd') : 'Sin registros');

      let fechaFinTexto = ord.ultimoTimestamp
        ? Utilities.formatDate(ord.ultimoTimestamp, tz, 'yyyy-MM-dd HH:mm')
        : 'En proceso';

      // Cálculo de duración
      let diasCalendario = 0;
      let duracionTexto = 'En espera';

      if (ord.primerTimestamp && ord.ultimoTimestamp) {
        const diffMs = ord.ultimoTimestamp.getTime() - ord.primerTimestamp.getTime();
        const diffHorasTotales = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
        const diffDias = Math.floor(diffHorasTotales / 24);
        const horasRestantes = diffHorasTotales % 24;

        diasCalendario = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;

        if (diffDias === 0) {
          duracionTexto = diffHorasTotales + ' h';
        } else {
          duracionTexto = diffDias + ' d, ' + horasRestantes + ' h';
        }
      }

      const diasProduccionReales = Object.keys(ord.diasSet).length;
      const horasProduccionReales = Object.keys(ord.horasSet).length;
      const totalOperarias = Object.keys(ord.operariasSet).length;

      const porcentajeAvance = ord.meta > 0
        ? Math.min(1.0, Math.round((ord.prendasTerminadas / ord.meta) * 1000) / 1000)
        : 0;

      // Velocidad promedio por día de producción
      const prendasPorDia = diasProduccionReales > 0
        ? Math.round(ord.prendasTerminadas / diasProduccionReales)
        : ord.prendasTerminadas;

      salidaOrdenes.push([
        ord.idOrden,
        ord.referencia,
        ord.meta,
        ord.prendasTerminadas,
        porcentajeAvance,
        ord.estado,
        fechaInicioTexto,
        fechaFinTexto,
        duracionTexto,
        diasCalendario,
        diasProduccionReales,
        horasProduccionReales,
        prendasPorDia,
        totalOperarias,
        Math.round(ord.minutosSAM * 100) / 100
      ]);
    }

    // 5. Ordenar por ID de orden
    salidaOrdenes.sort((a, b) => String(b[0]).localeCompare(String(a[0])));

    // 6. Escribir en la pestaña Consolidado_Ordenes
    let shConsolOrd = ss.getSheetByName(TABS.ORDENES_KPI);
    if (!shConsolOrd) {
      shConsolOrd = ss.insertSheet(TABS.ORDENES_KPI);
    }

    shConsolOrd.clearContents();

    const encabezados = [
      'ID_Orden',
      'Referencia',
      'Cantidad_Meta',
      'Prendas_Terminadas',
      'Avance_%',
      'Estado',
      'Fecha_Inicio_Real',
      'Fecha_Ultimo_Registro',
      'Duracion_Total',
      'Dias_Calendario',
      'Dias_Produccion_Reales',
      'Horas_Produccion_Reales',
      'Prendas_Dia_Promedio',
      'Operarias_Participantes',
      'Minutos_SAM_Totales'
    ];

    shConsolOrd.getRange(1, 1, 1, encabezados.length)
      .setValues([encabezados])
      .setFontWeight('bold')
      .setBackground('#0f766e') // Verde azulado elegante para órdenes
      .setFontColor('#ffffff');

    if (salidaOrdenes.length > 0) {
      shConsolOrd.getRange(2, 1, salidaOrdenes.length, encabezados.length).setValues(salidaOrdenes);
      // Formatear columnas
      shConsolOrd.getRange(2, 3, salidaOrdenes.length, 1).setNumberFormat('#,##0');
      shConsolOrd.getRange(2, 4, salidaOrdenes.length, 1).setNumberFormat('#,##0');
      shConsolOrd.getRange(2, 5, salidaOrdenes.length, 1).setNumberFormat('0.0%');
      shConsolOrd.getRange(2, 10, salidaOrdenes.length, 1).setNumberFormat('0.0');
      shConsolOrd.getRange(2, 11, salidaOrdenes.length, 1).setNumberFormat('#,##0');
      shConsolOrd.getRange(2, 12, salidaOrdenes.length, 1).setNumberFormat('#,##0');
      shConsolOrd.getRange(2, 13, salidaOrdenes.length, 1).setNumberFormat('#,##0');
      shConsolOrd.getRange(2, 14, salidaOrdenes.length, 1).setNumberFormat('#,##0');
      shConsolOrd.getRange(2, 15, salidaOrdenes.length, 1).setNumberFormat('#,##0.00');
    }

    Logger.log("✅ Consolidado de Órdenes generado: " + salidaOrdenes.length + " filas.");
    return { success: true, filas: salidaOrdenes.length };

  } catch (error) {
    Logger.log("❌ Error en actualizarConsolidadoOrdenes: " + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * ============================================================
 * EJECUCIÓN GENERAL DE AMBOS CONSOLIDADOS
 * ============================================================
 * Esta es la función que se debe conectar al Trigger/Activador horario.
 */
function actualizarTodosLosConsolidados() {
  const r1 = actualizarConsolidadoDiario();
  const r2 = actualizarConsolidadoOrdenes();
  return { consolidadoDiario: r1, consolidadoOrdenes: r2 };
}

/**
 * ============================================================
 * CONFIGURACIÓN AUTOMÁTICA DE ACTIVADORES (TRIGGERS)
 * ============================================================
 * Permite activar o desactivar la sincronización automática sin entrar a menús complejos.
 */
function configurarActivadorCadaHora() {
  eliminarActivadores();

  ScriptApp.newTrigger('actualizarTodosLosConsolidados')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log("✅ Activador configurado exitosamente: Se ejecutará automáticamente cada 1 hora.");
  try {
    SpreadsheetApp.getUi().alert("✅ ¡Activador Automático Configurado!\n\nLos consolidados para Looker Studio ahora se actualizarán solos cada 1 hora.");
  } catch (e) {}
}

function eliminarActivadores() {
  const triggers = ScriptApp.getProjectTriggers();
  let eliminados = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'actualizarTodosLosConsolidados') {
      ScriptApp.deleteTrigger(triggers[i]);
      eliminados++;
    }
  }
  Logger.log("Activadores antiguos eliminados: " + eliminados);
  return eliminados;
}

/**
 * Menú contextual en Google Sheets para ejecutar manualmente con 1 clic
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 MAINTEGRAL')
    .addItem('⚡ Actualizar TODO para Looker Studio', 'actualizarTodosLosConsolidados')
    .addSeparator()
    .addItem('👤 Actualizar Solo Consolidado Operarias', 'actualizarConsolidadoDiario')
    .addItem('📦 Actualizar Solo Tiempos de Órdenes', 'actualizarConsolidadoOrdenes')
    .addSeparator()
    .addItem('⏰ Activar Actualización Automática (Cada Hora)', 'configurarActivadorCadaHora')
    .addItem('❌ Desactivar Actualización Automática', 'desactivarActivadoresMenu')
    .addToUi();
}

function desactivarActivadoresMenu() {
  const cant = eliminarActivadores();
  try {
    SpreadsheetApp.getUi().alert("Se desactivaron " + cant + " activador(es) automáticos.");
  } catch (e) {}
}