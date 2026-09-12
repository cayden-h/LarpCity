#!/bin/sh
# Downloads the CC0 ambientCG textures the sprite pipeline uses (1K JPG:
# color, OpenGL normal, roughness) into art/textures/<id>/. Safe to rerun.
set -e
cd "$(dirname "$0")"
mkdir -p textures
for id in Bricks075A Concrete034 Asphalt026B; do
  [ -f "textures/$id/${id}_1K-JPG_Color.jpg" ] && continue
  zip="$(mktemp -t "$id").zip"
  curl -sfL -o "$zip" "https://ambientcg.com/get?file=${id}_1K-JPG.zip"
  mkdir -p "textures/$id"
  unzip -oq "$zip" "*_Color.jpg" "*_NormalGL.jpg" "*_Roughness.jpg" -d "textures/$id"
  rm -f "$zip"
done
