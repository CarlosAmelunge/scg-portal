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
        return {
          id: c.id, username: c.id, email: userToEmail(c.id), codigo: c.codigo, nombre: c.nombre,
          capital: c.capital || 0, esquema: c.esquema.id,
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
      return { clients: seed(), admins: ["admin"],
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
