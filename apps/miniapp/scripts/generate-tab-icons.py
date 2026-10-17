"""Regenerate native tab icons: python3 scripts/generate-tab-icons.py (requires Pillow)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
colors = json.loads((root / '../../packages/design-tokens/tokens.json').read_text())['color']
output = root / 'src/assets/tabs'
output.mkdir(parents=True, exist_ok=True)

for name in ['home', 'discover', 'messages', 'profile']:
    for selected in [False, True]:
        image = Image.new('RGBA', (192, 192))
        draw = ImageDraw.Draw(image)
        color = colors['ink'] if selected else colors['textMuted']
        if selected:
            draw.rounded_rectangle((10, 10, 182, 182), radius=52, fill=colors['brand'])
        if name == 'home':
            draw.line([(43, 87), (96, 42), (149, 87)], fill=color, width=8, joint='curve')
            draw.line([(53, 80), (53, 146), (139, 146), (139, 80)], fill=color, width=8)
            draw.line([(83, 146), (83, 108), (109, 108), (109, 146)], fill=color, width=8)
        elif name == 'discover':
            for x in [48, 108]:
                for y in [48, 108]:
                    draw.rounded_rectangle((x, y, x + 36, y + 36), radius=10, outline=color, width=7)
        elif name == 'messages':
            draw.rounded_rectangle((42, 47, 150, 131), radius=22, outline=color, width=8)
            draw.line([(62, 128), (62, 151), (89, 131)], fill=color, width=8)
            draw.line([(67, 77), (125, 77)], fill=color, width=7)
            draw.line([(67, 101), (108, 101)], fill=color, width=7)
        else:
            draw.ellipse((72, 42, 120, 90), outline=color, width=8)
            draw.arc((43, 102, 149, 186), 180, 360, fill=color, width=8)
            draw.line([(44, 144), (148, 144)], fill=color, width=8)
        suffix = '-active' if selected else ''
        image.resize((64, 64), Image.Resampling.LANCZOS).save(output / f'{name}{suffix}.png')
