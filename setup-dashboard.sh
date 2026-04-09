#!/bin/bash
# setup-dashboard.sh - Ayuda a configurar el dashboard con tu Supabase key

echo "🔑 Configuración del Dashboard de Gastos"
echo "========================================"
echo ""
echo "Para obtener tu Supabase Anon Key:"
echo "1. Ve a: https://app.supabase.com"
echo "2. Selecciona tu proyecto: nejbepyizibuqulyzqrw"
echo "3. Settings (⚙️) > API > Project API keys"
echo "4. Copia el valor de 'anon public'"
echo ""
read -p "Pega aquí tu Supabase Anon Key: " SUPABASE_KEY

if [ -z "$SUPABASE_KEY" ]; then
    echo "❌ No ingresaste ninguna clave. Cancelando."
    exit 1
fi

# Reemplazar en el archivo dashboard.html
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/TU_SUPABASE_ANON_KEY_AQUI/$SUPABASE_KEY/g" public/dashboard.html
else
    # Linux
    sed -i "s/TU_SUPABASE_ANON_KEY_AQUI/$SUPABASE_KEY/g" public/dashboard.html
fi

echo ""
echo "✅ ¡Dashboard configurado!"
echo ""
echo "Para probarlo localmente:"
echo "  npm start"
echo "  Luego abre: http://localhost:3000/dashboard.html"
echo ""
echo "Para desplegar:"
echo "  git add public/dashboard.html"
echo "  git commit -m 'config: update dashboard supabase key'"
echo "  git push"
