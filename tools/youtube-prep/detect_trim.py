"""Finds the camera set-up moments at the start and end of a recording.

Looks at the first and last 60 seconds (2 frames per second, small size) for:
  - face:   a face close to the lens (someone checking the camera)
  - moves:  the whole picture shifting at once (the camera being handled)
  - close:  something right in front of the lens covering a large part of the picture
  - dark:   a black picture (lens covered, stage lights off)
Dancers moving in a still frame do not count. Only a moment that touches the first / last
8 seconds is cut: up to 45 seconds when the camera moves or the picture is black, otherwise
(a face or someone close) at most 20 seconds, because real set-up moments are short.
Not cut: recordings under 10 minutes, and footage where these signs are present most of the
time (handheld or close-up filming). Never more than 10% of the recording.
Prints JSON: {"start": s, "end": s, "signals": [[t, [...]], ...]}.

Usage: python detect_trim.py <video> <duration-seconds>
"""
import json, subprocess, sys
import numpy as np
import cv2

W, H, FPS = 480, 270, 2
WINDOW, EDGE, MAX_CUT, MAX_SHORT, GAP, MIN_LENGTH, BUSY = 60, 8, 45, 20, 6, 600, 0.6
FACE = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')


def frames(path, start, length):
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(max(0, start)), '-t', str(length), '-i', path,
           '-vf', f'fps={FPS},scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(raw) // (W * H)
    return np.frombuffer(raw[: n * W * H], np.uint8).reshape(n, H, W)


def signals(stack, offset):
    small = np.stack([cv2.resize(f, (160, 90)) for f in stack]).astype(np.float32)
    background = np.median(small, axis=0)  # the room as it looks most of the time
    out = []
    for i, f in enumerate(stack):
        why = []
        size = int(H * 0.22)
        if len(FACE.detectMultiScale(f, 1.1, 7, minSize=(size, size))) or len(PROFILE.detectMultiScale(f, 1.1, 7, minSize=(size, size))):
            why.append('face')
        if i:
            (dx, dy), resp = cv2.phaseCorrelate(small[i - 1], small[i])
            if (resp > 0.15 and (abs(dx) > 4 or abs(dy) > 3)) or float(np.mean(np.abs(small[i] - small[i - 1]))) > 60:
                why.append('moves')
        if f.mean() < 15:
            why.append('dark')
        elif float(np.mean(np.abs(small[i] - background) > 40)) > 0.35:
            why.append('close')
        if why:
            out.append((round(offset + i / FPS, 1), why))
    return out


def cut(sig, edge, direction, samples):
    """Length of the set-up moment touching `edge` (direction +1 = start, -1 = end), 0 if none."""
    if sum(1 for _, why in sig if set(why) - {'dark'}) > BUSY * samples:
        return 0  # signs nearly all the time: that is how it was filmed, not a set-up (black is always cut)
    pts = sorted(sig, key=lambda s: s[0] * direction)
    if not pts or abs(pts[0][0] - edge) > EDGE:
        return 0
    last, kinds = pts[0][0], set(pts[0][1])
    for t, why in pts[1:]:
        if abs(t - last) > GAP:
            break
        last, kinds = t, kinds | set(why)
    length = abs(last - edge) + 1.5
    return round(min(length, MAX_CUT if kinds & {'moves', 'dark'} else MAX_SHORT), 1)


def main():
    path, dur = sys.argv[1], float(sys.argv[2])
    if dur < MIN_LENGTH:
        return print(json.dumps({'start': 0, 'end': dur, 'signals': []}))
    win = WINDOW
    head = signals(frames(path, 0, win), 0)
    tail = signals(frames(path, dur - win, win), dur - win)
    samples = win * FPS
    start, end = (min(cut(head, 0, +1, samples), dur * 0.1), min(cut(tail, dur, -1, samples), dur * 0.1))
    print(json.dumps({'start': start, 'end': round(dur - end, 1), 'signals': head + tail}))


if __name__ == '__main__':
    main()
