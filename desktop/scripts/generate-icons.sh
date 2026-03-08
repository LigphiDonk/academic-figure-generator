#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_IMAGE="${ROOT_DIR}/logo.jpg"
ICON_DIR="${ROOT_DIR}/desktop/src-tauri/icons"
ICONSET_DIR="${ICON_DIR}/icon.iconset"
PUBLIC_LOGO="${ROOT_DIR}/desktop/public/logo.jpg"
PYTHON_BIN=""

if [[ ! -f "${SOURCE_IMAGE}" ]]; then
  echo "Source image not found: ${SOURCE_IMAGE}" >&2
  exit 1
fi

for candidate in "$(command -v python3 2>/dev/null || true)" "/opt/homebrew/Caskroom/miniconda/base/bin/python3" "/usr/bin/python3"; do
  if [[ -n "${candidate}" ]] && [[ -x "${candidate}" ]] && "${candidate}" -c 'from PIL import Image' >/dev/null 2>&1; then
    PYTHON_BIN="${candidate}"
    break
  fi
done

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "A Python interpreter with Pillow is required to generate icons." >&2
  exit 1
fi

mkdir -p "${ICON_DIR}"
mkdir -p "$(dirname "${PUBLIC_LOGO}")"

cp "${SOURCE_IMAGE}" "${PUBLIC_LOGO}"

"${PYTHON_BIN}" -c '
from pathlib import Path
import shutil
from PIL import Image

source_path = Path("'"${SOURCE_IMAGE}"'")
icon_dir = Path("'"${ICON_DIR}"'")
iconset_dir = Path("'"${ICONSET_DIR}"'")

for path in [
    icon_dir / "32x32.png",
    icon_dir / "128x128.png",
    icon_dir / "128x128@2x.png",
    icon_dir / "icon.png",
    icon_dir / "icon.icns",
    icon_dir / "icon.ico",
    icon_dir / "icon.tiff",
]:
    if path.exists():
        path.unlink()

if iconset_dir.exists():
    shutil.rmtree(iconset_dir)
iconset_dir.mkdir(parents=True, exist_ok=True)

source = Image.open(source_path).convert("RGBA")

def save_png(size: int, path: Path) -> None:
    source.resize((size, size), Image.Resampling.LANCZOS).save(path, format="PNG")

iconset_sizes = [16, 32, 128, 256, 512]
for size in iconset_sizes:
    save_png(size, iconset_dir / f"icon_{size}x{size}.png")
    save_png(size * 2, iconset_dir / f"icon_{size}x{size}@2x.png")

save_png(32, icon_dir / "32x32.png")
save_png(128, icon_dir / "128x128.png")
save_png(256, icon_dir / "128x128@2x.png")
save_png(1024, icon_dir / "icon.png")
source.resize((1024, 1024), Image.Resampling.LANCZOS).save(icon_dir / "icon.tiff", format="TIFF")

source.save(
    icon_dir / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
'

tiff2icns "${ICON_DIR}/icon.tiff" "${ICON_DIR}/icon.icns"

echo "Generated Tauri icons from ${SOURCE_IMAGE}"
