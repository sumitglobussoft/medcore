import { Router, Request, Response, NextFunction } from "express";
import { Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

const router = Router();
router.use(authenticate);
// Audio transcription is a clinician-only feature — patients must not be able
// to spend the Sarvam ASR quota by POSTing audio to this endpoint.
router.use(authorize(Role.DOCTOR, Role.ADMIN, Role.NURSE));
// security(2026-04-23): tighter per-IP limit for this LLM/ASR path so a
// compromised clinician token cannot burn the Sarvam quota (global limit is
// 600/min — way too loose for a paid speech API).
if (process.env.NODE_ENV !== "test") {
  router.use(rateLimit(30, 60_000));
}

// security(2026-04-23): hard cap on decoded audio size. Without this an
// attacker could POST a multi-MB base64 blob (the global express.json limit
// is 100 KB by default, but Buffer.from still happily decodes whatever gets
// through a larger body-parser in the future). 8 MB ≈ 5 min @ 96 kbps webm.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

// POST /api/v1/ai/transcribe
// Body: { audioBase64: string, language?: string }
// Accepts a base64-encoded audio blob and forwards it to the Sarvam ASR API.
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { audioBase64, language = "en-IN" } = req.body as {
        audioBase64?: string;
        language?: string;
      };

      if (!audioBase64 || typeof audioBase64 !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          error: "audioBase64 field is required",
        });
        return;
      }

      const apiKey = process.env.SARVAM_API_KEY;
      if (!apiKey) {
        res.status(500).json({
          success: false,
          data: null,
          error: "SARVAM_API_KEY is not configured",
        });
        return;
      }

      // Decode base64 → Buffer → Blob for FormData
      const audioBuffer = Buffer.from(audioBase64, "base64");
      // security(2026-04-23): reject oversized blobs before forwarding to
      // Sarvam so one client can't pin the worker on a single huge upload.
      if (audioBuffer.length === 0 || audioBuffer.length > MAX_AUDIO_BYTES) {
        res.status(413).json({
          success: false,
          data: null,
          error: `audio must be between 1 byte and ${MAX_AUDIO_BYTES} bytes`,
        });
        return;
      }
      const audioBlob = new Blob([audioBuffer], { type: "audio/webm" });

      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");
      formData.append("model", "saaras:v3");
      formData.append("language_code", language);

      const sarvamRes = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: {
          "api-subscription-key": apiKey,
        },
        body: formData,
      });

      if (!sarvamRes.ok) {
        let errMsg = `Sarvam ASR error: ${sarvamRes.status}`;
        try {
          const errBody = (await sarvamRes.json()) as { message?: string; error?: string };
          errMsg = errBody.message || errBody.error || errMsg;
        } catch {
          // body not JSON, keep default
        }
        res.status(502).json({ success: false, data: null, error: errMsg });
        return;
      }

      const result = (await sarvamRes.json()) as {
        transcript?: string;
        language_code?: string;
      };

      res.json({
        success: true,
        data: {
          transcript: result.transcript ?? "",
          languageCode: result.language_code ?? language,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

export { router as aiTranscribeRouter };
