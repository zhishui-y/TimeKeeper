export const MIN_MASTER_PASSWORD_CHARACTERS = 4;
export const RECOMMENDED_MASTER_PASSWORD_CHARACTERS = 8;

export function masterPasswordCharacterCount(password: string): number {
  return Array.from(password).length;
}

export function isMasterPasswordLongEnough(password: string): boolean {
  return masterPasswordCharacterCount(password) >= MIN_MASTER_PASSWORD_CHARACTERS;
}
