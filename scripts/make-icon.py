# 生成软件图标的矢量稿：一条盘成 C 形的身体，上半截金色的龙、下半截骨白的蛆，龙头回头看自己的蛆尾。
# 两半都是平涂剪影，眼睛、嘴、鳞脊、蛆的分节都用底色镂空，不用明暗面。配色取自 styles.css 的深色主题。用法：
#   python -I scripts/make-icon.py build/icon.svg
#   npx electron scripts/render-icon.cjs build/icon.svg build/icon.png 1024
#   npx electron scripts/render-icon.cjs build/icon.svg src/renderer/src/logo.png 256
import math, sys
CX, CY, R = 474, 560, 256
GOLD, BONE, BG, LINE = '#e8b33a', '#d9d6c6', '#111311', '#3a3e31'


def P(t, r=R):  # t 度，数学方向（逆时针），屏幕 y 向下
    a = math.radians(t)
    return (CX + r * math.cos(a), CY - r * math.sin(a))


def f(p):
    return f'{p[0]:.1f},{p[1]:.1f}'


def poly(pts, fill):
    o.append(f'<polygon points="{" ".join(f(p) for p in pts)}" fill="{fill}"/>')


def lerp(a, b, k):
    return a + (b - a) * k


o = []
o.append(f'<rect x="28" y="28" width="968" height="968" rx="44" fill="{BG}" stroke="{LINE}" stroke-width="16"/>')

# ---- 蛆：182° 到 318°，一节一节，从尾往头画，后画的压住前面；节与节之间的缝是底色描边 ----
t0, t1, n = 182, 318, 11
for i in range(n):
    t = t1 - (t1 - t0) * i / (n - 1)
    k = min(1, i / (n - 1) * 1.8)  # 0 = 尾，1 = 靠近龙身
    half_w, half_l = lerp(60, 92, k), lerp(40, 50, k)  # 横向半宽、沿身体方向的半长
    x, y = P(t)
    o.append(
        f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{half_w:.1f}" ry="{half_l:.1f}" '
        f'transform="rotate({-t:.1f} {x:.1f} {y:.1f})" fill="{BONE}" stroke="{BG}" stroke-width="10"/>'
    )
for dr in (-20, 20):  # 尾端两个气门
    x, y = P(t1 + 7, R + dr)
    o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="{BG}"/>')

# ---- 龙身：40° 到 180°，从脖子往后逐渐变粗；接蛆的那头是锯齿，咬进蛆身 ----
TA, TB = 40, 180


def half(t):  # 这个角度上龙身的半宽
    return lerp(58, 80, (t - TA) / (TB - TA))


steps = 70
body = [P(lerp(TA, TB, i / steps), R + half(lerp(TA, TB, i / steps))) for i in range(steps + 1)]
for j in range(7):
    r = R + half(TB) - 2 * half(TB) * j / 6
    body.append(P(TB if j % 2 == 0 else TB + 14, r))
body += [P(lerp(TB, TA, i / steps), R - half(lerp(TB, TA, i / steps))) for i in range(steps + 1)]
poly(body, GOLD)

# 背刺：前缘外凸、往尾巴方向掠的弯刺
for t, h in ((66, 92), (90, 100), (114, 96), (138, 86), (162, 66)):
    rb = R + half(t) - 4
    bf, bb = P(t - 11, rb), P(t + 9, rb)
    tip = P(t + 14, rb + h)
    c = P(t - 8, rb + h * 0.8)
    o.append(f'<path d="M {f(bf)} Q {f(c)} {f(tip)} L {f(bb)} Z" fill="{GOLD}"/>')

# 两道镂空鳞脊：沿身体的细月牙，两头尖
for rr, ta, tb, w in ((R + 22, 58, 172, 14), (R - 26, 70, 160, 10)):
    m = 40
    pts = []
    for i in range(m + 1):
        t = lerp(ta, tb, i / m)
        pts.append(P(t, rr + w * math.sin(math.pi * i / m) / 2))
    for i in range(m, -1, -1):
        t = lerp(ta, tb, i / m)
        pts.append(P(t, rr - w * math.sin(math.pi * i / m) / 2))
    poly(pts, BG)

# ---- 龙头：侧脸剪影，张嘴、后掠的角、颈后鬃刺；接在 40° 处，朝右偏下看着自己的蛆尾 ----
hx, hy = P(44)
o.append(f'<g transform="translate({hx:.1f} {hy:.1f}) rotate(24) scale(0.92)">')
# 颈后鬃刺
poly([(-10, -50), (-130, -86), (-30, -6)], GOLD)
poly([(-20, 24), (-140, 40), (-30, 64)], GOLD)
# 两只角：长的在前，短的在后
o.append(f'<path d="M -20,-96 Q -50,-200 -160,-250 Q 30,-160 110,-110 Z" fill="{GOLD}"/>')
o.append(f'<path d="M -50,-80 Q -110,-150 -220,-160 Q -60,-120 20,-100 Z" fill="{GOLD}"/>')
# 头：上颌带一排牙，下颌带一排牙，中间张开的嘴是镂空
head = [
    (-40, -82), (20, -112), (76, -122), (130, -112), (222, -86), (312, -60), (342, -42), (342, -18), (324, -8),
    # 上排牙（往下）
    (312, 24), (298, -4), (282, 20), (268, -2), (252, 16), (240, -2),
    (126, 6),  # 嘴角
    # 下排牙（往上），下颌张得比上颌低
    (216, 52), (232, 28), (246, 56), (262, 36), (278, 64), (298, 64),
    (304, 80), (278, 94), (160, 104), (80, 106), (58, 140), (34, 100), (-40, 86),
]
poly(head, GOLD)
# 镂空：斜眼、压低的眉脊缺口、鼻孔
poly([(112, -80), (200, -56), (120, -42)], BG)
poly([(96, -110), (186, -90), (100, -98)], BG)
poly([(304, -44), (326, -34), (306, -30)], BG)
o.append('</g>')

svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">\n' + '\n'.join(o) + '\n</svg>\n'
open(sys.argv[1], 'w', encoding='utf-8').write(svg)
