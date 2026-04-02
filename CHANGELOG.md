# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Unreleased

### Added
- 7 MCP tools for the Ideogram V3 API:
  - `ideogram_generate` — text-to-image generation
  - `ideogram_describe` — image-to-text description
  - `ideogram_edit` — mask-based inpainting
  - `ideogram_remix` — image transformation with style control
  - `ideogram_reframe` — outpainting to new resolutions
  - `ideogram_replace_background` — foreground-preserving background replacement
  - `ideogram_upscale` — guided image upscaling
- Security hardening: SSRF protection, symlink rejection, Content-Type validation, path traversal prevention, Zod response validation
- Retry logic with exponential backoff for 429/500/502/503/504 + network errors
- Safety filter handling (url=null images reported, not crashed)
- Parallel image downloads with `Promise.allSettled` for partial failure resilience
- Native Node.js `fetch` + `FormData` — zero HTTP dependencies
