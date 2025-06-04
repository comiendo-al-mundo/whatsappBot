#!/bin/bash
set -e

# --------------------------------------------------------
# 0) VARIABLES DE CONFIGURACIÓN
# --------------------------------------------------------
SECRETS_DIR="/etc/secrets"
CLOUD_JSON="cloudStorageKeys.json"
REPO_URL="https://github.com/comiendo-al-mundo/whatsappBot.git"
TARGET_DIR="/opt/whatsapp-bot"

# --------------------------------------------------------
# 1) CREAR CARPETA DE SECRETS Y FIJAR PERMISOS
# --------------------------------------------------------
echo "🔐 Creando carpeta de secretos en $SECRETS_DIR..."
if [ ! -d "$SECRETS_DIR" ]; then
  mkdir -p "$SECRETS_DIR"
fi
chmod 700 "$SECRETS_DIR"

# Aquí asumimos que tú ya subiste manualmente el archivo cloudStorageKeys.json
# por ejemplo con: scp cloudStorageKeys.json root@<IP>:/etc/secrets/cloudStorageKeys.json

# Verificamos que efectivamente exista:
if [ ! -f "$SECRETS_DIR/$CLOUD_JSON" ]; then
  echo "❌ ERROR: no se encontró $SECRETS_DIR/$CLOUD_JSON."
  echo "   Sube antes el fichero con: scp cloudStorageKeys.json root@<IP>:/etc/secrets/"
  exit 1
fi
# Dejamos permisos seguros para que sólo root (o el usuario que ejecute) pueda leerlo
chmod 600 "$SECRETS_DIR/$CLOUD_JSON"

# --------------------------------------------------------
# 2) ACTUALIZAR SISTEMA E INSTALAR DEPENDENCIAS BÁSICAS
# --------------------------------------------------------
echo "🔄 Actualizando apt y subiendo paquetes base..."
sudo apt-get update -y
sudo apt-get upgrade -y

# Necesitamos git para clonar, curl para NodeSource, y build-essential (si hiciera falta compilar algo).
echo "📦 Instalando git, curl y build-essential..."
sudo apt-get install -y git curl build-essential

# --------------------------------------------------------
# 3) INSTALAR NODE.JS (v20.x) DESDE NodeSource
# --------------------------------------------------------
echo "🔧 Añadiendo repositorio de NodeSource (Node.js 20.x)..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

echo "📦 Instalando Node.js y npm..."
sudo apt-get install -y nodejs

# Verificar versions
echo "📝 Versión de Node.js instalada: $(node -v)"
echo "📝 Versión de npm instalada: $(npm -v)"

# --------------------------------------------------------
# 4) INSTALAR snapd, CHROMIUM (vía Snap) Y DEPENDENCIAS DE PUPPETEER
# --------------------------------------------------------
echo "📥 1/3 Instalando snapd..."
sudo apt-get update -y
sudo apt-get install -y snapd

echo "📥 2/3 Instalando Chromium vía Snap..."
# Al instalar Chromium como Snap, el binario queda en /snap/bin/chromium
sudo snap install chromium

echo "🔗 3/3 Creando enlace simbólico /usr/bin/chromium -> /snap/bin/chromium..."
if [ ! -f "/usr/bin/chromium" ]; then
  sudo ln -s /snap/bin/chromium /usr/bin/chromium
fi

echo "📦 Instalando librerías necesarias para Puppeteer..."
sudo apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libappindicator3-1 \
    xdg-utils \
    ca-certificates \
    fonts-liberation

echo "✅ Chromium (vía Snap) y librerías para Puppeteer instaladas."

# --------------------------------------------------------
# 5) INSTALAR pm2
# --------------------------------------------------------
echo "📦 Instalando pm2 globalmente..."
sudo npm install -g pm2

echo "📝 Versión de pm2: $(pm2 -v)"

# --------------------------------------------------------
# 6) CLONAR TU REPOSITORIO DE GITHUB
# --------------------------------------------------------
echo "🔗 Clonando repositorio público en $TARGET_DIR..."
sudo rm -rf "$TARGET_DIR"
sudo mkdir -p "$TARGET_DIR"
sudo chown "$USER:$USER" "$TARGET_DIR"
git clone "$REPO_URL" "$TARGET_DIR"

sudo chown -R "$USER:$USER" "$TARGET_DIR"
# --------------------------------------------------------
# 7) CREAR FICHERO .env CON LA RUTA DE LAS CREDENCIALES
# --------------------------------------------------------
echo "📄 Escribiendo .env en el proyecto con la ruta de las credenciales..."
cat > "$TARGET_DIR/.env" << EOF
SERVICE_ACCOUNT_FILE=$SECRETS_DIR/$CLOUD_JSON
EOF

# Asegúrate de permisos mínimos
chmod 600 "$TARGET_DIR/.env"
chown "$USER:$USER" "$TARGET_DIR/.env"

# --------------------------------------------------------
# 8) INSTALAR DEPENDENCIAS DE LA APLICACIÓN
# --------------------------------------------------------
cd "$TARGET_DIR"

echo "📦 Instalando dependencias npm en modo producción..."
npm install --production

sudo chown -R "$USER:$USER" "$TARGET_DIR"

# --------------------------------------------------------
# 9) CONFIGURAR LA CARPETA session-data
# --------------------------------------------------------
# El código usa "./session-data" por defecto. Asegurarse de que existe y permisos.
echo "📁 Creando carpeta session-data con permisos correctos..."
mkdir -p "${TARGET_DIR}/session-data"
sudo chown -R "$USER:$USER" "${TARGET_DIR}/session-data"
chmod 700 "${TARGET_DIR}/session-data"

# --------------------------------------------------------
# 10) CREAR O MODIFICAR start-bot.sh PARA QUE LEA .env
# --------------------------------------------------------
echo "🚀 Generando start-bot.sh que cargará .env antes de arrancar..."
cat > "$TARGET_DIR/start-bot.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
# Carga variables de entorno (dotenv) antes de arrancar
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi
node app.js
EOF
chmod +x "$TARGET_DIR/start-bot.sh"
chown "$USER:$USER" "$TARGET_DIR/start-bot.sh"

# --------------------------------------------------------
# 11) LEVANTAR EL BOT CON pm2 Y CONFIGURAR ARRANQUE AL INICIO
# --------------------------------------------------------
cd "$TARGET_DIR"

# 11.1) Iniciar el bot por primera vez
echo "🚀 Iniciando el bot con pm2..."
pm2 start start-bot.sh --name whatsapp-bot --cwd "$TARGET_DIR"

# 11.2) Guardar configuración de pm2 para que se reinicie tras reboot
echo "💾 Guardando configuración de pm2..."
pm2 save

# 11.3) Generar el script de inicio para systemd
echo "🔧 Configurando pm2 para iniciarse en cada reinicio..."
pm2 startup systemd -u "$USER" --hp "$HOME"

# --------------------------------------------------------
# 12) FIN DEL SCRIPT
# --------------------------------------------------------
echo "✅ Setup completado. El bot está corriendo bajo pm2 con nombre 'whatsapp-bot'."
echo "   - Puedes ver logs con: pm2 logs whatsapp-bot"
echo "   - Para detenerlo:     pm2 stop whatsapp-bot"
echo "   - Para reiniciarlo:   pm2 restart whatsapp-bot"