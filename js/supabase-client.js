/**
 * Configuración del Cliente Supabase
 * Conexión en la nube para el SaaS de Control de Piso Textil
 */

const SUPABASE_URL = "https://uyeqzxdhovjxbpobtqcr.supabase.co";
const SUPABASE_KEY = "sb_publishable_EpYxk8t-8g3-isWCGmjQfg_K6Ov6oTr";

// El script UMD expone window.supabase como el objeto de la librería { createClient }
// Inicializamos el cliente y reasignamos window.supabase a la instancia activa
var supabaseClient = null;

try {
  if (window.supabase && typeof window.supabase.createClient === "function") {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window.supabase = supabaseClient;
  } else if (typeof createClient === "function") {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    window.supabase = supabaseClient;
  } else {
    console.error("No se encontró la librería Supabase en window.");
  }
} catch (err) {
  console.error("Error al inicializar cliente Supabase:", err);
}
