"""Bounded, verified image attachments shared by private and public reports."""

import io
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD = 3 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_000_000


async def verified_image(file):
    if not file or not file.filename:
        return None
    try:
        if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(415, "Attach a JPEG, PNG, or WebP image.")
        content = await file.read(MAX_UPLOAD + 1)
        if not content:
            raise HTTPException(422, "The image is empty.")
        if len(content) > MAX_UPLOAD:
            raise HTTPException(413, "Image exceeds the 3 MB limit.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(415, "The file is not a supported image.")
                source.verify()
            with Image.open(io.BytesIO(content)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1400, 1400))
                output = io.BytesIO()
                image.save(output, "JPEG", quality=75, optimize=True)
                result = output.getvalue()
                if len(result) > 600_000:
                    raise HTTPException(413, "Please choose a smaller image.")
                return result
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise HTTPException(422, "The attachment could not be verified as a valid image.") from None
    finally:
        await file.close()

