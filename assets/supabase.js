/* ============================================================================
 * SCG · Capa de datos (Supabase + modo mock) — autenticación por usuario+contraseña
 * Expone window.SCG_DB con una API uniforme para portal y admin.
 *
 * El "usuario" corto (ej. orlando.vaca) se mapea al email técnico interno
 *   <usuario>@portal.santacruzconsulting.co
 * No se envía ningún correo: es solo el identificador de Supabase Auth.
 *
 * MODO MOCK: si no hay config válida o la URL trae ?mock=1, backend simulado.
 *   Demo:  ?mock=1&as=cliente   (cliente)   ó   ?mock=1&admin=1
 * ==========================================================================*/
(function (global) {
  "use strict";

  var SUPABASE_URL = "https://wtuytdjsvfakbojpbqer.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_pf9eCYfTH6jUO5oeOQjrmQ_DgvfNDmr";
  var LOGIN_DOMAIN = "portal.santacruzconsulting.co";

  var qp = new URLSearchParams(global.location ? global.location.search : "");
  var configurado = SUPABASE_URL.indexOf("http") === 0 && SUPABASE_ANON_KEY.length > 20;
  var MOCK = qp.get("mock") === "1" || !configurado;

  function userToEmail(u) { u = String(u || "").trim().toLowerCase(); return u.indexOf("@") >= 0 ? u : u + "@" + LOGIN_DOMAIN; }
  function emailToUser(e) { return String(e || "").split("@")[0]; }

  function toRow(c) {
    return {
      email: userToEmail(c.username), username: String(c.username || "").trim().toLowerCase(),
      codigo: c.codigo || null, nombre: c.nombre,
      capital: c.capital || 0, esquema: c.esquema,
      tasa: c.tasa != null ? c.tasa : null, pago_periodo: c.pagoPeriodo != null ? c.pagoPeriodo : null,
      tasa_mensual: c.tasaMensual != null ? c.tasaMensual : null, tasa_trimestral: c.tasaTrimestral != null ? c.tasaTrimestral : null,
      capital_mensual: c.capitalMensual || null, capital_trimestral: c.capitalTrimestral || null,
      pago_mensual: c.pagoMensual || null, pago_trimestral: c.pagoTrimestral || null,
      proximo_pago_fecha: c.proximoPagoFecha || null, proximo_pago_monto: c.proximoPagoMonto || null,
      proximo_pago_detalle: c.proximoPagoDetalle || null,
      proximo_pago_trim_fecha: c.proximoPagoTrimFecha || null, proximo_pago_trim_monto: c.proximoPagoTrimMonto || null,
      proximo_pago_trim_detalle: c.proximoPagoTrimDetalle || null,
      ciclo_detalle: c.cicloDetalle || null, nota: c.nota || null,
      estado: c.estado || "activo", liquidacion: c.liquidacion || null,
    };
  }

  var LIB = global.SCG_LIB;

  // Aplica el patch base de recomputarCliente y, si el movimiento recién agregado
  // es un aporte 'prorrateado', suma el extra por única vez al próximo pago de la bolsa.
  // Devuelve el patch final (snake_case) a persistir sobre el cliente.
  function patchConMovimiento(clientRow, movimientos, mov) {
    var patch = LIB.recomputarCliente(clientRow, movimientos);
    if (!mov || mov.rendimiento !== "prorrateado" || mov.tipo !== "aporte") return patch;
    var esq = clientRow.esquema || "mensual";
    var tasa, meses, proxFecha, campoMonto, campoDet, detBase;
    if (esq === "mixto") {
      if (mov.destino === "trimestral") {
        tasa = Number(clientRow.tasa_trimestral) || 0; meses = 3;
        proxFecha = clientRow.proximo_pago_trim_fecha;
        campoMonto = "proximo_pago_trim_monto"; campoDet = "proximo_pago_trim_detalle";
        detBase = clientRow.proximo_pago_trim_detalle;
      } else {
        tasa = Number(clientRow.tasa_mensual) || 0; meses = 1;
        proxFecha = clientRow.proximo_pago_fecha;
        campoMonto = "proximo_pago_monto"; campoDet = "proximo_pago_detalle";
        detBase = clientRow.proximo_pago_detalle;
      }
    } else {
      tasa = Number(clientRow.tasa) || 0;
      meses = (esq === "trimestral") ? 3 : (LIB.esquemaById(esq).mesesPorPeriodo || 1);
      proxFecha = clientRow.proximo_pago_fecha;
      campoMonto = "proximo_pago_monto"; campoDet = "proximo_pago_detalle";
      detBase = clientRow.proximo_pago_detalle;
    }
    var extra = LIB.prorrateoAporte(mov.monto, tasa, mov.fecha, proxFecha, meses);
    if (extra) {
      var base = patch[campoMonto] != null ? patch[campoMonto] : 0;
      patch[campoMonto] = LIB.round2(base + extra);
      var d = (detBase || "").trim();
      patch[campoDet] = (d ? d + " " : "") + "(incluye aporte prorrateado)";
    }
    return patch;
  }

  // =========================================================================
  // BACKEND REAL (Supabase)
  // =========================================================================
  function realDB() {
    var client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    function call(action, payload) {
      return client.functions.invoke("admin-users", { body: Object.assign({ action: action }, payload) })
        .then(function (r) {
          if (r.error) {
            // Intentar leer el mensaje real del cuerpo de la respuesta de la función
            var ctx = r.error.context;
            if (ctx && typeof ctx.json === "function") {
              return ctx.json().then(
                function (b) { throw new Error((b && b.error) || r.error.message); },
                function () { throw r.error; }
              );
            }
            throw r.error;
          }
          if (r.data && r.data.error) throw new Error(r.data.error);
          return r.data;
        });
    }
    return {
      mock: false,
      signIn: function (username, password) {
        return client.auth.signInWithPassword({ email: userToEmail(username), password: password })
          .then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      signOut: function () { return client.auth.signOut(); },
      getEmail: function () { return client.auth.getSession().then(function (r) { return r.data.session ? r.data.session.user.email : null; }); },
      isAdmin: function () { return client.rpc("is_admin").then(function (r) { return !!r.data; }); },
      puedePortal: function () { return client.rpc("puede_portal").then(function (r) { return !!r.data; }); },
      getMyClient: function () {
        return client.from("clients").select("*").limit(1).maybeSingle().then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },
      getSettings: function () {
        return client.from("settings").select("*").eq("id", 1).maybeSingle().then(function (r) { return r.data; });
      },
      // ---- admin: datos ----
      listClients: function () {
        return client.from("clients").select("*").order("capital", { ascending: false }).then(function (r) {
          if (r.error) throw r.error; return r.data || [];
        });
      },
      saveClient: function (obj) {
        var row = toRow(obj);
        var q = obj.id ? client.from("clients").update(row).eq("id", obj.id) : client.from("clients").insert(row);
        return q.then(function (r) { if (r.error) throw r.error; return true; });
      },
      deleteClient: function (id) {
        return client.from("clients").delete().eq("id", id).then(function (r) { if (r.error) throw r.error; return true; });
      },
      // ---- admin: movimientos de capital ----
      listMovimientos: function (clientId) {
        return client.from("client_movimientos").select("*").eq("client_id", clientId)
          .order("fecha", { ascending: false }).order("created_at", { ascending: false })
          .then(function (r) { if (r.error) throw r.error; return r.data || []; });
      },
      addMovimiento: function (mov) {
        var self = this;
        return client.from("client_movimientos").insert({
          client_id: mov.client_id, fecha: mov.fecha, tipo: mov.tipo, monto: mov.monto,
          destino: mov.destino || null, rendimiento: mov.rendimiento || "proximo", detalle: mov.detalle || null,
        }).then(function (r) {
          if (r.error) throw r.error;
          return client.from("clients").select("*").eq("id", mov.client_id).single();
        }).then(function (r) {
          if (r.error) throw r.error;
          var clientRow = r.data;
          return self.listMovimientos(mov.client_id).then(function (movs) {
            var patch = patchConMovimiento(clientRow, movs, mov);
            return client.from("clients").update(patch).eq("id", mov.client_id).select("*").single()
              .then(function (u) { if (u.error) throw u.error; return u.data; });
          });
        });
      },
      deleteMovimiento: function (id, clientId) {
        var self = this;
        return client.from("client_movimientos").delete().eq("id", id).then(function (r) {
          if (r.error) throw r.error;
          return client.from("clients").select("*").eq("id", clientId).single();
        }).then(function (r) {
          if (r.error) throw r.error;
          var clientRow = r.data;
          return self.listMovimientos(clientId).then(function (movs) {
            var patch = LIB.recomputarCliente(clientRow, movs);
            return client.from("clients").update(patch).eq("id", clientId).select("*").single()
              .then(function (u) { if (u.error) throw u.error; return u.data; });
          });
        });
      },
      saveSettings: function (s) {
        return client.from("settings").upsert(Object.assign({ id: 1 }, s)).then(function (r) { if (r.error) throw r.error; return true; });
      },
      listAdmins: function () {
        return client.from("admins").select("email").order("email").then(function (r) {
          if (r.error) throw r.error; return (r.data || []).map(function (a) { return emailToUser(a.email); });
        });
      },
      addAdmin: function (username) {
        return client.from("admins").insert({ email: userToEmail(username) }).then(function (r) { if (r.error) throw r.error; return true; });
      },
      removeAdmin: function (username) {
        return client.from("admins").delete().eq("email", userToEmail(username)).then(function (r) { if (r.error) throw r.error; return true; });
      },
      // ---- admin: credenciales (Edge Function) ----
      setCredential: function (username, password) { return call("upsert", { username: username, password: password }); },
      deleteCredential: function (username) { return call("delete", { username: username }); },
    };
  }

  // =========================================================================
  // BACKEND MOCK (en memoria + localStorage) — login simplificado para probar UI
  // =========================================================================
  function mockDB() {
    var LS = "scg_mock_v2";
    function seed() {
      var src = (global.SCG_DATA && global.SCG_DATA.clientes) || [];
      return src.map(function (c) {
        // Mapear esquema viejo del demo (mensual_2 / trimestral_7 / mixto) al modelo nuevo
        var oldId = c.esquema && c.esquema.id, esq = "mensual", tasa = null, tasaM = null, tasaT = null, pagoPer = null;
        if (oldId === "trimestral_7") { esq = "trimestral"; tasa = 0.07; pagoPer = c.pagoTrimestral || null; }
        else if (oldId === "mixto") { esq = "mixto"; tasaM = 0.02; tasaT = 0.07; }
        else { esq = "mensual"; tasa = 0.02; pagoPer = c.pagoMensual || null; }
        return {
          id: c.id, username: c.id, email: userToEmail(c.id), codigo: c.codigo, nombre: c.nombre,
          capital: c.capital || 0, esquema: esq, tasa: tasa, pago_periodo: pagoPer,
          tasa_mensual: tasaM, tasa_trimestral: tasaT,
          capital_mensual: c.capitalMensual || null, capital_trimestral: c.capitalTrimestral || null,
          pago_mensual: c.pagoMensual || null, pago_trimestral: c.pagoTrimestral || null,
          proximo_pago_fecha: c.proximoPago ? c.proximoPago.fecha : null,
          proximo_pago_monto: c.proximoPago ? c.proximoPago.monto : null,
          proximo_pago_detalle: c.proximoPago ? c.proximoPago.detalle : null,
          proximo_pago_trim_fecha: c.proximoPagoTrimestral ? c.proximoPagoTrimestral.fecha : null,
          proximo_pago_trim_monto: c.proximoPagoTrimestral ? c.proximoPagoTrimestral.monto : null,
          proximo_pago_trim_detalle: c.proximoPagoTrimestral ? c.proximoPagoTrimestral.detalle : null,
          ciclo_detalle: c.cicloDetalle || null, nota: c.nota || null,
          estado: c.estado || "activo", liquidacion: c.liquidacion || null,
        };
      });
    }
    function load() {
      try { var s = JSON.parse(localStorage.getItem(LS)); if (s && s.clients) return s; } catch (e) {}
      return { clients: seed(), movimientos: [], admins: ["admin"],
        settings: { id: 1, mes_reporte: "Mayo 2026", fecha_cierre: "2026-05-31",
          aum_liquido: 1688612.18, activos_fijos: 541986.94, inversionistas_activos: 15 } };
    }
    function save(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} }
    var state = load();
    var P = function (v) { return Promise.resolve(v); };

    var asUser = qp.get("as");
    var isAdminFlag = qp.get("admin") === "1";
    var sessionUser = isAdminFlag ? state.admins[0]
      : (asUser ? ((state.clients.find(function (c) { return c.codigo === asUser || c.username === asUser; }) || {}).username || null) : null);

    function uid() { return "id-" + Math.abs(Date.now() ^ (state.clients.length * 2654435761)).toString(16); }
    function isAdm(u) { return !!u && state.admins.map(function (x){return x.toLowerCase();}).indexOf(String(u).toLowerCase()) >= 0; }

    return {
      mock: true,
      signIn: function (username) { sessionUser = String(username || "").trim().toLowerCase(); save(state); return P({}); },
      signOut: function () { sessionUser = null; return P(true); },
      getEmail: function () { return P(sessionUser ? userToEmail(sessionUser) : null); },
      isAdmin: function () { return P(isAdm(sessionUser)); },
      puedePortal: function () { return P(isAdm(sessionUser)); },
      getMyClient: function () {
        if (isAdm(sessionUser)) return P(state.clients[0]);
        return P(state.clients.find(function (c) { return c.username === sessionUser; }) || null);
      },
      getSettings: function () { return P(state.settings); },
      listClients: function () { return P(state.clients.slice().sort(function (a,b){ return (b.capital||0)-(a.capital||0); })); },
      saveClient: function (obj) {
        var row = toRow(obj);
        if (obj.id) {
          var i = state.clients.findIndex(function (c) { return c.id === obj.id; });
          if (i >= 0) state.clients[i] = Object.assign({}, state.clients[i], row, { id: obj.id });
        } else { row.id = uid(); state.clients.push(row); }
        save(state); return P(true);
      },
      deleteClient: function (id) { state.clients = state.clients.filter(function (c){ return c.id !== id; }); save(state); return P(true); },
      // ---- movimientos de capital (mock) ----
      listMovimientos: function (clientId) {
        if (!state.movimientos) state.movimientos = [];
        var out = state.movimientos.filter(function (m) { return m.client_id === clientId; }).slice();
        out.sort(function (a, b) {
          if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
          return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
        });
        return P(out);
      },
      addMovimiento: function (mov) {
        if (!state.movimientos) state.movimientos = [];
        var row = {
          id: "mov-" + Math.abs(Date.now() ^ (state.movimientos.length * 2654435761)).toString(16),
          client_id: mov.client_id, fecha: mov.fecha, tipo: mov.tipo, monto: Number(mov.monto) || 0,
          destino: mov.destino || null, rendimiento: mov.rendimiento || "proximo",
          detalle: mov.detalle || null, created_at: new Date().toISOString(),
        };
        state.movimientos.push(row);
        var i = state.clients.findIndex(function (c) { return c.id === mov.client_id; });
        var clientRow = state.clients[i];
        var movs = state.movimientos.filter(function (m) { return m.client_id === mov.client_id; });
        var patch = patchConMovimiento(clientRow, movs, mov);
        state.clients[i] = Object.assign({}, clientRow, patch);
        save(state); return P(state.clients[i]);
      },
      deleteMovimiento: function (id, clientId) {
        if (!state.movimientos) state.movimientos = [];
        state.movimientos = state.movimientos.filter(function (m) { return m.id !== id; });
        var i = state.clients.findIndex(function (c) { return c.id === clientId; });
        var clientRow = state.clients[i];
        var movs = state.movimientos.filter(function (m) { return m.client_id === clientId; });
        var patch = LIB.recomputarCliente(clientRow, movs);
        state.clients[i] = Object.assign({}, clientRow, patch);
        save(state); return P(state.clients[i]);
      },
      saveSettings: function (s) { state.settings = Object.assign({ id: 1 }, state.settings, s); save(state); return P(true); },
      listAdmins: function () { return P(state.admins.slice()); },
      addAdmin: function (username) { var u = String(username).trim().toLowerCase(); if (state.admins.indexOf(u) < 0) state.admins.push(u); save(state); return P(true); },
      removeAdmin: function (username) {
        if (state.admins.length <= 1) return Promise.reject(new Error("No se puede eliminar el último administrador."));
        state.admins = state.admins.filter(function (u){ return u.toLowerCase() !== String(username).toLowerCase(); }); save(state); return P(true);
      },
      setCredential: function () { return P({ ok: true }); },
      deleteCredential: function () { return P({ ok: true }); },
      _reset: function () { localStorage.removeItem(LS); state = load(); },
    };
  }

  global.SCG_DB = MOCK ? mockDB() : realDB();
  global.SCG_DB.MOCK = MOCK;
  global.SCG_DB.LOGIN_DOMAIN = LOGIN_DOMAIN;
})(typeof window !== "undefined" ? window : this);
