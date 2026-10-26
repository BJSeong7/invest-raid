#!/usr/bin/env python3
"""Turns the AI-generated character sheets in art-src/ into game-ready sprites in dist/assets/anime/.

Each sheet is N poses of one character on a flat green background. Steps: chroma key (distance to the
estimated background colour + hue rule where safe), unmix edge pixels, split poses by column gaps,
crop all poses of one sheet to a shared baseline so texture swaps keep the feet on the ground.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), '..', 'art-src')
OUT = os.path.join(os.path.dirname(__file__), '..', 'dist', 'assets', 'anime')
os.makedirs(OUT, exist_ok=True)

SHEETS = {
    'hero_tank':     dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'hero_dealer':   dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'hero_healer':   dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'hero_support':  dict(poses=['idle', 'attack', 'hurt'], hue_rule=False),   # green hair & cape
    'boss_minotaur': dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'boss_wyvern':   dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'boss_fireant':  dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'boss_lich':     dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'boss_skeleton': dict(poses=['idle', 'attack', 'hurt'], hue_rule=True),
    'fx':            dict(poses=['slash', 'burst', 'heal', 'shield', 'star', 'bolt'], hue_rule=False),
}

def rgb_to_hue(rgb):
    r, g, b = [c / 255.0 for c in rgb.transpose(2, 0, 1)]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    d = mx - mn + 1e-9
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = d / (mx + 1e-9)
    return h, s

def key(img, hue_rule):
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    H, W, _ = a.shape
    border = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(-1))
    t1, t2 = 40.0, 130.0
    alpha = np.clip((dist - t1) / (t2 - t1), 0, 1)
    if hue_rule:
        h, s = rgb_to_hue(a)
        bh, bs = rgb_to_hue(bg.reshape(1, 1, 3)); bh = float(bh[0, 0])
        dh = np.minimum(np.abs(h - bh), 360 - np.abs(h - bh))
        greenish = (dh < 18) & (s > 0.45) & (a[..., 1] > 50)
        alpha[greenish] = 0
    # unmix: fg = (c - (1-a)*bg) / a
    al = alpha[..., None]
    fg = np.where(al > 0.02, (a - (1 - al) * bg) / np.maximum(al, 0.02), a)
    fg = np.clip(fg, 0, 255)
    # kill residual green cast on semi-transparent pixels
    edge = (alpha > 0) & (alpha < 1)
    g_excess = np.clip(fg[..., 1] - np.maximum(fg[..., 0], fg[..., 2]), 0, None)
    fg[..., 1] = np.where(edge, fg[..., 1] - g_excess * 0.7, fg[..., 1])
    out = np.dstack([fg, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    # tiny alpha clean-up: drop isolated speckles
    m = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    speck = (np.asarray(m) == 0) & (alpha > 0)
    out[..., 3][speck] = 0
    return Image.fromarray(out, 'RGBA')

def split(im, n):
    a = np.asarray(im)[..., 3]
    cols = (a > 8).sum(0) > 0
    segs, start = [], None
    for x, v in enumerate(list(cols) + [False]):
        if v and start is None: start = x
        if not v and start is not None: segs.append([start, x]); start = None
    # merge segments separated by small gaps, then merge smallest until n remain
    merged = [segs[0]]
    for s in segs[1:]:
        if s[0] - merged[-1][1] < 14: merged[-1][1] = s[1]
        else: merged.append(s)
    while len(merged) > n:
        widths = [s[1] - s[0] for s in merged]
        i = int(np.argmin(widths))
        if i == 0: j = 1
        elif i == len(merged) - 1: j = i - 1
        else: j = i - 1 if (merged[i][0] - merged[i - 1][1]) < (merged[i + 1][0] - merged[i][1]) else i + 1
        lo, hi = min(i, j), max(i, j)
        merged[lo] = [merged[lo][0], merged[hi][1]]; del merged[hi]
    colsum = (a > 8).sum(0)
    while len(merged) < n:   # two poses touching (e.g. a weapon swing crossing the gap): cut the widest at its thinnest column
        widths = [s[1] - s[0] for s in merged]; i = int(np.argmax(widths)); x0, x1 = merged[i]
        lo, hi = x0 + int((x1 - x0) * .3), x0 + int((x1 - x0) * .7)
        cut = lo + int(np.argmin(colsum[lo:hi]))
        merged[i:i + 1] = [[x0, cut], [cut, x1]]
    if len(merged) != n: raise SystemExit(f'expected {n} poses, found {len(merged)}: {merged}')
    return merged

manifest = {}
for name, cfg in SHEETS.items():
    src = os.path.join(SRC, f'sheet_{name}.png')
    im = key(Image.open(src), cfg['hue_rule'])
    segs = split(im, len(cfg['poses']))
    a = np.asarray(im)[..., 3]
    if name == 'fx':
        for (x0, x1), pose in zip(segs, cfg['poses']):
            rows = np.where((a[:, x0:x1] > 8).sum(1) > 0)[0]
            crop = im.crop((x0, rows.min(), x1, rows.max() + 1))
            crop.save(os.path.join(OUT, f'fx_{pose}.png'), optimize=True)
            manifest[f'fx_{pose}'] = {'w': crop.size[0], 'h': crop.size[1]}
        continue
    # shared baseline: common top/bottom across poses, each pose centred in a canvas of the max width
    tops, bots = [], []
    for x0, x1 in segs:
        rows = np.where((a[:, x0:x1] > 8).sum(1) > 0)[0]; tops.append(rows.min()); bots.append(rows.max() + 1)
    top, bot = min(tops), max(bots)
    wmax = max(x1 - x0 for x0, x1 in segs)
    entry = {'w': wmax, 'h': bot - top, 'poses': {}}
    for (x0, x1), pose in zip(segs, cfg['poses']):
        canvas = Image.new('RGBA', (wmax, bot - top), (0, 0, 0, 0))
        crop = im.crop((x0, top, x1, bot))
        canvas.alpha_composite(crop, ((wmax - (x1 - x0)) // 2, 0))
        canvas.save(os.path.join(OUT, f'{name}_{pose}.png'), optimize=True)
        entry['poses'][pose] = {'feet': bots[cfg['poses'].index(pose)] - top}
    manifest[name] = entry
    # portrait: square crop around the head (top third of the idle pose)
    idle = Image.open(os.path.join(OUT, f'{name}_idle.png'))
    ia = np.asarray(idle)[..., 3]
    cols = np.where((ia > 8).sum(0) > 0)[0]; rows = np.where((ia > 8).sum(1) > 0)[0]
    cx = (cols.min() + cols.max()) // 2; side = int((rows.max() - rows.min()) * 0.5)
    cy = rows.min() + side // 2
    box = (max(0, cx - side // 2), max(0, cy - side // 2), max(0, cx - side // 2) + side, max(0, cy - side // 2) + side)
    pf = Image.new('RGBA', (side, side), (0, 0, 0, 0)); pf.alpha_composite(idle.crop(box))
    pf.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, f'portrait_{name}.png'), optimize=True)
    print(name, entry['w'], entry['h'], segs)

# background 1280x720
bg = Image.open(os.path.join(SRC, 'bg_meadow_src.png')).convert('RGB')
w, h = bg.size; tw, th = 1280, 720
s = max(tw / w, th / h); bg = bg.resize((round(w * s), round(h * s)), Image.LANCZOS)
l, t = (bg.size[0] - tw) // 2, (bg.size[1] - th) // 2
bg.crop((l, t, l + tw, t + th)).save(os.path.join(OUT, 'bg_meadow.jpg'), quality=88, optimize=True)
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False, default=int)
open(os.path.join(OUT, 'CREDITS.txt'), 'w').write('캐릭터·보스·배경·이펙트: 이 프로젝트를 위해 AI(Figma AI 이미지 생성, Gemini 모델)로 생성한 오리지널 디자인. 프롬프트와 가공 파이프라인: scripts/anime-import.py\n')
print('done ->', OUT, len(os.listdir(OUT)), 'files')
