/**
 * Configuración del Cliente Supabase
 * Conexión en la nube para el SaaS de Control de Piso Textil
 */

const SUPABASE_URL = "https://uyeqzxdhovjxbpobtqcr.supabase.co";
const SUPABASE_KEY = "sb_publishable_EpYxk8t-8g3-isWCGmjQfg_K6Ov6oTr";

// Inicializar cliente oficial de Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
