/** Normalize phone to digits for storage and duplicate checks (max 15). */
export function normalizePhoneDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, 15);
}

export function isValidRegisterPhone(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 15;
}

export function sanitizePlayerRegisterName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80);
}
