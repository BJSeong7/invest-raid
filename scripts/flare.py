"""Flare (flareteam/flare-game, CC-BY-SA 3.0 art) animation parser + atlas builder.

Usage as a library (see flare-import.py). Flare animation files look like:
    image=images/enemies/goblin.png            (or  image=path,animname  per-animation images)
    [stance]
    frames=4
    duration=800ms
    type=back_forth
    frame=index,direction,x,y,w,h,offsetX,offsetY
Directions: 0=W 1=NW 2=N 3=NE 4=E 5=SE 6=S 7=SW (8 rows). offset = entity origin inside the frame rect.
"""
import re, os
from PIL import Image

def parse_anim(path):
    images = {}
    default_img = None
    anims = {}
    cur = None
    with open(path, encoding='utf-8') as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('image='):
                v = line[6:]
                if ',' in v:
                    p, name = v.split(',', 1)
                    images[name.strip()] = p.strip()
                else:
                    default_img = v.strip()
                continue
            m = re.match(r'^\[(.+)\]$', line)
            if m:
                cur = m.group(1)
                anims[cur] = {'frames': 0, 'duration': 0, 'type': 'play_once', 'frame': {}}
                continue
            if cur is None:
                continue
            k, _, v = line.partition('=')
            if k == 'frames':
                anims[cur]['frames'] = int(v)
            elif k == 'duration':
                anims[cur]['duration'] = int(v.replace('ms', '').replace('s', '')) if v else 0
            elif k == 'type':
                anims[cur]['type'] = v
            elif k == 'frame':
                parts = v.split(',')
                idx, d, x, y, w, h, ox, oy = [int(t) for t in parts[:8]]
                img = images.get(parts[8].strip()) if len(parts) > 8 else None
                anims[cur]['frame'][(idx, d)] = (x, y, w, h, ox, oy, img)
    for name, a in anims.items():
        a['image'] = images.get(name, default_img)
    return anims

class Layer:
    """One sprite sheet (enemy, or one avatar equipment layer)."""
    def __init__(self, root, anim_path):
        self.root = root
        self.anims = parse_anim(anim_path)
        self._img = {}
    def image(self, rel):
        if rel not in self._img:
            self._img[rel] = Image.open(os.path.join(self.root, rel)).convert('RGBA')
        return self._img[rel]
    def frame(self, anim, idx, d):
        a = self.anims.get(anim)
        if not a or (idx, d) not in a['frame']:
            return None
        x, y, w, h, ox, oy, img = a['frame'][(idx, d)]
        return self.image(img or a['image']).crop((x, y, x + w, y + h)), ox, oy

def compose(layers, anim, idx, d, canvas=(256, 256), origin=(128, 200)):
    """Paste each layer's frame so that its entity origin lands at `origin` on a canvas."""
    img = Image.new('RGBA', canvas, (0, 0, 0, 0))
    for L in layers:
        fr = L.frame(anim, idx, d)
        if fr is None:
            continue
        tile, ox, oy = fr
        img.alpha_composite(tile, (origin[0] - ox, origin[1] - oy))
    return img

def anim_frames(layers, anim, d):
    a = next((L.anims[anim] for L in layers if anim in L.anims), None)
    if not a:
        return []
    return [compose(layers, anim, i, d) for i in range(a['frames'])]

def pack(frames_by_key, trim=True):
    """frames_by_key: {key: PIL image (same canvas)}. Returns (sheet, phaser_atlas_json)."""
    keys = list(frames_by_key)
    canvas = frames_by_key[keys[0]].size
    items = []
    for k in keys:
        im = frames_by_key[k]
        bbox = im.getbbox() if trim else (0, 0) + canvas
        if bbox is None:
            bbox = (0, 0, 1, 1)
        items.append((k, im.crop(bbox), bbox))
    # shelf packing
    items_sorted = sorted(items, key=lambda t: -t[1].size[1])
    maxw = 2048
    x = y = rowh = 0
    pos = {}
    for k, im, bbox in items_sorted:
        w, h = im.size
        if x + w > maxw:
            x = 0; y += rowh + 2; rowh = 0
        pos[k] = (x, y)
        x += w + 2; rowh = max(rowh, h)
    sheet = Image.new('RGBA', (maxw if y > 0 else x, y + rowh), (0, 0, 0, 0))
    frames = {}
    for k, im, bbox in items:
        px, py = pos[k]
        sheet.alpha_composite(im, (px, py))
        w, h = im.size
        frames[k] = {'frame': {'x': px, 'y': py, 'w': w, 'h': h}, 'rotated': False, 'trimmed': True,
                     'spriteSourceSize': {'x': bbox[0], 'y': bbox[1], 'w': w, 'h': h},
                     'sourceSize': {'w': canvas[0], 'h': canvas[1]}}
    return sheet, {'frames': frames, 'meta': {'app': 'invest-rpg flare-import', 'size': {'w': sheet.size[0], 'h': sheet.size[1]}, 'scale': '1'}}
