// languages.js
// Language data straight from the gpt-realtime-translate documentation:
//   - 13 supported OUTPUT (target) languages
//   - 70+ supported INPUT languages (named examples from the docs; the model
//     auto-detects the source, so "Auto-detect" is the default).

// The 13 documented output languages, in the order the docs list them.
export const OUTPUT_LANGUAGES = [
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "id", name: "Indonesian", flag: "🇮🇩" },
  { code: "vi", name: "Vietnamese", flag: "🇻🇳" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "en", name: "English", flag: "🇬🇧" },
];

// Source is auto-detected by the model. We offer "Auto-detect" plus a set of
// documented input languages (70+ supported). These labels are informational —
// the model detects the actual spoken language dynamically.
export const INPUT_LANGUAGES = [
  { code: "auto", name: "Auto-detect", flag: "🌐" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "af", name: "Afrikaans", flag: "🇿🇦" },
  { code: "bn", name: "Bengali", flag: "🇧🇩" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "he", name: "Hebrew", flag: "🇮🇱" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "id", name: "Indonesian", flag: "🇮🇩" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "ro", name: "Romanian", flag: "🇷🇴" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "th", name: "Thai", flag: "🇹🇭" },
  { code: "tr", name: "Turkish", flag: "🇹🇷" },
  { code: "uk", name: "Ukrainian", flag: "🇺🇦" },
  { code: "vi", name: "Vietnamese", flag: "🇻🇳" },
];

export function outputLanguageName(code) {
  return OUTPUT_LANGUAGES.find((l) => l.code === code)?.name || code;
}
