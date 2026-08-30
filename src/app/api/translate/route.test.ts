import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/translate/route";

afterEach(() => vi.unstubAllGlobals());

function request(
  body: unknown,
  key = "sk-local-user-key",
  provider: "deepseek" | "google" = "deepseek",
) {
  return new Request("http://127.0.0.1/api/translate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? {
        [provider === "google" ? "x-google-translate-key" : "x-deepseek-key"]: key,
      } : {}),
    },
    body: JSON.stringify({ ...body as object, provider }),
  });
}

describe("POST /api/translate", () => {
  it("rejects requests without the user's session key", async () => {
    const response = await POST(request({ text: "model", targetLanguage: "zh-CN" }, ""));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "请先在设置中填写 DeepSeek API Key" });
  });

  it("returns structured translation output from DeepSeek", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            t: "可解释人工智能",
            s: "en",
          }),
        },
      }],
      usage: {
        prompt_tokens: 48,
        completion_tokens: 12,
        total_tokens: 60,
        prompt_cache_hit_tokens: 32,
        prompt_cache_miss_tokens: 16,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(request({ text: "explainable AI", context: "research", targetLanguage: "zh-CN" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      translation: "可解释人工智能",
      detectedLanguage: "en",
      usage: {
        promptTokens: 48,
        completionTokens: 12,
        totalTokens: 60,
        promptCacheHitTokens: 32,
        promptCacheMissTokens: 16,
      },
    });
    const upstreamBody = JSON.parse(String(upstreamFetch.mock.calls[0][1]?.body)) as {
      max_tokens: number;
      temperature?: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(upstreamBody.max_tokens).toBe(64);
    expect(upstreamBody.temperature).toBe(0.1);
    expect(JSON.parse(upstreamBody.messages[1].content)).toEqual({
      target: "zh-CN",
      text: "explainable AI",
    });
  });

  it("preserves actionable DeepSeek error categories", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));

    const response = await POST(request({ text: "model", targetLanguage: "zh-CN" }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "请求过于频繁，请稍后再试" });
  });

  it("rejects Google requests without the user's Google session key", async () => {
    const response = await POST(request(
      { text: "model", targetLanguage: "zh-CN" },
      "",
      "google",
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "请先在设置中填写 Google Cloud Translation API Key",
    });
  });

  it("returns normalized translation output from Google Cloud Translation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (
        url.origin !== "https://translation.googleapis.com"
        || url.pathname !== "/language/translate/v2"
        || url.searchParams.get("key") !== "google-user-key"
        || body.q !== "explainable AI"
        || body.target !== "zh-CN"
        || body.format !== "text"
      ) {
        return new Response("unexpected Google request", { status: 400 });
      }
      return new Response(JSON.stringify({
        data: {
          translations: [{
            translatedText: "可解释人工智能",
            detectedSourceLanguage: "en",
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const response = await POST(request(
      { text: "explainable AI", context: "research", targetLanguage: "zh-CN" },
      "google-user-key",
      "google",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      translation: "可解释人工智能",
      detectedLanguage: "en",
    });
  });

  it("preserves actionable Google quota errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("quota exceeded", { status: 429 })));

    const response = await POST(request(
      { text: "model", targetLanguage: "zh-CN" },
      "google-user-key",
      "google",
    ));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: "Google 翻译额度已用尽或请求过于频繁",
    });
  });

  it("identifies an invalid Google API key from structured error details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "API_KEY_INVALID",
          domain: "googleapis.com",
        }],
      },
    }), { status: 400, headers: { "content-type": "application/json" } })));

    const response = await POST(request(
      { text: "model", targetLanguage: "zh-CN" },
      "bad-google-key",
      "google",
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Google Cloud Translation API Key 无效，请在设置中检查密钥",
    });
  });

  it("explains Google API restrictions from structured error details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 403,
        message: "Requests to this API are blocked.",
        status: "PERMISSION_DENIED",
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "API_KEY_SERVICE_BLOCKED",
          domain: "googleapis.com",
        }],
      },
    }), { status: 403, headers: { "content-type": "application/json" } })));

    const response = await POST(request(
      { text: "model", targetLanguage: "zh-CN" },
      "restricted-google-key",
      "google",
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "该 Google API Key 未获准访问 Cloud Translation API，请检查 API 限制",
    });
  });

  it.each([
    ["SERVICE_DISABLED", "Google Cloud Translation API 尚未启用，请先在 Google Cloud 项目中启用"],
    ["BILLING_DISABLED", "Google Cloud 项目结算未开启，请启用结算后重试"],
  ])("maps Google %s errors to an actionable message", async (reason, expectedError) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason,
          domain: "googleapis.com",
        }],
      },
    }), { status: 403, headers: { "content-type": "application/json" } })));

    const response = await POST(request(
      { text: "model", targetLanguage: "zh-CN" },
      "google-user-key",
      "google",
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expectedError });
  });

  it("distinguishes a Google network failure from malformed translation output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const response = await POST(request(
      { text: "model", targetLanguage: "zh-CN" },
      "google-user-key",
      "google",
    ));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "无法连接 Google 翻译服务，请检查网络后重试",
    });
  });
});
