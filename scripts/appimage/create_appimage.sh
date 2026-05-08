#!/bin/bash

# Exit on error
set -e

# Check platform
platform=$(uname)

if [[ "$platform" == "Darwin" ]]; then
    echo "Running on macOS. Note that the AppImage created will only work on Linux systems."
    if ! command -v docker &> /dev/null; then
        echo "Docker Desktop for Mac is not installed. Please install it from https://www.docker.com/products/docker-desktop"
        exit 1
    fi
elif [[ "$platform" == "Linux" ]]; then
    echo "Running on Linux. Proceeding with AppImage creation..."
else
    echo "This script is intended to run on macOS or Linux. Current platform: $platform"
    exit 1
fi

# Enable BuildKit
export DOCKER_BUILDKIT=1

BUILD_IMAGE_NAME="neptor-appimage-builder"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# Check and install Buildx if needed
if ! docker buildx version >/dev/null 2>&1; then
    echo "Installing Docker Buildx..."
    mkdir -p ~/.docker/cli-plugins/
    curl -SL https://github.com/docker/buildx/releases/download/v0.13.1/buildx-v0.13.1.linux-amd64 -o ~/.docker/cli-plugins/docker-buildx
    chmod +x ~/.docker/cli-plugins/docker-buildx
fi

# Download appimagetool if not present
if [ ! -f "appimagetool" ]; then
    echo "Downloading appimagetool..."
    wget -O appimagetool "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool
fi

# Delete any existing AppImage to avoid bloating the build
rm -f Neptor-x86_64.AppImage

# Create build Dockerfile
echo "Creating build Dockerfile..."
cat > Dockerfile.build << 'EOF'
# syntax=docker/dockerfile:1
FROM ubuntu:20.04

# Install required dependencies
RUN apt-get update && apt-get install -y \
    libfuse2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libnss3 \
    libasound2 \
    libdrm2 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EOF

# Create .dockerignore file
echo "Creating .dockerignore file..."
cat > .dockerignore << EOF
Dockerfile.build
.dockerignore
.git
.gitignore
.DS_Store
*~
*.swp
*.swo
*.tmp
*.bak
*.log
*.err
node_modules/
venv/
*.egg-info/
*.tox/
dist/
EOF

# Build Docker image without cache
echo "Building Docker image (no cache)..."
docker build --no-cache -t "$BUILD_IMAGE_NAME" -f Dockerfile.build .

# Create AppImage using local appimagetool
echo "Creating AppImage..."
docker run --rm --privileged -v "$(pwd):/app" "$BUILD_IMAGE_NAME" bash -c '
cd /app && \
rm -rf NeptorApp.AppDir && \
mkdir -p NeptorApp.AppDir/usr/bin NeptorApp.AppDir/usr/lib NeptorApp.AppDir/usr/share/applications && \
find . -maxdepth 1 ! -name NeptorApp.AppDir ! -name "." ! -name ".." -exec cp -r {} NeptorApp.AppDir/usr/bin/ \; && \
cp neptor.png NeptorApp.AppDir/ && \
echo "[Desktop Entry]" > NeptorApp.AppDir/neptor.desktop && \
echo "Name=Neptor" >> NeptorApp.AppDir/neptor.desktop && \
echo "Comment=Open source AI code editor." >> NeptorApp.AppDir/neptor.desktop && \
echo "GenericName=Text Editor" >> NeptorApp.AppDir/neptor.desktop && \
echo "Exec=neptor %F" >> NeptorApp.AppDir/neptor.desktop && \
echo "Icon=neptor" >> NeptorApp.AppDir/neptor.desktop && \
echo "Type=Application" >> NeptorApp.AppDir/neptor.desktop && \
echo "StartupNotify=false" >> NeptorApp.AppDir/neptor.desktop && \
echo "StartupWMClass=Neptor" >> NeptorApp.AppDir/neptor.desktop && \
echo "Categories=TextEditor;Development;IDE;" >> NeptorApp.AppDir/neptor.desktop && \
echo "MimeType=application/x-neptor-workspace;" >> NeptorApp.AppDir/neptor.desktop && \
echo "Keywords=neptor;" >> NeptorApp.AppDir/neptor.desktop && \
echo "Actions=new-empty-window;" >> NeptorApp.AppDir/neptor.desktop && \
echo "[Desktop Action new-empty-window]" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name=New Empty Window" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[de]=Neues leeres Fenster" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[es]=Nueva ventana vacía" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[fr]=Nouvelle fenêtre vide" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[it]=Nuova finestra vuota" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[ja]=新しい空のウィンドウ" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[ko]=새 빈 창" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[ru]=Новое пустое окно" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[zh_CN]=新建空窗口" >> NeptorApp.AppDir/neptor.desktop && \
echo "Name[zh_TW]=開新空視窗" >> NeptorApp.AppDir/neptor.desktop && \
echo "Exec=neptor --new-window %F" >> NeptorApp.AppDir/neptor.desktop && \
echo "Icon=neptor" >> NeptorApp.AppDir/neptor.desktop && \
chmod +x NeptorApp.AppDir/neptor.desktop && \
cp NeptorApp.AppDir/neptor.desktop NeptorApp.AppDir/usr/share/applications/ && \
echo "[Desktop Entry]" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "Name=Neptor - URL Handler" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "Comment=Open source AI code editor." > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "GenericName=Text Editor" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "Exec=neptor --open-url %U" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "Icon=neptor" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "Type=Application" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "NoDisplay=true" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "StartupNotify=true" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "Categories=Utility;TextEditor;Development;IDE;" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "MimeType=x-scheme-handler/neptor;" > NeptorApp.AppDir/neptor-url-handler.desktop && \
echo "Keywords=neptor;" > NeptorApp.AppDir/neptor-url-handler.desktop && \
chmod +x NeptorApp.AppDir/neptor-url-handler.desktop && \
cp NeptorApp.AppDir/neptor-url-handler.desktop NeptorApp.AppDir/usr/share/applications/ && \
echo "#!/bin/bash" > NeptorApp.AppDir/AppRun && \
echo "HERE=\$(dirname \"\$(readlink -f \"\${0}\")\")" >> NeptorApp.AppDir/AppRun && \
echo "export PATH=\${HERE}/usr/bin:\${PATH}" >> NeptorApp.AppDir/AppRun && \
echo "export LD_LIBRARY_PATH=\${HERE}/usr/lib:\${LD_LIBRARY_PATH}" >> NeptorApp.AppDir/AppRun && \
echo "exec \${HERE}/usr/bin/neptor --no-sandbox \"\$@\"" >> NeptorApp.AppDir/AppRun && \
chmod +x NeptorApp.AppDir/AppRun && \
chmod -R 755 NeptorApp.AppDir && \

# Strip unneeded symbols from the binary to reduce size
strip --strip-unneeded NeptorApp.AppDir/usr/bin/neptor

ls -la NeptorApp.AppDir/ && \
ARCH=x86_64 ./appimagetool -n NeptorApp.AppDir Neptor-x86_64.AppImage
'

# Clean up
rm -rf NeptorApp.AppDir .dockerignore appimagetool

echo "AppImage creation complete! Your AppImage is: Neptor-x86_64.AppImage"
