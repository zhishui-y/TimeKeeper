export const MIN_MASTER_PASSWORD_CHARACTERS = 4;
export const RECOMMENDED_MASTER_PASSWORD_CHARACTERS = 8;

export function masterPasswordCharacterCount(password: string): number {
  return Array.from(password).length;
}

export function isMasterPasswordLongEnough(password: string): boolean {
  return masterPasswordCharacterCount(password) >= MIN_MASTER_PASSWORD_CHARACTERS;
}

export function normalizeRecoveryAnswer(answer: string): string {
  return answer.trim().split(/\s+/u).filter(Boolean).join(" ").toLocaleLowerCase();
}

export function isRecoveryTextValid(value: string): boolean {
  return Array.from(value).length >= 2 && Array.from(value).length <= 100;
}
