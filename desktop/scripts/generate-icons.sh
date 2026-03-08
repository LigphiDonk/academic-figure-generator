#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_IMAGE_PNG="${ROOT_DIR}/logo.png"
SOURCE_IMAGE_JPG="${ROOT_DIR}/logo.jpg"
ICON_DIR="${ROOT_DIR}/desktop/src-tauri/icons"
ICONSET_DIR="${ICON_DIR}/icon.iconset"
PUBLIC_LOGO_PNG="${ROOT_DIR}/desktop/public/logo.png"
PUBLIC_LOGO_JPG="${ROOT_DIR}/desktop/public/logo.jpg"
PYTHON_BIN=""

required_paths=(
  "${ICON_DIR}/32x32.png"
  "${ICON_DIR}/128x128.png"
  "${ICON_DIR}/icon.png"
  "${ICON_DIR}/icon.ico"
  "${ICON_DIR}/icon.icns"
  "${PUBLIC_LOGO_PNG}"
  "${PUBLIC_LOGO_JPG}"
)

if [[ -f "${SOURCE_IMAGE_PNG}" ]]; then
  SOURCE_IMAGE="${SOURCE_IMAGE_PNG}"
elif [[ -f "${SOURCE_IMAGE_JPG}" ]]; then
  SOURCE_IMAGE="${SOURCE_IMAGE_JPG}"
else
  echo "Source image not found. Expected one of: ${SOURCE_IMAGE_PNG} or ${SOURCE_IMAGE_JPG}" >&2
  exit 1
fi

for candidate in "$(command -v python3 2>/dev/null || true)" "/opt/homebrew/Caskroom/miniconda/base/bin/python3" "/usr/bin/python3"; do
  if [[ -n "${candidate}" ]] && [[ -x "${candidate}" ]] && "${candidate}" -c 'from PIL import Image' >/dev/null 2>&1; then
    PYTHON_BIN="${candidate}"
    break
  fi
done

mkdir -p "${ICON_DIR}"
mkdir -p "$(dirname "${PUBLIC_LOGO_PNG}")"

if [[ -z "${PYTHON_BIN}" ]]; then
  missing_paths=()
  for path in "${required_paths[@]}"; do
    if [[ ! -f "${path}" ]]; then
      missing_paths+=("${path}")
    fi
  done

  if (( ${#missing_paths[@]} == 0 )); then
    echo "Pillow not available; reusing checked-in icon assets." >&2
    exit 0
  fi

  echo "A Python interpreter with Pillow is required to generate icons." >&2
  printf 'Missing generated assets:\n' >&2
  printf '  %s\n' "${missing_paths[@]}" >&2
  exit 1
fi

"${PYTHON_BIN}" -c '
from pathlib import Path
import shutil
from PIL import Image

source_path = Path("'"${SOURCE_IMAGE}"'")
icon_dir = Path("'"${ICON_DIR}"'")
iconset_dir = Path("'"${ICONSET_DIR}"'")
public_logo_png = Path("'"${PUBLIC_LOGO_PNG}"'")
public_logo_jpg = Path("'"${PUBLIC_LOGO_JPG}"'")

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
source.save(public_logo_png, format="PNG")
source.convert("RGB").save(public_logo_jpg, format="JPEG", quality=95)

def render_square(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    image = source.copy()
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    offset = ((size - image.width) // 2, (size - image.height) // 2)
    canvas.alpha_composite(image, offset)
    return canvas

def save_png(size: int, path: Path) -> None:
    render_square(size).save(path, format="PNG")

iconset_sizes = [16, 32, 128, 256, 512]
for size in iconset_sizes:
    save_png(size, iconset_dir / f"icon_{size}x{size}.png")
    save_png(size * 2, iconset_dir / f"icon_{size}x{size}@2x.png")

save_png(32, icon_dir / "32x32.png")
save_png(128, icon_dir / "128x128.png")
save_png(256, icon_dir / "128x128@2x.png")
save_png(1024, icon_dir / "icon.png")
render_square(1024).save(icon_dir / "icon.icns", format="ICNS")

render_square(256).save(
    icon_dir / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
'

echo "Generated Tauri icons from ${SOURCE_IMAGE}"
