import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  targetLanguage: z.string().trim().min(2).max(32),
  provider: z.enum(["deepseek", "google"]).default("deepseek"),
});

const deepSeekResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    prompt_cache_hit_tokens: z.number().int().nonnegative().default(0),
    prompt_cache_miss_tokens: z.number().int().nonnegative().default(0),
  }).optional(),
});

const translationSchema = z.union([
  z.object({
    t: z.string().trim().min(1),
    s: z.string().trim().min(1).default("auto"),
  }).transform((value) => ({ translation: value.t, detectedLanguage: value.s })),
  z.object({
    translation: z.string().trim().min(1),
    detectedLanguage: z.string().trim().min(1),
  }),
]);

const googleResponseSchema = z.object({
  data: z.object({
    translations: z.array(z.object({
      translatedText: z.string().trim().min(1),
      detectedSourceLanguage: z.string().trim().min(1).optional(),
    })).min(1),
  }),
});

const googleErrorResponseSchema = z.object({
  error: z.object({
    details: z.array(z.object({
      reason: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough(),
}).passthrough();

const upstreamMessages: Record<number, string> = {
  401: "DeepSeek API Key 无效",
  402: "DeepSeek 账户余额不足",
  429: "请求过于频繁，请稍后再试",
  500: "DeepSeek 服务暂时异常，请稍后再试",
  503: "DeepSeek 服务繁忙，请稍后再试",
};

const googleUpstreamMessages: Record<number, string> = {
  400: "Google 翻译请求格式无效",
  401: "Google Cloud Translation API Key 无效",
  403: "Google Cloud Translation API 未启用、密钥受限或结算未开启",
  429: "Google 翻译额度已用尽或请求过于频繁",
  500: "Google 翻译服务暂时异常，请稍后再试",
  503: "Google 翻译服务繁忙，请稍后再试",
};

const googleReasonMessages: Record<string, string> = {
  API_KEY_INVALID: "Google Cloud Translation API Key 无效，请在设置中检查密钥",
  API_KEY_SERVICE_BLOCKED: "该 Google API Key 未获准访问 Cloud Translation API，请检查 API 限制",
  SERVICE_DISABLED: "Google Cloud Translation API 尚未启用，请先在 Google Cloud 项目中启用",
  BILLING_DISABLED: "Google Cloud 项目结算未开启，请启用结算后重试",
  RATE_LIMIT_EXCEEDED: "Google 翻译额度已用尽或请求过于频繁",
  QUOTA_EXCEEDED: "Google 翻译额度已用尽或请求过于频繁",
};

function parseModelContent(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return translationSchema.parse(JSON.parse(cleaned));
}

function maxTranslationTokens(text: string) {
  return Math.min(1600, Math.max(64, Math.ceil(text.length * 0.8) + 24));
}

async function getGoogleErrorMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => undefined);
  const result = googleErrorResponseSchema.safeParse(payload);
  const reasons = result.success
    ? result.data.error.details?.flatMap((detail) => detail.reason ? [detail.reason] : []) || []
    : [];

  for (const reason of reasons) {
    const message = googleReasonMessages[reason];
    if (message) return message;
    if (reason.startsWith("API_KEY_") && reason.endsWith("_BLOCKED")) {
      return "Google API Key 的应用限制阻止了本次请求，请检查密钥限制";
    }
  }

  return googleUpstreamMessages[response.status] || "Google 翻译服务请求失败";
}

export async function POST(request: Request) {
  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "翻译内容为空、过长或格式无效" },
      { status: 400 },
    );
  }

  const isGoogle = body.provider === "google";
  const apiKey = request.headers.get(
    isGoogle ? "x-google-translate-key" : "x-deepseek-key",
  )?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: isGoogle
        ? "请先在设置中填写 Google Cloud Translation API Key"
        : "请先在设置中填写 DeepSeek API Key" },
      { status: 401 },
    );
  }

  try {
    if (isGoogle) {
      const url = new URL("https://translation.googleapis.com/language/translate/v2");
      url.searchParams.set("key", apiKey);
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          q: body.text,
          target: body.targetLanguage,
          format: "text",
        }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: await getGoogleErrorMessage(response) },
          { status: response.status >= 400 && response.status < 600 ? response.status : 502 },
        );
      }

      const result = googleResponseSchema.parse(await response.json());
      const translation = result.data.translations[0];
      return NextResponse.json({
        translation: translation.translatedText,
        detectedLanguage: translation.detectedSourceLanguage || "auto",
      });
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        stream: false,
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: maxTranslationTokens(body.text),
        messages: [
          {
            role: "system",
            content:
              "Translate precisely. Return JSON {\"t\":\"translation\",\"s\":\"source language\"}. Preserve terminology, citations, formulas and line breaks. No explanations.",
          },
          {
            role: "user",
            content: JSON.stringify({
              target: body.targetLanguage,
              text: body.text,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: upstreamMessages[response.status] || "翻译服务请求失败" },
        { status: response.status >= 400 && response.status < 600 ? response.status : 502 },
      );
    }

    const result = deepSeekResponseSchema.parse(await response.json());
    const translation = parseModelContent(result.choices[0].message.content);
    return NextResponse.json({
      ...translation,
      ...(result.usage ? {
        usage: {
          promptTokens: result.usage.prompt_tokens,
          completionTokens: result.usage.completion_tokens,
          totalTokens: result.usage.total_tokens,
          promptCacheHitTokens: result.usage.prompt_cache_hit_tokens,
          promptCacheMissTokens: result.usage.prompt_cache_miss_tokens,
        },
      } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "翻译请求超时，请重试" }, { status: 504 });
    }
    if (error instanceof TypeError) {
      return NextResponse.json(
        { error: body.provider === "google"
          ? "无法连接 Google 翻译服务，请检查网络后重试"
          : "无法连接 DeepSeek 翻译服务，请检查网络后重试" },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "翻译结果格式异常，请重试" },
      { status: 502 },
    );
  }
}
