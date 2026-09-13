"""Build and validate the 16 SF house variants and six hero homes without rendering.

From the repository root:
    blender -b --python-exit-code 1 -P game/art/check_houses.py

The script clears its Blender scene between cases and writes no assets or blend files.
Checks cover mesh integrity, exact returned heights, seeded repeatability, roof primitives,
world-space pixel materials, studio lighting, and the three reviewed intersection defects.
Pixel readability and rendered registration still need the separate art review.
"""
import inspect
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import geo, homes, houses, materials


# Canonical model inputs from the approved houses plan, independent of render orchestration.
CASES = [
    ("victorian-italianate", houses.victorian, (1, 1, 2, 101), {"variant": "italianate"}),
    ("victorian-stick", houses.victorian, (1, 1, 3, 102), {"variant": "stick", "garage": True}),
    ("victorian-queen_anne", houses.victorian, (1, 1, 3, 103), {"variant": "queen_anne"}),
    ("edwardian-single", houses.edwardian, (1, 1, 2, 111), {"variant": "single"}),
    ("edwardian-double", houses.edwardian, (1, 1, 3, 112), {"variant": "double"}),
    *[(f"stucco-{i}", houses.stucco_row, (1, 1, 2, 121 + i), {"variant": i}) for i in range(4)],
    *[(f"suburban-{variant}", houses.suburban, (1, 1, floors, 131 + i), {"variant": variant})
      for i, (variant, floors) in enumerate((("ranch", 1), ("split", 2), ("colonial", 2), ("craftsman", 1)))],
    *[(f"walkup-{i}", houses.walkup, (width, 1, floors, 141 + i), {"variant": i})
      for i, (width, floors) in enumerate(((1, 4), (1, 3), (2, 4)))],
    ("home-0", homes.home_tent, (1, 1, 1, 200), {}),
    ("home-1", homes.home_studio, (1, 1, 4, 201), {}),
    ("home-2", homes.home_bungalow, (1, 1, 1, 202), {}),
    ("home-3", homes.home_townhouse, (1, 1, 3, 203), {}),
    ("home-4", homes.home_colonial, (1, 1, 2, 204), {}),
    ("home-5", homes.home_villa, (1, 1, 2, 205), {}),
]


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def meshes():
    return [ob for ob in bpy.context.scene.objects if ob.type == "MESH"]


def bounds(ob):
    """World bounds, including the hero builders' baked inset."""
    points = [ob.matrix_world @ vertex.co for vertex in ob.data.vertices]
    return [(min(p[i] for p in points), max(p[i] for p in points)) for i in range(3)]


def overlap(a, b):
    a, b = bounds(a), bounds(b)
    return all(min(a[i][1], b[i][1]) - max(a[i][0], b[i][0]) > 1e-6 for i in range(3))


def check_meshes():
    assert meshes(), "builder made no meshes"
    for ob in meshes():
        me = ob.data
        assert all(math.isfinite(c) for v in me.vertices for c in v.co), (ob.name, "nonfinite vertex")
        assert all(p.area > 1e-10 for p in me.polygons), (ob.name, "degenerate face")
        assert all(p.material_index < len(me.materials) for p in me.polygons), (ob.name, "missing material")
        bm = bmesh.new()
        try:
            bm.from_mesh(me)
            assert all(e.is_manifold for e in bm.edges), (ob.name, "nonmanifold edge")
            assert bm.calc_volume(signed=True) > 0, (ob.name, "inward or zero volume")
        finally:
            bm.free()


def fingerprint():
    """Geometry and assigned material names must repeat for the same seed."""
    return tuple(
        (ob.name, tuple(tuple(round(c, 6) for c in v.co) for v in ob.data.vertices),
         tuple((tuple(p.vertices), p.material_index) for p in ob.data.polygons),
         tuple(mat.name for mat in ob.data.materials))
        for ob in sorted(meshes(), key=lambda ob: ob.name)
    )


def check_front_entrance():
    entrances = [ob for ob in meshes() if ob.name == "door" or ob.name.startswith("door-")]
    glass = [ob for ob in meshes() if ob.name.endswith("-glass")]
    assert entrances and glass
    for pane in glass:
        prefix = pane.name.removesuffix("-glass") + "-"
        for part in [ob for ob in meshes() if ob.name.startswith(prefix)]:
            for entrance in entrances:
                assert not overlap(part, entrance), (part.name, "overlaps entrance", entrance.name)


def check_suv():
    driveway = bounds(bpy.data.objects["drive"])
    car = [ob for ob in meshes() if ob.name.startswith("car-")]
    garage = [ob for ob in meshes() if ob.name == "garage" or ob.name.startswith("garage-door")]
    assert car and garage
    for part in car:
        b = bounds(part)
        for axis in (0, 1):
            assert b[axis][0] >= driveway[axis][0] - 1e-6, (part.name, "outside driveway")
            assert b[axis][1] <= driveway[axis][1] + 1e-6, (part.name, "outside driveway")
        for wall in garage:
            assert not overlap(part, wall), (part.name, "penetrates garage", wall.name)


def check_rear_entrance():
    rear = bpy.data.objects["rear-door"]
    for step in [ob for ob in meshes() if ob.name.startswith("back-step")]:
        assert bounds(step)[2][1] <= bounds(rear)[2][0] + 1e-6, "rear steps must stop below the door sill"
    b = bounds(rear)
    for fraction in (0.2, 0.5, 0.85):
        origin = Vector(((b[0][0] + b[0][1]) / 2, 0.2, b[2][0] + (b[2][1] - b[2][0]) * fraction))
        hit, _, _, _, ob, _ = bpy.context.scene.ray_cast(
            bpy.context.evaluated_depsgraph_get(), origin, Vector((0, -1, 0)))
        assert hit and ob.name.startswith("rear-door"), ("rear door obscured", fraction, ob.name if hit else None)


def check_studio_light():
    luminous = []
    for ob in meshes():
        for mat in ob.data.materials:
            emit = mat.node_tree.nodes.get("emit")
            if emit and not emit.inputs["Color"].is_linked:
                if emit.inputs["Strength"].default_value > 0 and sum(emit.inputs["Color"].default_value[:3]) > 0:
                    luminous.append(ob.name)
            if mat.get("glass"):
                # The random occupancy comparison must always be false for studio glass.
                occupancy = [link.to_node for link in mat.node_tree.links
                             if link.from_node.bl_idname == "ShaderNodeTexWhiteNoise"
                             and link.to_node.bl_idname == "ShaderNodeMath"
                             and link.to_node.operation == "LESS_THAN"]
                assert occupancy and all(n.inputs[1].default_value == 0 for n in occupancy), "studio glass can light randomly"
    assert luminous == ["home-window"], ("studio must have one lit window only", luminous)


def check_model(label, builder, args, opts):
    clear()
    peak = builder(*args, **opts)
    bpy.context.view_layer.update()
    check_meshes()
    actual = max(bounds(ob)[2][1] for ob in meshes())
    assert abs(peak - actual) < 1e-5, (label, "wrong peak", peak, actual)
    if label in ("suburban-ranch", "suburban-split"):
        check_front_entrance()
    if label == "home-4":
        check_suv()
    if label.startswith("victorian-") or label == "home-3":
        check_rear_entrance()
    if label == "home-1":
        check_studio_light()
    before = fingerprint()
    clear()
    builder(*args, **opts)
    assert fingerprint() == before, (label, "not repeatable")
    # These are only transform sanity checks, not rendered registration checks.
    for turn in range(4):
        rotation = Matrix.Rotation(turn * math.pi / 2, 4, "Z")
        for ob in meshes():
            assert all(math.isfinite(c) for v in ob.data.vertices for c in rotation @ v.co)
    print(f"PASS {label}: {len(meshes())} meshes, peak {peak:.5f}, repeatable", flush=True)


def check_primitives_and_materials():
    clear()
    mat = materials.flat("roof-test", (0.5, 0.5, 0.5, 1))
    for i, (w, d) in enumerate(((1, 1), (2, 1), (1, 2), (1, 1.00000001))):
        ob = geo.hip(f"hip{i}", 0, 0, w, d, 0, 1, mat)
        assert len(ob.data.vertices) == (5 if abs(w - d) < 1e-7 else 6), "square hip needs a single apex"
    for ridge in ("x", "y"):
        end = materials.flat(f"end-{ridge}", (1, 0, 0, 1))
        ob = geo.gable(f"gable-{ridge}", 0, 0, 1, 2, 0, 1, mat, ridge=ridge, end_mat=end)
        assert [p.material_index for p in ob.data.polygons] == [0, 0, 1, 1, 0]
        assert all(len(p.vertices) == 3 for p in ob.data.polygons if p.material_index == 1)
    check_meshes()
    for mat in (materials.lined("test-lined", (0.5, 0.5, 0.5, 1)), materials.paint("paint-test")):
        links = mat.node_tree.links
        assert any(link.from_node.bl_idname == "ShaderNodeNewGeometry" and link.from_socket.name == "Position"
                   for link in links), "pixel courses must use world-space position"
        assert not any(node.bl_idname == "ShaderNodeTexCoord" for node in mat.node_tree.nodes)
    print("PASS square/rectangular hip roofs, both gable directions, and world-space pixel materials", flush=True)


def main():
    for case in CASES:
        check_model(*case)
    check_primitives_and_materials()
    for builder in (*houses.HOUSE_BUILDERS.values(), *homes.HOME_BUILDERS.values()):
        print(f"SIGNATURE {builder.__name__}{inspect.signature(builder)}")
    print("PASS all 22 models, three intersection regressions, studio lighting, and roof/material checks", flush=True)
    clear()


if __name__ == "__main__":
    main()
