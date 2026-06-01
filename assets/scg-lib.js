/* ============================================================================
 * SCG · Librería compartida (helpers puros, sin datos)
 * Usada por el portal (app/index.html) y el admin (app/admin.html).
 * Expone window.SCG_LIB.
 * ==========================================================================*/
(function (global) {
  "use strict";

  var ESQUEMA = {
    mensual_2:    { id: "mensual_2",    label: "2% mensual", periodicidad: "mensual",    tasa: 0.02 },
    trimestral_7: { id: "trimestral_7", label: "7% trimestral", periodicidad: "trimestral", tasa: 0.07 },
    mixto:        { id: "mixto",        label: "Mixto (2% mensual + 7% trimestral)", periodicidad: "mixto" },
  };
  function esquemaById(id) { return ESQUEMA[id] || ESQUEMA.mensual_2; }

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

  // Pago del periodo actual (lo que cobra "ahora").
  function pagoPeriodoActual(c) {
    if (c.esquema.id === "trimestral_7") return c.pagoTrimestral || 0;
    return c.pagoMensual || 0;
  }

  // Rendimiento anualizado aproximado según esquema.
  function rendimientoAnual(c) {
    if (c.esquema.id === "mensual_2") return 0.24;
    if (c.esquema.id === "trimestral_7") return 0.28;
    if (c.esquema.id === "mixto") {
      var m = (c.capitalMensual || 0) * 0.24;
      var t = (c.capitalTrimestral || 0) * 0.28;
      var cap = (c.capitalMensual || 0) + (c.capitalTrimestral || 0);
      return cap ? (m + t) / cap : 0;
    }
    return 0;
  }

  // Proyección determinística de pagos a `meses` meses (desde el 1 del mes del próximo pago,
  // o 2026-06-01 si no hay). Etiquetada como proyección.
  function proyectarPagos(c, meses) {
    meses = meses || 12;
    var pagos = [];
    var baseISO = (c.proximoPago && c.proximoPago.fecha) ? c.proximoPago.fecha : "2026-06-01";
    var base = new Date(String(baseISO).slice(0,10) + "T00:00:00");
    base = new Date(base.getFullYear(), base.getMonth(), 1);
    var esq = c.esquema.id;
    for (var i = 0; i < meses; i++) {
      var d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      var monto = 0;
      if (esq === "mensual_2") {
        monto = c.pagoMensual || 0;
      } else if (esq === "mixto") {
        monto = c.pagoMensual || 0;
        // porción trimestral cada 3 meses a partir del 2do mes de la proyección
        if (i > 0 && (i % 3 === 1)) monto += c.pagoTrimestral || 0;
      } else if (esq === "trimestral_7") {
        if (i % 3 === 0) monto = c.pagoTrimestral || 0; // base es el mes del próximo pago
      }
      var iso = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
      pagos.push({ fecha: iso, monto: Math.round(monto * 100) / 100, proyeccion: true });
    }
    return pagos;
  }

  // Normaliza una fila de la BD (snake_case) al objeto que usan helpers/render (camelCase).
  function normalizeRow(r) {
    if (!r) return null;
    var num = function (v) { return v == null ? null : Number(v); };
    return {
      id: r.id,
      email: r.email,
      codigo: r.codigo,
      nombre: r.nombre,
      capital: num(r.capital),
      esquema: esquemaById(r.esquema),
      capitalMensual: num(r.capital_mensual),
      capitalTrimestral: num(r.capital_trimestral),
      pagoMensual: num(r.pago_mensual),
      pagoTrimestral: num(r.pago_trimestral),
      proximoPago: r.proximo_pago_fecha ? {
        fecha: r.proximo_pago_fecha, monto: num(r.proximo_pago_monto), detalle: r.proximo_pago_detalle || ""
      } : null,
      proximoPagoTrimestral: r.proximo_pago_trim_fecha ? {
        fecha: r.proximo_pago_trim_fecha, monto: num(r.proximo_pago_trim_monto), detalle: r.proximo_pago_trim_detalle || ""
      } : null,
      cicloDetalle: r.ciclo_detalle || null,
      nota: r.nota || null,
      estado: r.estado || "activo",
      liquidacion: r.liquidacion || null,
    };
  }

  // Calcula montos de pago sugeridos a partir de capital + esquema (para el admin).
  function calcularPagos(esquemaId, capital, capitalMensual, capitalTrimestral) {
    capital = Number(capital) || 0;
    if (esquemaId === "mensual_2") return { pagoMensual: round2(capital * 0.02), pagoTrimestral: null };
    if (esquemaId === "trimestral_7") return { pagoMensual: null, pagoTrimestral: round2(capital * 0.07) };
    if (esquemaId === "mixto") {
      var cm = Number(capitalMensual) || 0, ct = Number(capitalTrimestral) || 0;
      return { pagoMensual: round2(cm * 0.02), pagoTrimestral: round2(ct * 0.07) };
    }
    return { pagoMensual: null, pagoTrimestral: null };
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function esEmailPendiente(email) { return /@pendiente\.scg$/i.test(String(email || "")); }

  global.SCG_LIB = {
    ESQUEMA: ESQUEMA, esquemaById: esquemaById,
    fmtUSD: fmtUSD, fmtFecha: fmtFecha,
    pagoPeriodoActual: pagoPeriodoActual, rendimientoAnual: rendimientoAnual,
    proyectarPagos: proyectarPagos, normalizeRow: normalizeRow,
    calcularPagos: calcularPagos, round2: round2, esEmailPendiente: esEmailPendiente,
  };
})(typeof window !== "undefined" ? window : this);
