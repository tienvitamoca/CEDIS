const SUPABASE_URL = 'https://egqazijcxfmclcjmcdvm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_nRZMUsZ-KezGYjYLmuQ7tA_EbyPUjaH';

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

// ─── CRUD Base ─────────────────────────────────────────────────
async function dbGet(tabla, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${params}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbPost(tabla, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// async function dbPatch(tabla, id, data) {
//   const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?id=eq.${id}`, {
//     method: 'PATCH',
//     headers: { ...headers, 'Prefer': 'return=representation' },
//     body: JSON.stringify(data)
//   });
//   if (!res.ok) throw new Error(await res.text());
//   return res.json();
// }

// Ejemplo de cómo debe ser en supabase.js
async function dbPatch(tabla, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}


async function getTipos() {
  return dbGet('tipos_producto', 'order=id.asc');
}

async function getPresentaciones() {
  return dbGet('presentaciones', 'order=codigo_bb.asc');
}

// ─── Lógica de Negocio Sincronizada con Excel ──────────────────

// --- Lógica de Negocio de Alta Precisión ---

function costoPorGramo(producto) {
  if (!producto.costo_kg) return null;
  // Cálculo Profesional: Recupera el costo del desperdicio (merma)
  // Si el producto cuesta $100 y tiene 2% de merma, el costo real es 100 / 0.98
  const merma = parseFloat(producto.merma_pct) || 0;
  return (producto.costo_kg / 1000) / (1 - merma);
}

// Target Costing (Precio -> Gramos)
function calcularTargetCosting(producto, precio_tienda, margen_cliente, margen_tuyo) {
  const insumos = (parseFloat(producto.costo_bolsa) || 0) + (parseFloat(producto.costo_produccion) || 0);
  const cpg = costoPorGramo(producto);
  if (!cpg || !precio_tienda) return null;

  // 1. Precio de Venta (Igual que en Tradicional)
  const precio_venta = precio_tienda / (1 + margen_cliente);

  // 2. Costo Total Permitido (Cambiado de * a / para coincidir con Tradicional)
  const costo_total_permitido = precio_venta / (1 + margen_tuyo);

  // 3. Costo MP disponible
  const costo_mp = costo_total_permitido - insumos;
  const gramos = costo_mp > 0 ? costo_mp / cpg : null;

  return {
    precio_venta: redondear(precio_venta),
    insumos: redondear(insumos),
    costo_mp: redondear(costo_mp),
    gramos: gramos ? redondear(gramos, 1) : null,
    utilidad: redondear(precio_venta - (costo_mp + insumos))
  };
}

// Modo Tradicional (Gramos -> Precio)
function calcularModoTradicional(producto, gramos, margen_tuyo, margen_cliente) {
  const insumos = (parseFloat(producto.costo_bolsa) || 0) + (parseFloat(producto.costo_produccion) || 0);
  const cpg = costoPorGramo(producto);
  if (!cpg || !gramos) return null;

  const costo_mp = cpg * gramos;
  const costo_total = costo_mp + insumos;
  const precio_venta = costo_total * (1 + margen_tuyo);
  const precio_tienda = precio_venta * (1 + margen_cliente);

  return {
    costo_mp: redondear(costo_mp),
    insumos: redondear(insumos),
    costo_total: redondear(costo_total),
    precio_venta: redondear(precio_venta),
    precio_tienda: redondear(precio_tienda),
    utilidad: redondear(precio_venta - costo_total)
  };
}

function redondear(val, decimales = 2) {
  return Math.round(val * Math.pow(10, decimales)) / Math.pow(10, decimales);
}

function obtenerEstadoRentabilidad(utilidad, precioVenta) {
  if (!precioVenta || precioVenta <= 0) return { clase: '', porcentaje: 0 };

  const porcentajeGanancia = (utilidad / precioVenta) * 100;

  // Si la ganancia es menor al 10%, es alerta roja
  if (porcentajeGanancia < 10) {
    return { clase: 'rentabilidad-baja', porcentaje: redondear(porcentajeGanancia, 1), alerta: true };
  }
  return { clase: 'rentabilidad-ok', porcentaje: redondear(porcentajeGanancia, 1), alerta: false };
}

function formatPeso(val) {
  return val != null ? `$${val.toFixed(2)}` : '—';
}

function generarCodigoBarras(producto, codigo_bb) {
  const tipo_str = String(producto.tipo_id);
  const prefix = tipo_str.slice(0, 2);
  const tipo_dig = tipo_str.slice(2);
  const codigo_str = String(producto.codigo);
  const ccc = codigo_str.slice(3).padStart(3, '0');

  // Código numérico limpio: ej. 26201092
  const codigoNumerico = `${prefix}${tipo_dig}${ccc}${codigo_bb}`;

  return {
    num: codigoNumerico,
    textoParaFuente: codigoNumerico // Ya no agregamos í ni î
  };
}

function bbPorGramos(presentaciones, gramos) {
  return presentaciones.find(p => p.gramos === gramos) || null;
}

function bbPorPrecio(presentaciones, precio) {
  return presentaciones.find(p => p.precio_ref === precio) || null;
}