"""Bounded visual-analysis cache and lossless handling of small catalog images."""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import threading
import time
import weakref
from collections import OrderedDict
from concurrent.futures import Future
from io import BytesIO
from typing import Any

from PIL import Image, ImageOps

CATALOG_IMAGE_MAX_SIDE = 256
CATALOG_VISION_PROMPT = (
    "For catalog asset {asset_id}, describe visible clothing pixels only. "
    "Compact JSON: c=up to 3 dominant colors, s=short style, p=pattern, "
    "d=up to 3 short visible clothing details. Never infer price or availability."
)
CATALOG_VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "c": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
        "s": {"type": "string"},
        "p": {"type": "string"},
        "d": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
    },
    "required": ["c", "s", "p", "d"],
    "additionalProperties": False,
}
VISION_PROFILE = hashlib.sha256(json.dumps({
    "version": 1, "prompt": CATALOG_VISION_PROMPT, "schema": CATALOG_VISION_SCHEMA,
    "max_side": CATALOG_IMAGE_MAX_SIDE, "num_ctx": 1024, "num_predict": 112,
    "temperature": 0,
}, sort_keys=True).encode()).hexdigest()


def prepare_catalog_image(raw: bytes) -> tuple[bytes, dict[str, Any]]:
    """Verify decoded pixels; never crop or upscale, and retain small inputs verbatim."""
    with Image.open(BytesIO(raw)) as source:
        if source.width * source.height > 16_000_000:
            raise ValueError("Catalog image dimensions exceed the processing limit")
        source.load()
        original_size = [source.width, source.height]
        image = ImageOps.exif_transpose(source)
        needs_resize = max(image.size) > CATALOG_IMAGE_MAX_SIDE
        needs_orientation = image.size != source.size
        if not needs_resize and not needs_orientation:
            return raw, {"source_size": original_size, "input_size": original_size, "resized": False}
        image.thumbnail((CATALOG_IMAGE_MAX_SIDE, CATALOG_IMAGE_MAX_SIDE), Image.Resampling.LANCZOS)
        if image.mode not in {"RGB", "RGBA", "L", "LA", "P"}:
            image = image.convert("RGB")
        output = BytesIO()
        image.save(output, format="PNG", optimize=True)
        return output.getvalue(), {
            "source_size": original_size, "input_size": [image.width, image.height],
            "resized": needs_resize,
        }


def image_pixel_identity(raw: bytes) -> str:
    """Hash decoded appearance and color interpretation, ignoring PNG timestamps/compression."""
    with Image.open(BytesIO(raw)) as source:
        source.load()
        image = ImageOps.exif_transpose(source).convert("RGBA")
        profile = source.info.get("icc_profile", b"")
        metadata = {
            "size": image.size, "mode": "RGBA",
            "icc_profile": hashlib.sha256(profile).hexdigest() if isinstance(profile, bytes) and profile else None,
            "gamma": source.info.get("gamma"), "chromaticity": source.info.get("chromaticity"),
            "srgb": source.info.get("srgb"),
        }
        digest = hashlib.sha256(json.dumps(metadata, sort_keys=True).encode())
        digest.update(image.tobytes())
        return digest.hexdigest()


def visual_cache_key(asset_id: int, source: bytes, prepared: bytes, model: str, endpoint: str, context: dict | None = None) -> tuple:
    return (asset_id, image_pixel_identity(source), image_pixel_identity(prepared),
            model, endpoint.rstrip("/"), VISION_PROFILE, hashlib.sha256(json.dumps(context,sort_keys=True,ensure_ascii=False).encode()).hexdigest())


class VisualAnalysisCache:
    """Successful observations only, with TTL/LRU bounds and shared in-flight work."""

    def __init__(self, max_entries: int = 256, ttl_seconds: float = 21600, clock=time.monotonic):
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._entries: OrderedDict[tuple, tuple[float, dict[str, Any]]] = OrderedDict()
        self._pending: dict[tuple, Future] = {}
        self._lock = threading.Lock()

    def reserve(self, key: tuple) -> tuple[str, dict[str, Any] | None, Future | None]:
        with self._lock:
            entry = self._entries.get(key)
            if entry and self.clock() - entry[0] < self.ttl_seconds:
                self._entries.move_to_end(key)
                return "hit", copy.deepcopy(entry[1]), None
            self._entries.pop(key, None)
            if key in self._pending:
                return "shared", None, self._pending[key]
            future: Future = Future()
            self._pending[key] = future
            return "miss", None, future

    def publish(self, key: tuple, value: dict[str, Any]) -> None:
        stored = copy.deepcopy(value)
        with self._lock:
            self._entries[key] = (self.clock(), stored)
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
            future = self._pending.pop(key, None)
        if future is not None:
            future.set_result(copy.deepcopy(stored))

    def fail(self, key: tuple, error: BaseException) -> None:
        with self._lock:
            future = self._pending.pop(key, None)
        if future is not None:
            future.set_exception(error)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


_gates: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
_gate_lock = threading.Lock()


def vision_gate(limit: int = 1, lane: str = "ollama") -> asyncio.Semaphore:
    """One shared gate per application event loop, including reference uploads."""
    loop = asyncio.get_running_loop()
    with _gate_lock:
        lanes = _gates.setdefault(loop, {})
        if lane not in lanes:
            lanes[lane] = asyncio.Semaphore(limit)
        return lanes[lane]
