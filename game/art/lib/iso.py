"""The game's projection (src/engine/iso.ts), for Blender.

Game tile (gx, gy) maps to Blender (gx, -gy) with z up. The orthographic
camera looks down 30 degrees from the (+X, -Y) side, so a tile renders as a
64 x 32 px diamond, the game's left face is Blender's -Y face, and its right
face is Blender's +X face.
"""
import math

from mathutils import Vector

HALF_W, HALF_H = 32, 16
PX_PER_BU = HALF_W / math.cos(math.radians(45))       # screen px per unit along the ground
Z_PX_PER_BU = PX_PER_BU * math.cos(math.radians(30))  # screen px per unit of height
FLOOR_PX = 20  # bricks.ts FLOOR_H
PLINTH_PX = 4  # bricks.ts PLINTH
VIEW_DIR = Vector((1, -1, math.sqrt(2) * math.tan(math.radians(30)))).normalized()


def px(v: float) -> float:
    """Screen pixels of height to Blender units."""
    return v / Z_PX_PER_BU


def body_top(floors: int) -> float:
    return px(PLINTH_PX + floors * FLOOR_PX)


def ground_at_screen(sx: float, sy: float) -> Vector:
    """The ground point drawn sx, sy game pixels from tile (0, 0)'s top corner."""
    a, b = sx / HALF_W, sy / HALF_H  # a = gx - gy, b = gx + gy
    return Vector(((a + b) / 2, -(b - a) / 2, 0))
