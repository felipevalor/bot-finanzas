# 🚀 Guía Rápida: Dashboard de Gastos

## En 3 pasos simples

### Paso 1: Obtener tu clave de Supabase

1. Abre [Supabase Dashboard](https://app.supabase.com)
2. Click en tu proyecto `nejbepyizibuqulyzqrw`
3. En la barra lateral izquierda, click en **Settings** (⚙️, abajo)
4. Click en **API**
5. Busca la sección **Project API keys**
6. Copia el valor de **`anon public`** (empieza con `eyJ...`)

### Paso 2: Configurar el dashboard

**Opción A - Automática (recomendada):**

```bash
./setup-dashboard.sh
```

Te pedirá la clave y la configurará automáticamente.

**Opción B - Manual:**

1. Abre `public/dashboard.html` en tu editor
2. Busca la línea (~245):
   ```javascript
   const SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY_AQUI';
   ```
3. Reemplaza por tu clave real:
   ```javascript
   const SUPABASE_ANON_KEY = 'eyJhbGc...tu-clave-aqui...';
   ```
4. Guarda el archivo

### Paso 3: Probar y desplegar

**Localmente:**

```bash
npm start
```

Luego abre en tu navegador:
```
http://localhost:3000/dashboard.html
```

**Desplegar a Render:**

```bash
git add public/dashboard.html index.js
git commit -m "feat: add expense dashboard"
git push
```

En ~2 minutos, tu dashboard estará disponible en:
```
https://bot-finanzas-7p3d.onrender.com/dashboard.html
```

---

## 📊 ¿Qué verás?

### Métricas principales (arriba)
- **Total Gastado**: Suma total del período
- **Cantidad de Gastos**: Número de registros
- **Promedio por Gasto**: Valor promedio
- **Categoría Principal**: Donde más gastás

### Gráficos (medio)
- **Barras**: Gasto total por categoría
- **Dona**: Distribución porcentual
- **Línea temporal**: Evolución diaria + acumulado

### Tabla (abajo)
- Últimos 20 gastos con fecha, descripción, categoría y monto

### Filtros (arriba)
- **Mes**: Actual / Anterior / Todo el historial
- **Usuario**: Filtrar por ID de Telegram (opcional)

---

## 🎯 Tips

- **Auto-refresh**: El dashboard se actualiza solo cada 5 minutos
- **Manual refresh**: Click en "🔄 Actualizar"
- **Filtro por usuario**: Si sos el único usuario, dejalo vacío
- **Formato**: Los montos están en pesos argentinos ($)

---

## 🔒 Seguridad

La clave `anon` de Supabase es **pública por diseño** (va en el navegador). 

**Para uso personal**: ✅ Seguro
**Para compartir**: Considera agregar autenticación

Si querés proteger con contraseña, avisame y te ayudo a agregar basic auth.

---

## ❓ Problemas comunes

| Problema | Solución |
|----------|----------|
| Dashboard muestra "$0" | ¡Normal si no tenés gastos aún! Envia un gasto al bot primero |
| "Error de conexión" | Verifica que la clave esté bien copiada (sin espacios extra) |
| Gráficos no cargan | Abrí la consola del navegador (F12) y revisá errores |
| Página en blanco | Revisá que el archivo se haya deployado bien |

---

**¿Necesitás ayuda?** Revisá `public/README.md` para documentación completa.
