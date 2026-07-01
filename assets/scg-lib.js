/* ============================================================================
 * SCG · Librería compartida (helpers puros, sin datos)
 * Usada por el portal (app/cliente.html) y el admin (app/admin.html).
 * Expone window.SCG_LIB.
 *
 * MODELO DE ESQUEMA (flexible):
 *   - esquema = periodicidad: 'mensual' | 'trimestral' | 'semestral' | 'anual'
 *     + tasa (decimal por periodo, ej. 0.02 = 2%). Pago por periodo = capital * tasa.
 *   - 'mixto' = caso especial: porción mensual (capitalMensual @ tasaMensual) +
 *     porción trimestral (capitalTrimestral @ tasaTrimestral).
 * ==========================================================================*/
(function (global) {
  "use strict";

  var PERIODICIDADES = {
    mensual:    { id: "mensual",    label: "mensual",    mesesPorPeriodo: 1,  porAnio: 12 },
    trimestral: { id: "trimestral", label: "trimestral", mesesPorPeriodo: 3,  porAnio: 4 },
    semestral:  { id: "semestral",  label: "semestral",  mesesPorPeriodo: 6,  porAnio: 2 },
    anual:      { id: "anual",      label: "anual",      mesesPorPeriodo: 12, porAnio: 1 },
    mixto:      { id: "mixto",      label: "mixto",      mesesPorPeriodo: 1,  porAnio: 12 },
  };
  function esquemaById(id) { return PERIODICIDADES[id] || PERIODICIDADES.mensual; }

  function round2(n) { return Math.round(n * 100) / 100; }
  function fmtPct(t) {
    if (t == null || t === "") return "";
    var n = Math.round(t * 100 * 100) / 100; // hasta 2 decimales
    return n + "%";
  }
  function fmtUSD(n) {
    if (n == null || n === "") return "—";
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  var MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  function fmtFecha(iso) {
    if (!iso) return "—";
    var d = new Date(String(iso).slice(0,10) + "T00:00:00");
    return d.getDate() + " de " + MESES[d.getMonth()] + " " + d.getFullYear();
  }

  // Etiqueta legible del esquema (depende de la tasa).
  function esquemaLabel(esqId, tasa, tasaMensual, tasaTrimestral) {
    if (esqId === "mixto") {
      return "Mixto (" + fmtPct(tasaMensual) + " mensual + " + fmtPct(tasaTrimestral) + " trimestral)";
    }
    return fmtPct(tasa) + " " + esquemaById(esqId).label;
  }

  function pagoPeriodoActual(c) {
    if (c.esquema.id === "mixto") return c.pagoMensual || 0;
    if (c.pagoPeriodo != null) return c.pagoPeriodo;
    return round2((c.capital || 0) * (c.tasa || 0));
  }

  function rendimientoAnual(c) {
    if (c.esquema.id === "mixto") {
      var m = (c.capitalMensual || 0) * (c.tasaMensual || 0) * 12;
      var t = (c.capitalTrimestral || 0) * (c.tasaTrimestral || 0) * 4;
      var cap = (c.capitalMensual || 0) + (c.capitalTrimestral || 0);
      return cap ? (m + t) / cap : 0;
    }
    return (c.tasa || 0) * esquemaById(c.esquema.id).porAnio;
  }

  // Proyección determinística de pagos a `meses` meses. Etiquetada como proyección.
  function proyectarPagos(c, meses) {
    meses = meses || 12;
    var pagos = [];
    var baseISO = (c.proximoPago && c.proximoPago.fecha) ? c.proximoPago.fecha : "2026-06-01";
    var base = new Date(String(baseISO).slice(0,10) + "T00:00:00");
    base = new Date(base.getFullYear(), base.getMonth(), 1);
    var esq = c.esquema.id;
    var pagoSimple = (c.pagoPeriodo != null) ? c.pagoPeriodo : round2((c.capital || 0) * (c.tasa || 0));
    var step = esquemaById(esq).mesesPorPeriodo;
    for (var i = 0; i < meses; i++) {
      var d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      var monto = 0;
      if (esq === "mixto") {
        monto = c.pagoMensual || 0;
        if (i > 0 && (i % 3 === 1)) monto += c.pagoTrimestral || 0;
      } else {
        if (i % step === 0) monto = pagoSimple;
      }
      var iso = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
      pagos.push({ fecha: iso, monto: round2(monto), proyeccion: true });
    }
    return pagos;
  }

  // Normaliza una fila de la BD (snake_case) al objeto camelCase que usan los helpers.
  function normalizeRow(r) {
    if (!r) return null;
    var num = function (v) { return v == null ? null : Number(v); };
    var per = esquemaById(r.esquema);
    return {
      id: r.id, email: r.email, username: r.username, codigo: r.codigo, nombre: r.nombre,
      capital: num(r.capital),
      esquema: { id: per.id, periodicidad: per.id, mesesPorPeriodo: per.mesesPorPeriodo, porAnio: per.porAnio,
        label: esquemaLabel(r.esquema, num(r.tasa), num(r.tasa_mensual), num(r.tasa_trimestral)) },
      tasa: num(r.tasa), pagoPeriodo: num(r.pago_periodo),
      capitalMensual: num(r.capital_mensual), capitalTrimestral: num(r.capital_trimestral),
      tasaMensual: num(r.tasa_mensual), tasaTrimestral: num(r.tasa_trimestral),
      pagoMensual: num(r.pago_mensual), pagoTrimestral: num(r.pago_trimestral),
      proximoPago: r.proximo_pago_fecha ? { fecha: r.proximo_pago_fecha, monto: num(r.proximo_pago_monto), detalle: r.proximo_pago_detalle || "" } : null,
      proximoPagoTrimestral: r.proximo_pago_trim_fecha ? { fecha: r.proximo_pago_trim_fecha, monto: num(r.proximo_pago_trim_monto), detalle: r.proximo_pago_trim_detalle || "" } : null,
      cicloDetalle: r.ciclo_detalle || null, nota: r.nota || null,
      estado: r.estado || "activo", liquidacion: r.liquidacion || null,
    };
  }

  // Extra por única vez al agregar capital a mitad de período (rendimiento prorrateado).
  // extra = monto * tasa * (díasRestantes / díasDelPeríodo). Se suma al próximo pago de esa bolsa.
  // fechaAporte y fechaProximoPago en 'YYYY-MM-DD'. mesesPorPeriodo: 1 (mensual) / 3 (trimestral).
  function prorrateoAporte(monto, tasa, fechaAporte, fechaProximoPago, mesesPorPeriodo) {
    monto = Number(monto) || 0; tasa = Number(tasa) || 0; mesesPorPeriodo = mesesPorPeriodo || 1;
    if (!monto || !tasa || !fechaAporte || !fechaProximoPago) return 0;
    var DIA = 86400000;
    var pago = new Date(String(fechaProximoPago).slice(0,10) + "T00:00:00");
    var aporte = new Date(String(fechaAporte).slice(0,10) + "T00:00:00");
    var inicioPeriodo = new Date(pago.getFullYear(), pago.getMonth() - mesesPorPeriodo, pago.getDate());
    var diasPeriodo = Math.round((pago - inicioPeriodo) / DIA);
    if (diasPeriodo <= 0) return 0;
    var diasRestantes = Math.round((pago - aporte) / DIA);
    if (diasRestantes < 0) diasRestantes = 0;
    if (diasRestantes > diasPeriodo) diasRestantes = diasPeriodo;
    return round2(monto * tasa * (diasRestantes / diasPeriodo));
  }

  // Recalcula bolsas + pagos + estado de un cliente a partir de sus movimientos.
  // clientRow: fila snake_case de la BD. movimientos: array de client_movimientos.
  // Devuelve un patch (snake_case) con los campos a actualizar en el cliente.
  // NO aplica prorrateo (eso es una sola vez, en addMovimiento). NO fuerza estado='activo'.
  function recomputarCliente(clientRow, movimientos) {
    var r = clientRow || {};
    var movs = movimientos || [];
    var esq = r.esquema || "mensual";
    function sumBolsa(filter) {
      var t = 0;
      movs.forEach(function (m) {
        if (!filter(m)) return;
        var monto = Number(m.monto) || 0;
        t += (m.tipo === "retiro") ? -monto : monto;
      });
      return t < 0 ? 0 : t;
    }
    var patch = {};
    if (esq === "mixto") {
      var bolsaM = sumBolsa(function (m) { return m.destino === "mensual"; });
      var bolsaT = sumBolsa(function (m) { return m.destino === "trimestral"; });
      var tasaM = Number(r.tasa_mensual) || 0;
      var tasaT = Number(r.tasa_trimestral) || 0;
      patch.capital_mensual = round2(bolsaM);
      patch.capital_trimestral = round2(bolsaT);
      patch.capital = round2(bolsaM + bolsaT);
      patch.pago_mensual = round2(bolsaM * tasaM);
      patch.pago_trimestral = round2(bolsaT * tasaT);
      patch.proximo_pago_monto = patch.pago_mensual;
      patch.proximo_pago_trim_monto = patch.pago_trimestral;
    } else {
      var bolsa = sumBolsa(function () { return true; });
      var tasa = Number(r.tasa) || 0;
      patch.capital = round2(bolsa);
      patch.pago_periodo = round2(bolsa * tasa);
      patch.proximo_pago_monto = patch.pago_periodo;
    }
    if (patch.capital <= 0) patch.estado = "liquidado";
    return patch;
  }

  // Sugerencia de pagos a partir de capital + tasa (para el admin). Tasas en decimal.
  function calcularPagos(esqId, capital, tasa, capMensual, tasaMensual, capTrimestral, tasaTrimestral) {
    if (esqId === "mixto") {
      return { pagoMensual: round2((Number(capMensual)||0) * (Number(tasaMensual)||0)),
               pagoTrimestral: round2((Number(capTrimestral)||0) * (Number(tasaTrimestral)||0)) };
    }
    return { pagoPeriodo: round2((Number(capital)||0) * (Number(tasa)||0)) };
  }

  global.SCG_LIB = {
    PERIODICIDADES: PERIODICIDADES, esquemaById: esquemaById, esquemaLabel: esquemaLabel,
    fmtUSD: fmtUSD, fmtFecha: fmtFecha, fmtPct: fmtPct, round2: round2,
    pagoPeriodoActual: pagoPeriodoActual, rendimientoAnual: rendimientoAnual,
    proyectarPagos: proyectarPagos, normalizeRow: normalizeRow, calcularPagos: calcularPagos,
    prorrateoAporte: prorrateoAporte, recomputarCliente: recomputarCliente,
  };
})(typeof window !== "undefined" ? window : this);
