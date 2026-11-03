import asyncio
import io
import os
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image
from PIL.PngImagePlugin import PngInfo
from app import main
from app.vision_runtime import VisualAnalysisCache, prepare_catalog_image, visual_cache_key


def png(color="black", size=(150, 150), timestamp=None):
    output = io.BytesIO()
    metadata = PngInfo()
    if timestamp is not None:
        metadata.add_text("date:create", timestamp)
    Image.new("RGB", size, color).save(output, format="PNG", pnginfo=metadata)
    return output.getvalue()


class VisionRuntimeTests(unittest.TestCase):
    def setUp(self):
        main.VISUAL_CACHE.clear()
        provider_patch = patch.dict(os.environ, {"VISION_PROVIDER": "ollama"})
        provider_patch.start()
        self.addCleanup(provider_patch.stop)

    def test_resize_preserves_aspect_ratio_and_small_images_verbatim(self):
        original = png()
        result, size = prepare_catalog_image(original)
        self.assertEqual(result, original)
        self.assertFalse(size["resized"])
        result, size = prepare_catalog_image(png(size=(1024, 512)))
        self.assertEqual(size["input_size"], [256, 128])
        self.assertTrue(size["resized"])
        with Image.open(io.BytesIO(result)) as image:
            self.assertEqual(image.size, (256, 128))
        with self.assertRaises(OSError):
            prepare_catalog_image(b"not an image")

    def test_cache_keys_bind_asset_pixels_model_endpoint_and_profile(self):
        image = png()
        key = visual_cache_key(1, image, image, "gemma3:4b", "http://localhost:11434")
        repackaged = png(timestamp="changed-non-visual-metadata")
        self.assertNotEqual(image, repackaged)
        self.assertEqual(key, visual_cache_key(1, repackaged, repackaged, "gemma3:4b", "http://localhost:11434"))
        self.assertNotEqual(key, visual_cache_key(2, image, image, "gemma3:4b", "http://localhost:11434"))
        changed = png("white")
        self.assertNotEqual(key, visual_cache_key(1, changed, changed, "gemma3:4b", "http://localhost:11434"))
        self.assertNotEqual(key, visual_cache_key(1, image, image, "other-model", "http://localhost:11434"))
        self.assertNotEqual(key, visual_cache_key(1, image, image, "gemma3:4b", "http://other:11434"))
        with patch("app.vision_runtime.VISION_PROFILE", "new-profile"):
            self.assertNotEqual(key, visual_cache_key(1, image, image, "gemma3:4b", "http://localhost:11434"))

    def test_cache_expires_evicts_and_protects_observations_from_mutation(self):
        clock = [0.0]
        cache = VisualAnalysisCache(2, 10, clock=lambda: clock[0])
        key = (1,)
        self.assertEqual(cache.reserve(key)[0], "miss")
        cache.publish(key, {"analysis": {"colors": ["black"]}})
        status, value, _ = cache.reserve(key)
        self.assertEqual(status, "hit")
        value["analysis"]["colors"].append("fake")
        self.assertEqual(cache.reserve(key)[1]["analysis"]["colors"], ["black"])
        for item in (2, 3):
            cache.reserve((item,))
            cache.publish((item,), {"analysis": {}})
        self.assertEqual(cache.reserve(key)[0], "miss")
        cache.fail(key, ValueError("not cached"))
        clock[0] = 11
        self.assertEqual(cache.reserve((3,))[0], "miss")

    def test_inflight_requests_share_success_and_failures_are_not_cached(self):
        cache = VisualAnalysisCache()
        owner = cache.reserve((1,))
        shared = cache.reserve((1,))
        self.assertEqual((owner[0], shared[0]), ("miss", "shared"))
        self.assertIs(owner[2], shared[2])
        cache.publish((1,), {"analysis": {"colors": ["black"]}})
        self.assertEqual(shared[2].result()["analysis"]["colors"], ["black"])
        cache.reserve((2,))
        waiting = cache.reserve((2,))[2]
        cache.fail((2,), ValueError("vision failed"))
        with self.assertRaises(ValueError):
            waiting.result()
        self.assertEqual(cache.reserve((2,))[0], "miss")

    def test_shortlist_preserves_required_categories_and_excludes_irrelevant_assets(self):
        candidates = [
            {"asset_id": 9, "category": "frontAccessory", "name": "black cute shirt dress", "price": 30},
            {"asset_id": 1, "category": "layeredShirt", "name": "black cute shirt", "price": 65},
            {"asset_id": 2, "category": "layeredPants", "name": "black cute pants", "price": 75},
            {"asset_id": 3, "category": "shirt", "name": "red shirt", "price": 5},
        ]
        chosen = main.build_visual_shortlist(candidates, {"categories": ["pants", "shirt"], "colors": ["black"], "style": "cute"}, 500)
        self.assertEqual({item["asset_id"] for item in chosen}, {1, 2})
        self.assertEqual(len(chosen), 2)
        required = ["shirt", "pants", "hair", "hat"]
        candidates = [{"asset_id": i, "category": category, "name": "black", "price": 1} for i, category in enumerate(required, 1)]
        chosen = main.build_visual_shortlist(candidates, {"categories": required, "colors": ["black"]}, 500)
        self.assertEqual({item["category"] for item in chosen}, set(required))

    def test_cached_analysis_requires_current_image_binding_and_changed_pixels_reanalyze(self):
        current = {"image": png(), "target_id": 44}
        class Response:
            status_code = 200
            def __init__(self, data=None, content=b"", headers=None):
                self.data, self.content, self.headers = data, content, headers or {}
            def raise_for_status(self):
                pass
            def json(self):
                return self.data
        class Client:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
            async def get(self, url, **kwargs):
                if url == main.THUMBNAILS:
                    return Response({"data": [{"targetId": current["target_id"], "state": "Completed", "imageUrl": "https://tr.rbxcdn.com/same.png"}]})
                return Response(content=current["image"], headers={"content-type": "image/png"})
        observed = {"c": ["black"], "s": "casual", "p": "solid", "d": ["long sleeves"]}
        async def run():
            with patch.object(main.httpx, "AsyncClient", return_value=Client()), patch.object(main, "gemma_analyze", new=AsyncMock(return_value=observed)) as gemma:
                candidate = [{"asset_id": 44, "category": "shirt", "name": "catalog item"}]
                first = await main.analyze_candidate_thumbnails(candidate)
                repeated = await main.analyze_candidate_thumbnails(candidate)
                self.assertEqual(gemma.await_count, 1)
                self.assertEqual(repeated[44]["visual_cache_status"], "hit")
                self.assertEqual(repeated[44]["image_verified_for_asset_id"], 44)
                self.assertEqual(first[44]["visual_analysis"], repeated[44]["visual_analysis"])
                current["image"] = png(timestamp="new-timestamp-same-pixels")
                metadata_only = await main.analyze_candidate_thumbnails(candidate)
                self.assertEqual(metadata_only[44]["visual_cache_status"], "hit")
                self.assertEqual(gemma.await_count, 1)
                current["image"] = png("white")
                changed = await main.analyze_candidate_thumbnails(candidate)
                self.assertEqual(gemma.await_count, 2)
                self.assertNotEqual(first[44]["image_identity_sha256"], changed[44]["image_identity_sha256"])
                current["target_id"] = 45
                wrong = await main.analyze_candidate_thumbnails(candidate)
                self.assertEqual(wrong[44]["image_retrieval_status"], "failed")
                self.assertEqual(gemma.await_count, 2)
        asyncio.run(run())

    def test_empty_visual_output_is_rejected(self):
        with self.assertRaises(ValueError):
            main.clean_visual({})
