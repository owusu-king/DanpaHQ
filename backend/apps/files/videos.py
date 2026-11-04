"""Bounded validation and canonical playback copies of short property videos."""

from __future__ import annotations

import json
import math
import subprocess
import tempfile
from pathlib import Path

from .validation import FileValidationError

VIDEO_PURPOSES = frozenset({"property_video", "unit_video"})
MAX_DURATION_MS = 10_000
MAX_PLAYBACK_BYTES = 3_300_000
VIDEO_SCALE = (
    "scale=w='min(1280,iw)':h='min(1280,ih)':"
    "force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bilinear"
)


def _run(args: list[str], *, timeout: int = 35) -> bytes:
    try:
        return subprocess.run(  # noqa: S603 - fixed executables and server-owned paths; no shell
            args,
            check=True,
            capture_output=True,
            timeout=timeout,
        ).stdout
    except FileNotFoundError as exc:
        # Deployment failures must fail closed rather than accept unchecked media.
        raise FileValidationError("Video processing is unavailable. Try again later.") from exc
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise FileValidationError(
            "This video could not be processed. Choose another video."
        ) from exc


def _probe(path: Path, *, allow_unknown: bool = False) -> tuple[float, list[dict]]:
    try:
        data = json.loads(
            _run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-show_format",
                    "-show_streams",
                    "-of",
                    "json",
                    str(path),
                ],
                timeout=8,
            )
        )
        streams = data.get("streams", [])
        durations = (
            [float(data["format"]["duration"])] if "duration" in data.get("format", {}) else []
        )
        durations.extend(float(s["duration"]) for s in streams if "duration" in s)
        duration = max(durations, default=0)
        if not math.isfinite(duration) or (duration <= 0 and not allow_unknown):
            raise ValueError
        if not any(s.get("codec_type") == "video" for s in streams):
            raise ValueError
        return duration, streams
    except (ValueError, KeyError, TypeError) as exc:
        raise FileValidationError("Choose a playable MP4, MOV or WebM video.") from exc


def prepare_video(source: bytes) -> tuple[bytes, dict]:
    """Validate actual streams, strip metadata and encode H.264/AAC for both clients.

    Input size is bounded by the upload lifecycle before this runs. No URLs or
    client-supplied paths reach the tools; execution and output are bounded too.
    Only the canonical copy is scanned, sealed and made usable. A forged source
    duration cannot hide a longer clip: decoding is capped just beyond ten
    seconds and the resulting stream duration is checked independently.
    """
    with tempfile.TemporaryDirectory(prefix="danpa-video-") as directory:
        raw, output = Path(directory) / "source", Path(directory) / "video.mp4"
        raw.write_bytes(source)
        duration, streams = _probe(raw, allow_unknown=True)
        if duration > MAX_DURATION_MS / 1000:
            raise FileValidationError("Choose a video of 10 seconds or less.")
        video = next(s for s in streams if s.get("codec_type") == "video")
        if (
            not 0 < int(video.get("width", 0)) <= 7680
            or not 0 < int(video.get("height", 0)) <= 7680
        ):
            raise FileValidationError("This video's resolution is not supported.")
        _run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-threads",
                "1",
                "-i",
                str(raw),
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-t",
                "10.1",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-vf",
                VIDEO_SCALE,
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-b:v",
                "1800k",
                "-maxrate",
                "2000k",
                "-bufsize",
                "2000k",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-ac",
                "2",
                "-af",
                "atrim=duration=9.95,asetpts=PTS-STARTPTS",
                "-movflags",
                "+faststart",
                "-fs",
                str(MAX_PLAYBACK_BYTES + 1),
                "-y",
                str(output),
            ]
        )
        actual_duration, actual_streams = _probe(output)
        if actual_duration > MAX_DURATION_MS / 1000:
            raise FileValidationError("Choose a video of 10 seconds or less.")
        content = output.read_bytes()
        if not content or len(content) > MAX_PLAYBACK_BYTES:
            raise FileValidationError("This video could not be compressed. Choose a smaller video.")
        return content, {
            "duration_ms": math.ceil(actual_duration * 1000),
            "video_validated": True,
            "width": actual_streams[0].get("width"),
            "height": actual_streams[0].get("height"),
        }


def video_payload(subject, *, public: bool = False) -> dict | None:
    """Called only after the enclosing record's read authorization has passed."""
    from apps.trust import condition

    if not subject.video_id:
        return None
    if public and condition.lifecycle_state(subject) != condition.ConditionState.VERIFIED:
        return None
    return playback_payload(subject.video)


def playback_payload(file) -> dict | None:
    if file is None:
        return None
    if (
        not file.is_usable
        or file.is_sensitive
        or file.purpose not in VIDEO_PURPOSES
        or not file.metadata.get("video_validated")
    ):
        return None
    from .storage import get_storage

    return {
        "id": str(file.id),
        "url": get_storage()
        .presign_download(
            key=file.storage_key,
            expires_in=300,
            filename="video.mp4",
            disposition="inline",
        )
        .url,
        "duration_ms": file.metadata["duration_ms"],
        "content_type": "video/mp4",
        "size_bytes": file.size_bytes,
    }
