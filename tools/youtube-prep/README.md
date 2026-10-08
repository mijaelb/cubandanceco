# YouTube preparation

Turns the raw recordings on the ICCD drive into upload-ready videos for the members area.

- Skips clips shorter than a minute (false starts, tests).
- Removes camera set-up moments at the start and end (`detect_trim.py`): a face at the lens,
  the camera being handled, someone right in front of it, a black picture. Only recordings of
  10 minutes or more, at most 45 s per end and never more than 10% of a video.
- Converts to 1080p H.264 with the NVIDIA card and Intel Quick Sync at the same time.
- Names files `Place date time (clip)`, using the camera's local time; YouTube uses the file
  name as the title.
- Puts them in `Batch 01`, `Batch 02`… (15 files each, what YouTube Studio takes at once).
- `_state/manifest.json` tells the members-area inbox which training each video belongs to.

Start: double-click `Start video preparation.cmd` (or `node tools/youtube-prep/prepare.mjs <source> <output>`).
Progress page: http://localhost:7777. Stopping and starting again continues where it stopped.
The original recordings are only read, never changed. Needs ffmpeg/ffprobe and Python with opencv-python-headless.
