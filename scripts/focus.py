# Finds the faces in every photo and writes src/lib/focus.json, a map of
# image path -> CSS object-position, so cropped images keep faces in frame.
# Run after adding photos to public/images/photos:  python scripts/focus.py
# (needs: pip install opencv-python-headless pillow)
import json, os, glob
import cv2, numpy as np
from PIL import Image

cascades = [cv2.CascadeClassifier(cv2.data.haarcascades + f) for f in ('haarcascade_frontalface_default.xml', 'haarcascade_profileface.xml')]
out = {}
for path in sorted(glob.glob('public/images/photos/*.*')):
    name = os.path.basename(path)
    if '-800.' in name or '-2400.' in name:
        continue
    im = Image.open(path).convert('RGB')
    im.thumbnail((1000, 1000))
    g = cv2.equalizeHist(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY))
    w, h = im.size
    faces = [f for c in cascades for f in c.detectMultiScale(g, 1.08, 6, minSize=(max(18, w // 60),) * 2)]
    if faces:
        x0 = min(f[0] for f in faces); x1 = max(f[0] + f[2] for f in faces)
        y0 = min(f[1] for f in faces); y1 = max(f[1] + f[3] for f in faces)
        fx, fy = (x0 + x1) / 2 / w, (y0 + y1) / 2 / h
    else:
        fx, fy = 0.5, 0.35
    fx = 0.5 + (fx - 0.5) * 0.6  # lean towards the centre: a single detected face shouldn't dominate a group shot
    out['/images/photos/' + name] = f'{round(fx * 100)}% {round(min(fy, 0.6) * 100)}%'
    print(name, len(faces), out['/images/photos/' + name])

with open('src/lib/focus.json', 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, indent=1)
    f.write('\n')
