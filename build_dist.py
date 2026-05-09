"""Build a single-file distributable HTML from the modular source.

Reads index.html as the template, then:
- Replaces <link rel="stylesheet" href="css/styles.css"> with inlined <style>
- Replaces each local <script src="..."> with inlined <script>
"""

import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))

def read(path):
    with open(os.path.join(BASE, path), encoding='utf-8') as f:
        return f.read()

html = read('index.html')

# Inline local CSS links
def replace_css(m):
    href = m.group(1)
    if href.startswith('http'):
        return m.group(0)
    css = read(href)
    return f'<style>\n{css}\n</style>'

html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', replace_css, html)

# Inline local JS scripts
def replace_js(m):
    src = m.group(1)
    if src.startswith('http'):
        return m.group(0)
    js = read(src)
    return f'<script>\n{js}\n</script>'

html = re.sub(r'<script src="([^"]+)"></script>', replace_js, html)

out_path = os.path.join(BASE, 'researcher-kg.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

size_kb = os.path.getsize(out_path) / 1024
print(f"Built: {out_path}  ({size_kb:.0f} KB)")
