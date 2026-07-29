const OUTPUT_LANGUAGE_CODES = new Set([
  "de",
  "en",
  "es",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "pt",
  "ru",
  "vi",
  "zh",
]);

const SUMMARY_LANGUAGES = new Set([
  "Arabic",
  "Chinese",
  "English",
  "French",
  "German",
  "Hindi",
  "Italian",
  "Japanese",
  "Portuguese",
  "Romanian",
  "Russian",
  "Spanish",
  "Turkish",
]);

export function parseRequestBody(rawBody) {
  try {
    const body = typeof rawBody === "string" ? JSON.parse(rawBody || "{}") : rawBody || {};
    if (typeof body !== "object" || Array.isArray(body)) {
      return { error: "Request body must be a JSON object." };
    }
    return { body };
  } catch {
    return { error: "Request body must contain valid JSON." };
  }
}

export function outputLanguage(value, fallback = "es") {
  const language = value === undefined || value === null || value === "" ? fallback : value;
  return typeof language === "string" && OUTPUT_LANGUAGE_CODES.has(language) ? language : null;
}

export function summaryLanguage(value, fallback = "") {
  const language = value === undefined || value === null || value === "" ? fallback : value;
  return typeof language === "string" && (language === "" || SUMMARY_LANGUAGES.has(language))
    ? language
    : null;
}
