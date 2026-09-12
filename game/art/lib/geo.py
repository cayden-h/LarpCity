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
