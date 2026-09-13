"""Geometry in world coordinates (object at the origin), so box-projected textures line up across objects."""
import math

import bmesh
import bpy


def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def box(name, x0, y0, z0, x1, y1, z1, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1
        v.co.y = y0 if v.co.y < 0 else y1
        v.co.z = z0 if v.co.z < 0 else z1
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))


def cylinder(name, cx, cy, r, z0, z1, mat, verts=12):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy, (z0 + z1) / 2))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))


def pyramid(name, cx, cy, r, z0, h, mat):
    """A four-sided pyramid (a tower cap) whose base edges line up with the axes."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=r * math.sqrt(2), radius2=0, depth=h)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 4, 3, "Z"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy, z0 + h / 2))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))


def quad(name, pts, mat):
    """A single face through four points (bottom-left, bottom-right, top-right, top-left as read on the sign), UV-mapped 0..1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new(p) for p in pts])
    uv = bm.loops.layers.uv.new("UVMap")
    for loop, co in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uv].uv = co
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))


def face_quad(name, face, w, d, u0, u1, z0, z1, mat, off=0.004):
    """A sign on a visible facade, reading left to right on screen.
    "-Y" is the game's left face (u runs along x from 0 to w); "+X" is its right face (u runs from the front corner, y = -d, toward the back)."""
    if face == "-Y":
        y = -d - off
        pts = [(u0, y, z0), (u1, y, z0), (u1, y, z1), (u0, y, z1)]
    else:
        x = w + off
        pts = [(x, -d + u0, z0), (x, -d + u1, z0), (x, -d + u1, z1), (x, -d + u0, z1)]
    return quad(name, pts, mat)


def squircle_tower(name, cx, cy, r0, r1, z0, z1, mat, segments=48, n=4.0, cap=False):
    """A tapered rounded-square shell (superellipse section) from radius r0 at z0 to r1 at z1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()

    def ring(z, r):
        out = []
        for i in range(segments):
            t = 2 * math.pi * i / segments
            c, s = math.cos(t), math.sin(t)
            sx = math.copysign(abs(c) ** (2 / n), c)
            sy = math.copysign(abs(s) ** (2 / n), s)
            out.append(bm.verts.new((cx + r * sx, cy + r * sy, z)))
        return out

    lo, hi = ring(z0, r0), ring(z1, r1)
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new([lo[i], lo[j], hi[j], hi[i]])
    if cap:
        bm.faces.new(hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))


def shadow_catcher(w, d, margin=1.2):
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    for x, y in [(-margin, margin), (w + margin, margin), (w + margin, -d - margin), (-margin, -d - margin)]:
        bm.verts.new((x, y, 0))
    bm.faces.new(bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = _link(bpy.data.objects.new("ground", me))
    ob.is_shadow_catcher = True
    ob.visible_glossy = False  # glass would reflect the transparent catcher as holes
    ob["shadow_catcher"] = True
    return ob


def _mesh(name, verts, faces, mats, face_mats=None):
    """A mesh from vertices and faces (any winding; normals are recalculated). face_mats[i] picks mats[...] for face i."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for i, f in enumerate(faces):
        face = bm.faces.new([vs[j] for j in f])
        if face_mats:
            face.material_index = face_mats[i]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    return _link(bpy.data.objects.new(name, me))


def prism(name, pts, z0, z1, mat):
    """A vertical prism over a 2D outline (a bay window, a rounded bay, an L-shaped wing)."""
    n = len(pts)
    verts = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return _mesh(name, verts, faces, [mat])


def gable(name, x0, y0, x1, y1, z, h, mat, ridge="x", over=0.03, end_mat=None):
    """A gable roof over x0..x1, y0..y1 (y0 < y1) from height z, ridge h higher along x or y.
    The eaves overhang by `over`; end_mat paints the two triangular gable ends (a wall color)."""
    if ridge not in ("x", "y"):
        raise ValueError("ridge must be x or y")
    x0, y0, x1, y1 = x0 - over, y0 - over, x1 + over, y1 + over
    if ridge == "x":
        m = (y0 + y1) / 2
        verts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), (x0, m, z + h), (x1, m, z + h)]
        faces = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (3, 2, 1, 0)]
    else:
        m = (x0 + x1) / 2
        verts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), (m, y0, z + h), (m, y1, z + h)]
        faces = [(0, 4, 5, 3), (1, 2, 5, 4), (0, 1, 4), (3, 5, 2), (3, 2, 1, 0)]
    ends = [0, 0, 1, 1, 0]
    return _mesh(name, verts, faces, [mat, end_mat or mat], ends)


def hip(name, x0, y0, x1, y1, z, h, mat, over=0.03):
    """A hip roof: four slopes up to a ridge along the longer side (a point on a square)."""
    x0, y0, x1, y1 = x0 - over, y0 - over, x1 + over, y1 + over
    if x1 <= x0 or y1 <= y0 or h <= 0:
        raise ValueError("hip requires a positive footprint and height")
    if math.isclose(x1 - x0, y1 - y0, rel_tol=1e-7, abs_tol=1e-9):
        # A square has one apex, not two coincident ridge vertices.
        verts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z),
                 ((x0 + x1) / 2, (y0 + y1) / 2, z + h)]
        faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)]
        return _mesh(name, verts, faces, [mat])
    inset = min(x1 - x0, y1 - y0) / 2
    if x1 - x0 >= y1 - y0:
        m = (y0 + y1) / 2
        verts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), (x0 + inset, m, z + h), (x1 - inset, m, z + h)]
        faces = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (3, 2, 1, 0)]
    else:
        m = (x0 + x1) / 2
        verts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), (m, y0 + inset, z + h), (m, y1 - inset, z + h)]
        faces = [(0, 4, 5, 3), (1, 2, 5, 4), (0, 1, 4), (3, 5, 2), (3, 2, 1, 0)]
    return _mesh(name, verts, faces, [mat])


def cone(name, cx, cy, r, z0, h, mat, verts=12):
    """A cone standing on z0 (a turret cap, a tent, palm fronds)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=0, depth=h)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy, z0 + h / 2))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))
