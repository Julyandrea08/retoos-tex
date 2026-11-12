# RetoOS Tex — Sistema Operativo de Confección

**RetoOS Tex** es la plataforma industrial SaaS de control de piso, eficiencia en tiempo real, costeo minuto a minuto y gestión de calidad para manufactura y confección textil, desarrollada por **RETOOS**.

Migrado exitosamente de Google Apps Script a una arquitectura web moderna en la nube con **Supabase (PostgreSQL)**.

## Módulos Principales
1. **Módulo de Registro (Piso / Tablet):**
   - **Avance de Costura:** Registro ágil por puesto de trabajo con cálculo dinámico de SAM.
   - **Salida de Prendas & Auditoría de Calidad:** Registro de prendas conformes (Primeras) y control de defectos (Segundas/Reproceso) con motivos clasificados.
2. **Tablero en Vivo (Centro de Control):**
   - Gráfica de **Barras Apiladas por Hora** con código de color independiente para cada Orden de Producción activa.
   - Tabla de eficiencia diaria de operarias con total de unidades y porcentaje de rendimiento.
   - Resumen totalizador de unidades y minutos producidos.
   - Exportación de reportes a Excel (CSV).
3. **Módulo Administrador & Ingeniería (Maestros):**
   - **Órdenes de Producción:** Con **Calculadora de Capacidad y Tiempos de Entrega** en días hábiles.
   - **Operarias:** Alta, baja y carga masiva desde Excel.
   - **Prendas & Fichas SAM:** Creación manual, auto-código de operaciones, edición de SAM in-situ, exportación completa e importación masiva desde Excel (.xlsx / .csv).
   - **Configurador de Turnos y Costeo Minuto Planta.**
