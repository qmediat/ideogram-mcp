# Ideogram API V3 — Reference

**Base URL:** `https://api.ideogram.ai`
**Auth:** `Api-Key` header
**Content-Type:** `multipart/form-data` (all endpoints)
**API Keys:** https://ideogram.ai/manage-api
**Official Docs:** https://developer.ideogram.ai

---

## Endpoints

### 1. Generate — `POST /v1/ideogram-v3/generate`

Generate images from text prompts.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Image description (1-10,000 chars) |
| `num_images` | integer | No | 1 | Number of images (1-8) |
| `aspect_ratio` | enum | No | "1x1" | Output dimensions |
| `rendering_speed` | enum | No | "DEFAULT" | Speed/quality tradeoff |
| `magic_prompt` | enum | No | "AUTO" | Auto-enhance prompts |
| `style_type` | enum | No | "AUTO" | Visual style |
| `negative_prompt` | string | No | — | What to exclude |
| `seed` | integer | No | random | Reproducibility seed (0-2,147,483,647) |
| `character_reference_images` | file[] | No | — | Character consistency (max 5) |

**Aspect Ratios:** `1x1`, `16x9`, `9x16`, `4x3`, `3x4`, `3x2`, `2x3`, `4x5`, `5x4`, `1x2`, `2x1`, `1x3`, `3x1`, `10x16`, `16x10`

**Rendering Speed:** `FLASH` (fastest), `TURBO`, `DEFAULT`, `QUALITY` (best)

**Style Types:** `AUTO`, `GENERAL`, `REALISTIC`, `DESIGN`, `FICTION`

**Magic Prompt:** `AUTO`, `ON`, `OFF`

---

### 2. Edit — `POST /v1/ideogram-v3/edit`

Edit specific areas of existing images using mask-based inpainting.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image` | file | Yes | — | Source image to edit |
| `mask` | file | Yes | — | Mask (black=edit, white=keep, min 10% black) |
| `prompt` | string | Yes | — | Description of desired changes |
| `num_images` | integer | No | 1 | Variations (1-8) |
| `rendering_speed` | enum | No | "DEFAULT" | Speed/quality tradeoff |
| `magic_prompt` | enum | No | "AUTO" | Auto-enhance prompts |
| `style_type` | enum | No | "AUTO" | Visual style |
| `seed` | integer | No | random | Reproducibility seed |
| `character_reference_images` | file[] | No | — | Character consistency (max 5) |

**Mask requirements:** Same dimensions as source image. PNG/JPEG/WebP.

---

### 3. Remix — `POST /v1/ideogram-v3/remix`

Transform images with new prompts while preserving characteristics.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image` | file | Yes | — | Source image to remix |
| `prompt` | string | Yes | — | New creative direction |
| `image_weight` | integer | No | 50 | Original image influence (0-100) |
| `num_images` | integer | No | 1 | Variations (1-8) |
| `aspect_ratio` | enum | No | — | Output dimensions |
| `rendering_speed` | enum | No | "DEFAULT" | Speed/quality tradeoff |
| `magic_prompt` | enum | No | "AUTO" | Auto-enhance prompts |
| `style_type` | enum | No | "AUTO" | Visual style |
| `negative_prompt` | string | No | — | What to exclude |
| `seed` | integer | No | random | Reproducibility seed |
| `character_reference_images` | file[] | No | — | Character consistency (max 5) |

---

### 4. Reframe — `POST /v1/ideogram-v3/reframe`

Extend images to target resolutions via outpainting.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image` | file | Yes | — | Source image to reframe |
| `resolution` | string | Yes | — | Target resolution (e.g., "1920x1080") |
| `num_images` | integer | No | 1 | Variations (1-8) |
| `rendering_speed` | enum | No | "DEFAULT" | Speed/quality tradeoff |
| `seed` | integer | No | random | Reproducibility seed |

---

### 5. Replace Background — `POST /v1/ideogram-v3/replace-background`

Replace image backgrounds while preserving foreground subjects.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image` | file | Yes | — | Source image |
| `prompt` | string | Yes | — | Description of new background |
| `num_images` | integer | No | 1 | Variations (1-8) |
| `rendering_speed` | enum | No | "DEFAULT" | Speed/quality tradeoff |
| `magic_prompt` | enum | No | "AUTO" | Auto-enhance prompts |
| `seed` | integer | No | random | Reproducibility seed |

---

### 6. Upscale — `POST /upscale`

Upscale images to higher resolution with guided enhancement.

**Note:** Uses a different request format — parameters wrapped in `image_request` JSON field.

**Parameters (in image_request JSON):**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image_file` | file | Yes | — | Image to upscale (top-level form field) |
| `prompt` | string | No | — | Guide the upscaling |
| `resemblance` | integer | No | 50 | Similarity to original (0-100) |
| `detail` | integer | No | 50 | Detail to add (0-100) |
| `magic_prompt_option` | enum | No | — | "AUTO", "ON", "OFF" |
| `num_images` | integer | No | 1 | Variations (1-8) |
| `seed` | integer | No | random | Reproducibility seed |

---

### 7. Describe — `POST /describe`

Generate text descriptions from images.

**Note:** Uses flat multipart/form-data fields (NOT `image_request` wrapper — unlike Upscale).

**Parameters (multipart form fields):**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image_file` | file | Yes | — | Image binary (JPEG/PNG/WebP, max 10MB) |
| `describe_model_version` | enum | No | "V_3" | "V_2" or "V_3" |

**Response:**

```json
{
  "descriptions": [
    { "text": "Description of the image..." }
  ]
}
```

---

## Common Response Format

All image generation endpoints return:

```json
{
  "created": "2026-04-01T12:00:00Z",
  "data": [
    {
      "url": "https://...temporary-image-url",
      "seed": 12345,
      "is_image_safe": true,
      "prompt": "enhanced prompt (if magic_prompt applied)",
      "resolution": "1024x1024"
    }
  ]
}
```

**Important:** Image URLs are temporary and expire. Download immediately.

---

## Error Handling

**HTTP Status Codes:**
- `200` — Success
- `400` — Validation error
- `401` — Invalid API key
- `429` — Rate limited (retry with exponential backoff)
- `500` — Server error (retryable)
- `503` — Service unavailable (retryable)

**Error Response:**

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

---

## Image Input Formats

All endpoints accepting images support:
1. **File upload** — binary in multipart form
2. **URL** — `https://example.com/image.jpg`
3. **Base64** — `data:image/png;base64,iVBORw0KGgo...`

**Constraints:**
- Max file size: 10 MB
- Formats: PNG, JPEG, WebP

---

## Cost Estimates (per image)

| Operation | FLASH | TURBO | DEFAULT | QUALITY |
|-----------|-------|-------|---------|---------|
| Generate | 0.04 | 0.08 | 0.10 | 0.20 |
| Edit | 0.06 | 0.10 | 0.12 | 0.24 |
| Remix | 0.04 | 0.08 | 0.10 | 0.20 |
| Reframe | 0.06 | 0.10 | 0.12 | 0.24 |
| Replace BG | 0.06 | 0.10 | 0.12 | 0.24 |
| Upscale | — | — | 0.12 | — |

Rate: ~$0.05 per credit (varies by plan).
