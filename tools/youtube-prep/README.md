# Video preparation for the members area

Turns the raw recordings on the ICCD drive into videos in the members area.

1. **Copy** each original to the SSD, one at a time, in large blocks. The archive is a USB hard
   disk: fast for one reader, very slow for two.
2. **Convert** to 1080p H.264 on the NVIDIA card and Intel Quick Sync at the same time
   (a keyframe every 2 s). The SSD copy is deleted right after.
3. **Trim** camera set-up moments at the start and end (`detect_trim.py`, on the 1080p copy):
   a face at the lens, the camera being handled, someone right in front of it, a black picture.
   Only recordings of 10 minutes or more; at most 45 s per end and never more than 10% of a video.
4. **Upload** to Bunny Stream (resumable), one collection per training weekend, with the
   recording details as meta tags. The local copy is then deleted. The video appears in the
   admin under *Members area · inbox*.

Clips shorter than a minute are skipped. Files are named `Place date time (clip)`, using the
camera's local time. Without a Bunny connection the videos go into `Batch NN` folders of 15
for a manual YouTube upload instead.

- One-time Bunny connection: `node tools/youtube-prep/setup-bunny.mjs` (keys typed hidden,
  saved in `<output>/_state/bunny.json` and as secrets of the Cloudflare worker; never in git).
- Start: double-click `Start video preparation.cmd`. Progress page: http://localhost:7777.
  Closing it is safe; starting again continues where it stopped.
- The original recordings are only read, never changed.
- Needs ffmpeg/ffprobe, Node 22 and Python with opencv-python-headless.
