# Control de Piso Textil — SaaS Cloud Edition

Sistema de Control de Piso y Eficiencia en Tiempo Real para Confección Textil.
Migrado de Google Apps Script a Arquitectura Cloud SaaS con **Supabase (PostgreSQL)** y despliegue rápido.

## Estructura del Proyecto
- `index.html`: Aplicación web moderna (Single Page Application) optimizada para tablets de planta y móviles.
- `css/styles.css`: Estilos visuales industriales con tipografía Outfit y diseño responsivo.
- `js/supabase-client.js`: Conexión segura con la base de datos en la nube.
- `js/app.js`: Lógica de negocio, turnos dinámicos, cálculo de eficiencia SAM, tablero y maestros.
- `gas_backup/`: Respaldo histórico de los archivos originales de Google Apps Script.

## Características Implementadas
1. **Configurador de Turnos Dinámico**: Detección automática de la hora del turno y adaptación a los horarios específicos de cada planta.
2. **Módulo de Órdenes de Producción (OP)**: Creación y activación de órdenes desde la app sin tocar hojas de cálculo.
3. **Módulo Máster de Operarias**: Alta, baja y asignación de personal a módulos/líneas.
4. **Fichas Técnicas & Operaciones por Prenda**: La app muestra únicamente las operaciones de la prenda asignada a la OP seleccionada.
5. **Prendas Finalizadas**: Contador en tiempo real del progreso de la OP cuando se registra la operación de salida.
6. **Separación de Roles (Piso vs. Admin)**: Modo Piso para operarias/supervisores y Modo Administrador protegido con PIN.
7. **Tablero Multifecha por Orden**: Consulta del progreso acumulado total de una OP o filtro por fecha del día.
8. **Eficiencia con Totales**: Columnas fijas con Total de Unidades Producidas y % de Eficiencia del Día por operaria.
9. **Detalle con Totalizador**: Resumen de unidades y SAM ganado por operaria con exportación a Excel / CSV.
