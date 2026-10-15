// Usuarios simulados de la tienda, siempre encendidos (P10).
//
// Este k6 NO decide nada: no tiene umbrales y nadie lee su resultado. Solo hace
// lo que harian los clientes, para que haya trafico real que medir. Quien juzga
// una version nueva es Prometheus (analisis/gateway-metricas.yaml), con las
// metricas que el gateway reporta sobre este trafico.
//
// Entra por ingress-nginx con el Host publico, igual que un navegador: asi el
// reparto entre version estable y candidata lo hace el mismo Ingress canary
// que reparte a los usuarios de verdad.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE;
const HOST = __ENV.HOST;
const CORREO = __ENV.CORREO;
const CLAVE = __ENV.CLAVE;

const JSON_HOST = { headers: { 'Content-Type': 'application/json', Host: HOST } };
// 24 h y Kubernetes lo reinicia. DURACION corta sirve para probar el script.
const DURACION = __ENV.DURACION || '24h';
const CATALOGO = JSON.stringify({ query: '{ productos { id nombre precio stockDisponible } }' });

export const options = {
  scenarios: {
    // La mayoria solo mira el catalogo: 3 por segundo.
    catalogo: {
      executor: 'constant-arrival-rate',
      exec: 'mirarCatalogo',
      rate: 3,
      timeUnit: '1s',
      duration: DURACION,
      preAllocatedVUs: 6,
      maxVUs: 20,
    },
    // Unos pocos compran: 6 por minuto. Crean la orden y la cancelan, asi la
    // compensacion devuelve el stock y el inventario no se agota.
    compras: {
      executor: 'constant-arrival-rate',
      exec: 'comprarYCancelar',
      rate: 6,
      timeUnit: '1m',
      duration: DURACION,
      preAllocatedVUs: 2,
      maxVUs: 6,
    },
  },
  // Sin umbrales: aunque todo falle, este Pod sigue generando trafico.
  summaryTrendStats: ['avg', 'p(95)'],
  // k6 borra las cookies al empezar cada iteracion. Un cliente real conserva
  // su sesion: sin esto, cada compra despues de la primera llegaba sin cookie
  // y el gateway respondia 401.
  noCookiesReset: true,
};

// El usuario de las compras se registra una sola vez. Si ya existe, el
// registro falla y da igual.
export function setup() {
  http.post(`${BASE}/auth/register`,
    JSON.stringify({ nombre: 'Trafico P10', correo: CORREO, password: CLAVE }), JSON_HOST);
}

export function mirarCatalogo() {
  const r = http.post(`${BASE}/graphql/productos`, CATALOGO, JSON_HOST);
  check(r, { 'catalogo 200': (x) => x.status === 200 });
}

// Cada usuario virtual guarda su cookie de sesion entre compras.
let conSesion = false;

function iniciarSesion() {
  const r = http.post(`${BASE}/auth/login`, JSON.stringify({ correo: CORREO, password: CLAVE }), JSON_HOST);
  conSesion = r.status === 200;
}

export function comprarYCancelar() {
  if (!conSesion) iniciarSesion();
  if (!conSesion) return;

  // El producto con mas stock, para no agotar ninguno.
  const catalogo = http.post(`${BASE}/graphql/productos`, CATALOGO, JSON_HOST);
  const productos = (catalogo.status === 200 && catalogo.json('data.productos')) || [];
  const producto = productos.filter((p) => p.stockDisponible > 1)
    .sort((a, b) => b.stockDisponible - a.stockDisponible)[0];
  if (!producto) return;

  const crear = http.post(`${BASE}/graphql/ordenes`, JSON.stringify({
    query: 'mutation($i: CrearOrdenInput!) { crearOrden(input: $i) { id estado } }',
    variables: { i: { claveIdempotencia: uuidv4(), lineas: [{ productoId: producto.id, cantidad: 1 }] } },
  }), JSON_HOST);
  if (crear.status === 401) { conSesion = false; return; }
  check(crear, { 'orden creada': (x) => x.status === 200 && !x.json('errors') });

  const orden = crear.status === 200 && crear.json('data.crearOrden');
  if (!orden || orden.estado !== 'PENDIENTE') return;

  const cancelar = http.post(`${BASE}/graphql/ordenes`, JSON.stringify({
    query: 'mutation($o: ID!) { cancelarOrden(ordenId: $o) { id estado } }',
    variables: { o: orden.id },
  }), JSON_HOST);
  check(cancelar, { 'orden cancelada': (x) => x.status === 200 && !x.json('errors') });
}

// La API exige que la clave de idempotencia sea un UUID v4.
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
