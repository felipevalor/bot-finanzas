# 📊 Dashboard de Gastos

Panel de métricas en tiempo real para el Bot de Finanzas Personales.

## 🚀 Acceso

Una vez desplegado, accede al dashboard en:

```
https://bot-finanzas-7p3d.onrender.com/dashboard.html
```

## ⚙️ Configuración

### 1. Obtener tu Supabase Anon Key

1. Ve a [https://app.supabase.com](https://app.supabase.com)
2. Selecciona tu proyecto (`nejbepyizibuqulyzqrw`)
3. Click en **Settings** (engranaje, abajo izquierda)
4. Click en **API** en el menú lateral
5. Copia la clave bajo **Project API keys** → `anon public`

### 2. Actualizar el Dashboard

Edita `public/dashboard.html` y reemplaza esta línea (~línea 245):

```javascript
const SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY_AQUI';
```

Por tu clave real:

```javascript
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // tu clave aquí
```

### 3. Desplegar

```bash
git add public/dashboard.html
git commit -m "feat: add real-time expense dashboard"
git push
```

Render deployará automáticamente.

## 📈 Métricas Mostradas

| Métrica | Descripción |
|---|---|
| **Total Gastado** | Suma total del período seleccionado |
| **Cantidad de Gastos** | Número de registros |
| **Promedio por Gasto** | Promedio por transacción |
| **Categoría Principal** | Categoría con mayor gasto + % del total |
| **Gráfico de Barras** | Gastos por categoría |
| **Gráfico de Dona** | Distribución porcentual |
| **Evolución Diaria** | Gasto diario + acumulado en el tiempo |
| **Tabla de Gastos** | Últimos 20 gastos con fecha, descripción, categoría y monto |

## 🔍 Filtros

- **Mes**: Mes actual, mes anterior, o todo el historial
- **Usuario**: Filtrar por `telegram_user_id` específico (dejar vacío para ver todos)

## 🔄 Auto-Refresh

El dashboard se actualiza automáticamente cada **5 minutos**. También puedes hacer click en "🔄 Actualizar" para refrescar manualmente.

## 🛡️ Seguridad

### ¿Es seguro exponer la anon key?

**Sí**, la `anon` key de Supabase está diseñada para ser pública (va en el cliente). Sin embargo:

1. **Row Level Security (RLS)** debe estar habilitado para proteger los datos
2. Actualmente tu tabla tiene `service_role_full_access` policy, lo que significa que **cualquiera con la anon key puede leer todos los gastos**

### Para producción multi-usuario:

Si planeas compartir este dashboard públicamente, deberías:

1. **Agregar autenticación** (Supabase Auth o basic auth)
2. **Crear policies de RLS** que restrinjan la lectura por usuario
3. **O usar una API intermedia** en tu servidor Express

### Opción rápida: Basic Auth

Si quieres proteger el dashboard con contraseña, agrega esto a `index.js`:

```javascript
import basicAuth from 'express-basic-auth';

app.use('/dashboard.html', basicAuth({
  users: { 'admin': 'tu-password-secreto' },
  challenge: true
}));
```

## 🎨 Tecnologías

- **Frontend**: HTML + CSS vanilla (dark theme)
- **Gráficos**: Chart.js 4.4 (CDN)
- **Datos**: Supabase REST API (fetch nativo, sin SDK)
- **Hosting**: Servido por Express como archivo estático

## 📝 Notas

- El dashboard consulta **directamente a Supabase**, no pasa por el bot
- Los datos son **tiempo real** — cada refresh trae datos frescos
- Si no tienes gastos aún, el dashboard mostrará "$0" y gráficos vacíos
- Todos los montos están en formato argentino (es-AR)

## 🐛 Troubleshooting

| Problema | Solución |
|---|---|
| "No se pudo conectar con Supabase" | Verifica que la `SUPABASE_ANON_KEY` sea correcta |
| Datos vacíos | Asegúrate de que el bot haya registrado gastos |
| Gráficos no aparecen | Revisa la consola del navegador por errores |
| Dashboard no carga | Verifica que Express esté sirviendo `/public/` correctamente |
