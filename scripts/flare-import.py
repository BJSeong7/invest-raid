"""Builds game-ready atlases from Flare's art (CC-BY-SA 3.0, see assets/flare/CREDITS.txt).

  python3 scripts/flare-import.py <path-to-flare-game>/mods/fantasycore

Outputs dist/assets/flare/<key>.png + <key>.json (Phaser JSON-hash atlas), bg_dungeon.jpg, manifest.json.
Heroes face right (direction 5 = SE), bosses face left (direction 7 = SW).
"""
import sys, os, json, shutil
sys.path.insert(0, os.path.dirname(__file__))
from flare import Layer, compose, pack
from PIL import Image

R = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-claude/96400a46-62ae-5fb0-b889-1555f1b99326/scratchpad/flare/mods/fantasycore'
OUT = os.path.join(os.path.dirname(__file__), '..', 'dist', 'assets', 'flare')
os.makedirs(OUT, exist_ok=True)

AV = lambda n: Layer(R, f'{R}/animations/avatar/male/{n}.txt')
EN = lambda n: Layer(R, f'{R}/animations/enemies/{n}.txt')

# draw order per direction (from engine/hero_layers.txt); slot -> layer name per hero
ORDER = {5: ['feet', 'legs', 'hands', 'main', 'chest', 'head', 'off'], 7: ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'], 4: ['feet', 'legs', 'hands', 'chest', 'off', 'head', 'main']}
HEROES = {
    'hero_tank':    dict(feet='plate_boots', legs='plate_greaves', hands='plate_gauntlets', chest='plate_cuirass', head='plate_helm', main='longsword', off='kite_shield'),
    'hero_dealer':  dict(feet='leather_boots', legs='leather_pants', hands='leather_gloves', chest='leather_chest', head='head_short', main='greatsword'),
    'hero_healer':  dict(feet='mage_boots', legs='mage_skirt', hands='mage_sleeves', chest='mage_vest', head='mage_hood', main='greatstaff'),
    'hero_support': dict(feet='leather_boots', legs='cloth_pants', hands='cloth_gloves', chest='cloth_shirt', head='leather_hood', main='longbow'),
}
BOSSES = {'boss_minotaur': 'minotaur', 'boss_wyvern': 'wyvern_fire', 'boss_fireant': 'fire_ant', 'boss_skeleton': 'skeleton'}
HERO_ANIMS = ['stance', 'swing', 'cast', 'shoot', 'block', 'hit', 'die']
BOSS_ANIMS = ['stance', 'swing', 'cast', 'hit', 'die', 'run']
HERO_DIR, BOSS_DIR = 5, 7
HERO_CANVAS, HERO_ORIGIN = (256, 256), (128, 208)
BOSS_CANVAS, BOSS_ORIGIN = (520, 520), (260, 440)

manifest = {'credits': 'Art: Flare (flareteam/flare-game), CC-BY-SA 3.0. Clint Bellanger, Justin Nichol, Justin Jacobs and contributors.', 'units': {}}

def build(key, layers, anims, d, canvas, origin):
    frames = {}
    info = {}
    for an in anims:
        a = next((L.anims[an] for L in layers if an in L.anims), None)
        if not a:
            continue
        info[an] = {'frames': a['frames'], 'duration': a['duration'], 'type': a['type']}
        for i in range(a['frames']):
            frames[f'{an}/{i}'] = compose(layers, an, i, d, canvas, origin)
    sheet, atlas = pack(frames)
    sheet.save(f'{OUT}/{key}.png', optimize=True)
    json.dump(atlas, open(f'{OUT}/{key}.json', 'w'))
    manifest['units'][key] = {'anims': info, 'origin': [origin[0] / canvas[0], origin[1] / canvas[1]], 'canvas': canvas}
    print(key, sheet.size, {k: v['frames'] for k, v in info.items()}, os.path.getsize(f'{OUT}/{key}.png') // 1024, 'KB')

for key, slots in HEROES.items():
    layers = [AV(slots[s]) for s in ORDER[HERO_DIR] if s in slots]
    build(key, layers, HERO_ANIMS, HERO_DIR, HERO_CANVAS, HERO_ORIGIN)
for key, name in BOSSES.items():
    build(key, [EN(name)], BOSS_ANIMS, BOSS_DIR, BOSS_CANVAS, BOSS_ORIGIN)

Image.open(f'{R}/images/menus/backgrounds/dungeon.jpg').convert('RGB').resize((1280, 720), Image.LANCZOS).save(f'{OUT}/bg_dungeon.jpg', quality=82, optimize=True)
json.dump(manifest, open(f'{OUT}/manifest.json', 'w'), ensure_ascii=False, indent=1)
shutil.copy(f'{R}/../../CREDITS.txt', f'{OUT}/CREDITS.txt') if os.path.exists(f'{R}/../../CREDITS.txt') else None
print('done ->', OUT)

# ---- portraits (head crop) and cut-in full-body images --------------------------------------
def frame_img(key, name):
    atlas = json.load(open(f'{OUT}/{key}.json')); sheet = Image.open(f'{OUT}/{key}.png')
    f = atlas['frames'][name]; r = f['frame']; src = f['spriteSourceSize']; ss = f['sourceSize']
    im = Image.new('RGBA', (ss['w'], ss['h']), (0, 0, 0, 0))
    im.alpha_composite(sheet.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])), (src['x'], src['y']))
    return im

for key in list(HEROES) + list(BOSSES):
    for an, suffix in (('stance/0', ''), ('hit/0', '_hit')):
        try:
            im = frame_img(key, an)
        except KeyError:
            continue
        bb = im.getbbox(); body = im.crop(bb)
        # cut-in: full body, 560px tall
        h = 560; w = int(body.size[0] * h / body.size[1]); body.resize((w, h), Image.LANCZOS).save(f'{OUT}/cut_{key}{suffix}.png', optimize=True)
        if suffix == '':
            # portrait: square around the head (top ~45% of the body), centred horizontally on the body's upper mass
            side = int(body.size[1] * 0.48)
            top = body.crop((0, 0, body.size[0], side)); bbt = top.getbbox() or (0, 0, body.size[0], side)
            cx = (bbt[0] + bbt[2]) // 2; left = max(0, min(body.size[0] - side, cx - side // 2))
            body.crop((left, 0, left + side, side)).resize((160, 160), Image.LANCZOS).save(f'{OUT}/portrait_{key}.png', optimize=True)
print('portraits + cut-ins done')
